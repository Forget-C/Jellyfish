"""任务只读查询：生命周期只取 tasks，媒体结果只取 task_outputs 与 files。"""

from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, datetime, timedelta
import json

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.task import TERMINAL_TASK_STATUSES
from app.core.contracts.generation_delivery import DeliveredArtifact, GenerationDeliveryResult
from app.models.task import Task, TaskOutput
from app.services.task_sources import resolve_task_sources
from app.services.task_service import AUTO_CHECK_DISPATCH
from app.models.studio_prompts_files_timeline import FileItem
from app.schemas.task import TaskListItemRead, TaskOutputRead, TaskPageRead, TaskResultRead, TaskStatusRead, TaskOutputHistoryRead, TaskOutputPageRead


# 列表不加载大输入、文本结果、供应商响应或错误正文。
_VIEW_COLUMNS = (
    Task.id, Task.kind, Task.title, Task.target_type, Task.target_id, Task.project_id,
    Task.status, Task.stage, Task.progress, Task.cancel_requested_at,
    Task.started_at, Task.finished_at, Task.created_at, Task.updated_at,
)


def timestamp(value: datetime | None) -> float | None:
    """数据库无时区值统一按 UTC 解释，避免随服务器时区改变耗时。"""
    return value.replace(tzinfo=UTC).timestamp() if value is not None else None


def status_view(row) -> TaskStatusRead:
    """从任务行或轻量投影生成状态，不维护独立缓存状态。"""
    start = timestamp(row.started_at)
    end = timestamp(row.finished_at) or datetime.now(UTC).timestamp()
    return TaskStatusRead(
        task_id=row.id, status=row.status, stage=row.stage, progress=row.progress,
        cancel_requested=row.cancel_requested_at is not None,
        cancel_requested_at_ts=timestamp(row.cancel_requested_at),
        started_at_ts=start, finished_at_ts=timestamp(row.finished_at),
        elapsed_ms=max(0, int((end - start) * 1000)) if start is not None else None,
    )


def _utc_naive(value: datetime) -> datetime:
    """查询时间统一到数据库的 UTC 无时区表示。"""
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    """拒绝损坏或过大的游标，不把游标内容拼接为 SQL。"""
    try:
        if len(cursor) > 512:
            raise ValueError("cursor too long")
        date, task_id = json.loads(urlsafe_b64decode(cursor.encode()).decode())
        if not isinstance(task_id, str) or not 0 < len(task_id) <= 64:
            raise ValueError("invalid task id")
        return _utc_naive(datetime.fromisoformat(date)), task_id
    except (ValueError, TypeError, UnicodeError) as error:
        raise HTTPException(status_code=422, detail="invalid_task_cursor") from error


