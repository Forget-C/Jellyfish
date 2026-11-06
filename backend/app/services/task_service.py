"""任务生命周期的唯一写入口，所有调用方只报告事实或请求操作。

每次调用在调用方的短事务内完成，调用方负责提交/回滚；网络 I/O 必须在事务外。
终态、取消竞争、输出登记及领域交付在这里统一受 Task 行锁保护。
"""

from collections.abc import Awaitable, Callable, Sequence
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.task import TERMINAL_TASK_STATUSES, TaskExecutionMode, TaskStatus
from app.models.studio import FileItem
from app.models.task import Task, TaskInput, TaskOutput

TASK_KINDS = frozenset({
    "text_chat", "image_generation", "video_generation", "scene_export",
    "script_consistency",
    "script_character_portrait", "script_prop_info", "script_scene_info", "script_costume_info",
    "script_optimize", "script_simplify",
    "directing_unit_design", "directing_divide", "directing_design", "directing_review", "directing_review_revision", "directing_instruction", "directing_instruction_check",
})
MEDIA_KINDS = frozenset({"image_generation", "video_generation"})
Delivery = Callable[[AsyncSession, Task], Awaitable[None]]


def utcnow() -> datetime:
    """使用无时区 UTC 值，统一 MySQL 与 SQLite 的时间比较语义。"""
    return datetime.now(UTC).replace(tzinfo=None)


