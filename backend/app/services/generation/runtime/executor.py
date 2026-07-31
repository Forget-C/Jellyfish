"""GenerationRun 的领取与 Worker 命令构造服务。"""

from __future__ import annotations

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_run import GenerationWorkerCommand
from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.services.generation.runtime.run_repository import GenerationRunRepository
from sqlalchemy import update
from datetime import UTC, datetime
from sqlalchemy.ext.asyncio import AsyncSession


_OPERATION_BY_TASK_KIND = {
    "image_generation": GenerationOperation.image_generation,
    "video_generation": GenerationOperation.video_generation,
}


class GenerationExecutor:
    """唯一领取 GenerationRun 并生成 WorkerCommand 的生命周期入口。

    该服务不写 Task 终态、不调用 Provider；Celery 适配器取得 Command 后再投递
    Worker。重复投递会看到同一个已执行 Run 并返回 ``None``，从而阻止重复执行。
    """

    def __init__(self, db: AsyncSession) -> None:
        """绑定一次请求或 Worker 调度使用的异步数据库事务。"""
        self._db = db
        self._runs = GenerationRunRepository(db)

    async def claim_command(
        self,
        *,
        task_id: str,
        owner: str,
        lease_ttl_seconds: int,
        work_id: str | None = None,
    ) -> GenerationWorkerCommand | None:
        """领取可执行任务并返回携带当前 epoch 的 Worker 命令。

        未知 task kind、缺失冻结快照或已有有效 Run 时不会投递 Worker。已登记
        取消时仍领取 Run 并返回 ``cancel_requested`` 命令，供 Coordinator 唯一
        写入 cancelled 终态而不是由 API 直接裁决。
        """
        task = await self._db.get(GenerationTask, task_id)
        if task is None:
            raise ValueError(f"generation task does not exist: {task_id}")
        operation = _OPERATION_BY_TASK_KIND.get(task.task_kind)
        if operation is None:
            return None
        snapshot_payload = (task.payload or {}).get("snapshot")
        if not isinstance(snapshot_payload, dict):
            raise ValueError(f"generation task snapshot is unavailable: {task_id}")
        snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
        if task.status == GenerationTaskStatus.pending and not task.cancel_requested:
            marked_running = await self._db.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status == GenerationTaskStatus.pending,
                    GenerationTask.cancel_requested.is_(False),
                )
                .values(status=GenerationTaskStatus.running, progress=10)
            )
            if not marked_running.rowcount:
                return None
        elif task.status not in {GenerationTaskStatus.pending, GenerationTaskStatus.running}:
            return None
        run = await self._runs.create_queued(task_id=task_id)
        if run.status != "queued":
            if work_id:
                await self._mark_dispatch_ignored(work_id=work_id, task_id=task_id, reason="run_not_queued")
            return None
        epoch = await self._runs.claim(run_id=run.id, owner=owner, ttl_seconds=lease_ttl_seconds)
        if epoch is None:
            if work_id:
                await self._mark_dispatch_ignored(work_id=work_id, task_id=task_id, reason="run_claim_rejected")
            return None
        if not await self._runs.begin_execution(run_id=run.id, owner=owner, lease_epoch=epoch):
            if work_id:
                await self._mark_dispatch_ignored(work_id=work_id, task_id=task_id, reason="run_execution_rejected")
            return None
        if work_id:
            await self._bind_dispatch(work_id=work_id, task_id=task_id, run_id=run.id, lease_epoch=epoch)
        return GenerationWorkerCommand(
            run_id=run.id,
            task_id=task_id,
            lease_epoch=epoch,
            lease_owner=owner,
            lease_ttl_seconds=lease_ttl_seconds,
            provider_idempotency_key=run.provider_idempotency_key,
            operation=operation,
            snapshot=snapshot,
            cancel_requested=bool(task.cancel_requested),
        )

    async def _bind_dispatch(self, *, work_id: str, task_id: str, run_id: str, lease_epoch: int) -> None:
        """把 Celery work_id 绑定到唯一成功领取的 Run/epoch，重复消息仅标为 ignored。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        event = await self._db.get(GenerationRunDispatch, work_id)
        if event is None:
            event = GenerationRunDispatch(
                work_id=work_id,
                task_id=task_id,
                source="outbox",
                status="claimed",
                generation_run_id=run_id,
                lease_epoch=lease_epoch,
                enqueued_at=now,
                claimed_at=now,
            )
            self._db.add(event)
        elif (
            event.task_id == task_id
            and event.status in {"pending", "publishing", "published", "enqueued"}
            and (event.generation_run_id is None or event.generation_run_id == run_id)
        ):
            event.status = "claimed"
            event.generation_run_id = run_id
            event.lease_epoch = lease_epoch
            event.claimed_at = now
        else:
            event.status = "ignored"
            event.error = "dispatch_run_mismatch_or_duplicate"
        await self._db.flush()

    async def _mark_dispatch_ignored(self, *, work_id: str, task_id: str, reason: str) -> None:
        """记录重复或失效 work_id，确保投递审计不会遗留为未领取状态。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        event = await self._db.get(GenerationRunDispatch, work_id)
        if event is None:
            self._db.add(
                GenerationRunDispatch(
                    work_id=work_id,
                    task_id=task_id,
                    source="outbox",
                    status="ignored",
                    enqueued_at=now,
                    claimed_at=now,
                    error=reason,
                )
            )
        elif event.task_id == task_id:
            event.status = "ignored"
            event.claimed_at = now
            event.error = reason
        await self._db.flush()


__all__ = ["GenerationExecutor"]