class TaskQueries:
    """统一的只读投影；调用方不能通过此对象改变任务状态。"""

    def __init__(self, db: AsyncSession):
        """使用当前短查询会话。"""
        self.db = db

    async def list(
        self, *, statuses: list[str] | None = None, task_kind: str | None = None,
        target_type: str | None = None, target_id: str | None = None, project_id: str | None = None,
        created_from: datetime | None = None, created_before: datetime | None = None,
        recent_seconds: int | None = None, cursor: str | None = None, limit: int = 50,
    ) -> TaskPageRead:
        """历史默认不截断时间；活动面板可显式请求活动任务加最近终态。"""
        if not 1 <= limit <= 100:
            raise HTTPException(status_code=422, detail="invalid_task_page_size")
        if created_from is not None and created_before is not None and _utc_naive(created_from) >= _utc_naive(created_before):
            raise HTTPException(status_code=422, detail="invalid_task_date_range")
        stmt = select(*_VIEW_COLUMNS, Task.input_snapshot["target_parent_id"].as_string().label("target_parent_id"),
            case(*[(Task.kind == kind, Task.input_snapshot[key]['version_id'].as_string())
                for kind, key in [('directing_instruction', 'scene_instruction'),
                    ('directing_instruction_check', 'instruction_check'), ('directing_design', 'scene_design'), ('directing_unit_design', 'scene_unit_design')]]).label('scene_version_id'),
            case(*[(Task.kind == kind, Task.input_snapshot[key]['unit_id'].as_string())
                for kind, key in [('directing_instruction', 'scene_instruction'),
                    ('directing_instruction_check', 'instruction_check')]]).label('scene_unit_id'),
            Task.input_snapshot['scene_unit_design']['request']['shot_id'].as_string().label('scene_shot_id')
        ).where(Task.kind != AUTO_CHECK_DISPATCH)
        for column, value in ((Task.kind, task_kind), (Task.target_type, target_type),
                              (Task.target_id, target_id), (Task.project_id, project_id)):
            if value is not None:
                stmt = stmt.where(column == value)
        if statuses is not None:
            stmt = stmt.where(Task.status.in_(statuses))
        if created_from is not None:
            stmt = stmt.where(Task.created_at >= _utc_naive(created_from))
        if created_before is not None:
            stmt = stmt.where(Task.created_at < _utc_naive(created_before))
        if recent_seconds is not None:
            cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=recent_seconds)
            stmt = stmt.where(or_(Task.status.in_(["queued", "running"]), Task.finished_at >= cutoff))
        if cursor is not None:
            created_at, task_id = _decode_cursor(cursor)
            stmt = stmt.where(or_(Task.created_at < created_at,
                                  and_(Task.created_at == created_at, Task.id < task_id)))
        rows = (await self.db.execute(stmt.order_by(Task.created_at.desc(), Task.id.desc()).limit(limit + 1))).all()
        sources = await resolve_task_sources(self.db, rows[:limit])
        items = [TaskListItemRead(
            source=sources.get(row.id),
            **status_view(row).model_dump(), task_kind=row.kind, title=row.title,
            target_type=row.target_type, target_id=row.target_id, project_id=row.project_id,
            created_at_ts=timestamp(row.created_at), updated_at_ts=timestamp(row.updated_at),
        ) for row in rows[:limit]]
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = urlsafe_b64encode(json.dumps([last.created_at.isoformat(), last.id]).encode()).decode()
        return TaskPageRead(items=items, next_cursor=next_cursor)

    async def outputs(
        self, *, target_type: str, target_id: str, cursor: str | None = None, limit: int = 100,
    ) -> TaskOutputPageRead:
        """查询业务目标的可用媒体候选，不载入任务输入或复制采用状态。"""
        if not 1 <= limit <= 100:
            raise HTTPException(status_code=422, detail="invalid_task_page_size")
        stmt = select(TaskOutput, FileItem.type, Task.created_at).join(
            Task, Task.id == TaskOutput.task_id,
        ).join(FileItem, FileItem.id == TaskOutput.file_id).where(
            Task.target_type == target_type, Task.target_id == target_id,
            Task.status.in_(TERMINAL_TASK_STATUSES),
            FileItem.delete_requested_at.is_(None), FileItem.deleted_at.is_(None),
        )
        if cursor:
            try:
                if len(cursor) > 512:
                    raise ValueError("cursor too long")
                date, task_id, ordinal = json.loads(urlsafe_b64decode(cursor.encode()).decode())
                if (not isinstance(task_id, str) or not 0 < len(task_id) <= 64
                        or not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0):
                    raise ValueError("invalid output cursor")
                date = _utc_naive(datetime.fromisoformat(date))
            except (ValueError, TypeError, UnicodeError) as error:
                raise HTTPException(status_code=422, detail="invalid_task_cursor") from error
            stmt = stmt.where(or_(
                Task.created_at < date,
                and_(Task.created_at == date, Task.id < task_id),
                and_(Task.created_at == date, Task.id == task_id, TaskOutput.ordinal > ordinal),
            ))
        rows = (await self.db.execute(stmt.order_by(
            Task.created_at.desc(), Task.id.desc(), TaskOutput.ordinal,
        ).limit(limit + 1))).all()
        items = [TaskOutputHistoryRead(
            task_id=output.task_id, ordinal=output.ordinal, file_id=output.file_id, media_type=media_type,
            created_at_ts=timestamp(created_at), delivery_status=output.delivery_status,
            delivery_reason=output.delivery_reason,
        ) for output, media_type, created_at in rows[:limit]]
        next_cursor = None
        if len(rows) > limit:
            output, _, created_at = rows[limit - 1]
            next_cursor = urlsafe_b64encode(json.dumps([created_at.isoformat(), output.task_id, output.ordinal]).encode()).decode()
        return TaskOutputPageRead(items=items, next_cursor=next_cursor)

    async def status(self, task_id: str) -> TaskStatusRead:
        """单任务轮询同样只读取轻量字段。"""
        row = (await self.db.execute(select(*_VIEW_COLUMNS).where(Task.id == task_id))).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return status_view(row)

    async def result(self, task_id: str) -> TaskResultRead:
        """返回文本结果及已保存媒体；失败或取消也能查看部分输出。"""
        results = await self.results([task_id])
        if task_id not in results:
            raise HTTPException(status_code=404, detail="Task not found")
        return results[task_id]

    async def results(self, task_ids: list[str]) -> dict[str, TaskResultRead]:
        """批量投影消息关联任务，查询次数不随消息数增加。"""
        if not task_ids:
            return {}
        tasks = list(await self.db.scalars(select(Task).where(Task.id.in_(task_ids))))
        rows = (await self.db.execute(select(TaskOutput, FileItem).join(
            FileItem, FileItem.id == TaskOutput.file_id,
        ).where(TaskOutput.task_id.in_(task_ids)).order_by(TaskOutput.ordinal))).all()
        grouped: dict[str, list] = {}
        for output, file in rows:
            grouped.setdefault(output.task_id, []).append((output, file))
        return {task.id: _result_view(task, grouped.get(task.id, [])) for task in tasks}


def _result_view(task: Task, rows: list) -> TaskResultRead:
    """将数据库事实组成响应；不会回写消息或其他业务表。"""
    outputs = [TaskOutputRead(
        ordinal=output.ordinal, file_id=file.id, media_type=file.type,
        delivery_status=output.delivery_status, delivery_reason=output.delivery_reason,
        deleted=file.deleted_at is not None,
    ) for output, file in rows]
    delivery = None
    if task.kind in {"image_generation", "video_generation"} and task.status in TERMINAL_TASK_STATUSES:
        delivery = GenerationDeliveryResult(
            outcome=task.status, provider_task_id=task.provider_task_id,
            error_code=task.error_code, error_message=task.error_message,
            primary_file_id=outputs[0].file_id if outputs and outputs[0].ordinal == 0 else None,
            artifacts=[DeliveredArtifact(
                artifact_id=f"{task.id}:{output.ordinal}", modality=output.media_type,
                ordinal=output.ordinal, file_id=output.file_id,
                publish_state=output.delivery_status or "skipped", publish_error=output.delivery_reason,
            ) for output in outputs],
        )
    return TaskResultRead(
        **status_view(task).model_dump(), result=task.result, outputs=outputs,
        generation_delivery=delivery, error=task.error_message or "", error_code=task.error_code,
    )