class TaskService:
    """统一管理创建、领取、远端观察、取消、结果与终态。"""

    def __init__(self, db: AsyncSession) -> None:
        """绑定一个事务会话；实例不跨并发请求共享。"""
        self.db = db

    async def submit(
        self, *, kind: str, snapshot: dict, title: str = "", target_type: str | None = None,
        target_id: str | None = None, project_id: str | None = None,
        expected_target_version: int | None = None, provider_id: str | None = None,
        execution_mode: str = TaskExecutionMode.direct, retry_of_task_id: str | None = None,
        inputs: Sequence[tuple[str, int, str]] = (), queue_timeout_seconds: int = 86400,
    ) -> Task:
        """在提交业务事务中冻结一份输入，并登记受删除保护的参考文件。"""
        if kind not in TASK_KINDS:
            raise ValueError(f"unsupported task kind: {kind}")
        mode = TaskExecutionMode(execution_mode)
        if mode is TaskExecutionMode.remote and kind not in MEDIA_KINDS:
            raise ValueError("only media tasks support remote execution")
        if retry_of_task_id and await self.db.get(Task, retry_of_task_id) is None:
            raise ValueError("retry source task not found")
        positions = {(role, ordinal) for role, ordinal, _ in inputs}
        if len(positions) != len(inputs) or any(not role or ordinal < 0 for role, ordinal, _ in inputs):
            raise ValueError("task input positions must be unique and non-negative")
        file_ids = sorted({file_id for _, _, file_id in inputs})
        for file_id in file_ids:
            file = await self.db.get(FileItem, file_id, with_for_update=True, populate_existing=True)
            if file is None or file.delete_requested_at is not None or file.deleted_at is not None:
                raise ValueError(f"input file is unavailable: {file_id}")
        row = Task(
            id=uuid4().hex, kind=kind, title=title[:255], target_type=target_type, target_id=target_id,
            project_id=project_id, expected_target_version=expected_target_version,
            provider_id=provider_id, execution_mode=mode, input_snapshot=deepcopy(snapshot),
            status=TaskStatus.queued, stage="queued", progress=0,
            deadline_at=utcnow() + timedelta(seconds=queue_timeout_seconds),
            retry_of_task_id=retry_of_task_id,
        )
        self.db.add(row)
        await self.db.flush()
        self.db.add_all([TaskInput(task_id=row.id, role_path=role, ordinal=ordinal, file_id=file_id)
                         for role, ordinal, file_id in inputs])
        await self.db.flush()
        return row

    async def claim(self, task_id: str, *, worker_id: str, timeout_seconds: int = 1800) -> bool:
        """原子领取一次；重复领取、过期和取消任务不获得执行权。"""
        now = utcnow()
        result = await self.db.execute(
            update(Task).where(
                Task.id == task_id, Task.status == TaskStatus.queued,
                Task.cancel_requested_at.is_(None),
                or_(Task.deadline_at.is_(None), Task.deadline_at > now),
            ).values(status=TaskStatus.running, stage="submitting", worker_instance_id=worker_id,
                     started_at=now, deadline_at=now + timedelta(seconds=timeout_seconds), progress=0)
        )
        if result.rowcount:
            row = await self.db.get(Task, task_id, populate_existing=True)
            await self._sync_canvas(row)
        return bool(result.rowcount)

    async def claim_next(self, *, worker_id: str, kinds: Sequence[str], timeout_seconds: int = 1800) -> Task | None:
        """有容量时才从相应任务类型领取一条，行锁在短事务提交后释放。"""
        row = await self.db.scalar(select(Task).where(
            Task.status == TaskStatus.queued, Task.kind.in_(kinds),
            Task.cancel_requested_at.is_(None),
            or_(Task.deadline_at.is_(None), Task.deadline_at > utcnow()),
        ).order_by(Task.created_at, Task.id).limit(1).with_for_update(skip_locked=True))
        if row is None or not await self.claim(row.id, worker_id=worker_id, timeout_seconds=timeout_seconds):
            return None
        await self.db.refresh(row)
        return row

    async def record_submission(
        self, task_id: str, *, provider_task_id: str | None, tracking_seconds: int = 86400,
    ) -> Task | None:
        """受理 ID 必须非空且只登记一次；缺失直接失败，不重新 create。"""
        row = await self._lock(task_id)
        if row is None or row.status != TaskStatus.running:
            return row
        if row.execution_mode != TaskExecutionMode.remote:
            raise ValueError("direct task cannot record a remote submission")
        remote_id = (provider_task_id or "").strip()
        if not remote_id:
            return await self.finish(task_id, error_code="provider_task_id_missing", error="供应商成功响应缺少任务 ID")
        if len(remote_id) > 255:
            return await self.finish(task_id, error_code="provider_task_id_invalid", error="供应商任务 ID 无效")
        if row.provider_task_id:
            if row.provider_task_id != remote_id:
                raise ValueError("provider task id is immutable")
            return row
        row.provider_task_id = remote_id
        row.remote_status = "submitted"
        row.stage = "polling"
        row.next_poll_at = utcnow()
        row.deadline_at = utcnow() + timedelta(seconds=tracking_seconds)
        await self.db.flush()
        return row

    async def record_poll_result(
        self, task_id: str, *, remote_status: str | None = None, error: str | None = None,
        next_poll_seconds: int = 5,
    ) -> Task | None:
        """保存一次观察；远端成功仅进入收取阶段，不能直接完成本地任务。"""
        row = await self._lock(task_id)
        if row is None or row.status != TaskStatus.running:
            return row
        if not row.provider_task_id:
            return await self.finish(task_id, error_code="provider_task_id_missing", error="缺少供应商任务 ID")
        row.last_polled_at = utcnow()
        row.last_poll_error = error[:2048] if error else None
        row.next_poll_at = utcnow() + timedelta(seconds=max(1, next_poll_seconds))
        if error:
            await self.db.flush()
            return row
        row.remote_status = remote_status
        if remote_status == "failed":
            return await self.finish(task_id, error_code="provider_failed", error="供应商生成失败")
        if remote_status == "cancelled":
            return await self.finish(task_id, cancelled=True)
        row.stage = "saving" if remote_status == "succeeded" else "polling"
        await self.db.flush()
        return row

    async def report_progress(self, task_id: str, *, progress: int | None, stage: str) -> None:
        """更新活动任务进度；终态不可被迟到事件修改。"""
        if progress is not None and not 0 <= progress <= 100:
            raise ValueError("progress must be between 0 and 100")
        await self.db.execute(update(Task).where(Task.id == task_id, Task.status == TaskStatus.running)
                              .values(progress=progress, stage=stage))
        row = await self._lock(task_id)
        if row is not None and row.status == TaskStatus.running:
            await self._sync_canvas(row)

    async def request_cancel(self, task_id: str, *, reason: str | None = None) -> Task | None:
        """排队任务立即取消，执行任务只登记意图，由统一终结规则裁决。"""
        row = await self._lock(task_id)
        if row is None or row.status in TERMINAL_TASK_STATUSES:
            return row
        if row.cancel_requested_at is None:
            row.cancel_requested_at = utcnow()
            row.cancel_reason = (reason or "")[:255] or None
        if row.status == TaskStatus.queued:
            return await self.finish(task_id, cancelled=True)
        await self.db.flush()
        await self._sync_canvas(row)
        return row

    async def add_output(self, task_id: str, *, ordinal: int, file_id: str) -> TaskOutput | None:
        """在 Task 行锁下登记完整文件，重复收取必须指向相同文件。"""
        row = await self._lock(task_id)
        if row is None or row.status != TaskStatus.running:
            return None
        if ordinal < 0:
            raise ValueError("output ordinal must be non-negative")
        file = await self.db.get(FileItem, file_id, with_for_update=True, populate_existing=True)
        if file is None or file.delete_requested_at is not None or file.deleted_at is not None:
            raise ValueError("output file is unavailable")
        output = await self.db.get(TaskOutput, (task_id, ordinal))
        if output is not None:
            if output.file_id != file_id:
                raise ValueError("task output is immutable")
            return output
        output = TaskOutput(task_id=task_id, ordinal=ordinal, file_id=file_id)
        self.db.add(output)
        await self.db.flush()
        return output

    async def finish(
        self, task_id: str, *, result: dict | None = None, error_code: str | None = None,
        error: str | None = None, cancelled: bool = False, deliver: Delivery | None = None,
    ) -> Task | None:
        """唯一终态入口：锁定任务后先裁决取消，再原子发布业务结果与终态。

        deliver 只允许数据库业务写入，不能执行网络 I/O 或自行提交事务。
        交付异常回滚当前事务，由执行器在新事务报告失败。
        """
        row = await self._lock(task_id)
        if row is None or row.status in TERMINAL_TASK_STATUSES:
            return row
        if cancelled or row.cancel_requested_at is not None:
            status = TaskStatus.cancelled
            error_code, error = "task_cancelled", row.cancel_reason or "任务已取消"
        elif error_code or error:
            status = TaskStatus.failed
            error_code = error_code or "execution_failed"
        else:
            if row.status != TaskStatus.running:
                raise ValueError("only running tasks can succeed")
            if row.kind in MEDIA_KINDS:
                outputs = list(await self.db.scalars(select(TaskOutput).where(TaskOutput.task_id == task_id)))
                expected = int((row.input_snapshot.get("operation_input") or {}).get("count", 1))
                if sorted(output.ordinal for output in outputs) != list(range(expected)):
                    raise ValueError("all media outputs must be saved before completing a task")
            if deliver is not None:
                await deliver(self.db, row)
            status = TaskStatus.succeeded
        row.status = status
        row.stage = "finished"
        row.finished_at = utcnow()
        row.next_poll_at = None
        row.error_code = error_code
        row.error_message = error
        if status == TaskStatus.succeeded or status == TaskStatus.failed and result is not None:
            row.result = deepcopy(result)
        if status == TaskStatus.succeeded:
            row.progress = 100
        await self.db.flush()
        await self._sync_canvas(row)
        return row

    async def interrupt_previous_workers(self, *, worker_id: str) -> int:
        """单 Worker 启动时中断旧本地请求；有远端 ID 的媒体继续查询。"""
        rows = list(await self.db.scalars(select(Task).where(
            Task.status == TaskStatus.running,
            or_(Task.worker_instance_id.is_(None), Task.worker_instance_id != worker_id),
            or_(Task.execution_mode == TaskExecutionMode.direct, Task.provider_task_id.is_(None)),
        )))
        for row in rows:
            await self.finish(row.id, error_code="submission_interrupted" if row.execution_mode == "remote" else "execution_interrupted",
                              error="服务重启，任务已中断，请重新提交")
        return len(rows)

    async def expire_tasks(self) -> int:
        """结束超期排队/本地执行，远端跟踪期限由 Poller 最后核对后结束。"""
        rows = list(await self.db.scalars(select(Task).where(
            Task.status.in_([TaskStatus.queued, TaskStatus.running]), Task.deadline_at <= utcnow(),
            or_(Task.status == TaskStatus.queued, Task.execution_mode == TaskExecutionMode.direct,
                Task.provider_task_id.is_(None)),
        )))
        for row in rows:
            await self.finish(row.id, error_code="queue_expired" if row.status == TaskStatus.queued else "execution_timeout",
                              error="任务等待或执行超时")
        return len(rows)

    async def _lock(self, task_id: str) -> Task | None:
        """统一取得最新任务行，先 flush 同事务事实，避免覆盖未提交的取消/受理信息。"""
        await self.db.flush()
        return await self.db.scalar(select(Task).where(Task.id == task_id).with_for_update()
                                    .execution_options(populate_existing=True))


    async def _sync_canvas(self, row: Task, *, delta: str | None = None) -> None:
        """Canvas fact hook keeps Task and business events in the same transaction."""
        if row.target_type == 'canvas_node':
            from app.services.generation_canvas.settlement import sync_task_fact
            await sync_task_fact(self.db, row, delta=delta)

    async def append_canvas_text(self, task_id: str, delta: str) -> bool:
        """Persist a provider chunk under the Task lock; cancellation wins before append."""
        row = await self._lock(task_id)
        if row is None or row.status != TaskStatus.running or row.cancel_requested_at is not None:
            if row is not None and row.status == TaskStatus.running and row.cancel_requested_at is not None:
                await self.finish(task_id, cancelled=True)
            return False
        if row.target_type != 'canvas_node':
            raise ValueError('stream target is not a canvas node')
        row.stage = 'generating'
        await self.db.flush()
        await self._sync_canvas(row, delta=delta)
        return True
