from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Optional, Protocol

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models.studio import ActorImage, CharacterImage, CostumeImage, PropImage, SceneImage, ShotFrameImage
from app.models.task_links import GenerationTaskLink
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.core.task_manager.types import DeliveryMode, TaskListItemView, TaskRecord, TaskStatus, TaskStatusView


def _now_ts() -> float:
    return time.time()


def _new_id() -> str:
    return uuid.uuid4().hex


def _enum_value(x: object) -> object:
    return x.value if isinstance(x, Enum) else x


def _to_app_mode(mode: str | GenerationDeliveryMode) -> DeliveryMode:
    return DeliveryMode(str(_enum_value(mode)))


def _to_app_status(status: str | GenerationTaskStatus) -> TaskStatus:
    return TaskStatus(str(_enum_value(status)))


def _to_db_mode(mode: DeliveryMode) -> GenerationDeliveryMode:
    return GenerationDeliveryMode(mode.value)


def _to_db_status(status: TaskStatus) -> GenerationTaskStatus:
    return GenerationTaskStatus(status.value)


def _datetime_ts(value: datetime | None) -> float | None:
    return value.timestamp() if value else None


def _elapsed_ms_from_datetimes(
    started_at: datetime | None,
    finished_at: datetime | None,
    *,
    now: datetime | None = None,
) -> int | None:
    if started_at is None:
        return None
    end_at = finished_at or now or datetime.now(UTC).replace(tzinfo=None)
    return max(0, int((end_at - started_at).total_seconds() * 1000))


def _is_terminal_status(status: TaskStatus) -> bool:
    return status in (TaskStatus.succeeded, TaskStatus.failed, TaskStatus.cancelled)


async def _resolve_navigation_targets(
    db: AsyncSession,
    *,
    link_map: dict[str, GenerationTaskLink],
) -> dict[str, tuple[str, str]]:
    result: dict[str, tuple[str, str]] = {}

    chapter_like_relation_types = {
        "chapter_division": "chapter",
        "script_extraction": "chapter",
        "consistency_check": "chapter",
        "script_optimization": "chapter",
        "script_simplification": "chapter",
    }
    shot_like_relation_types = {
        "video": "shot",
        "shot_first_frame_prompt": "shot",
        "shot_last_frame_prompt": "shot",
        "shot_key_frame_prompt": "shot",
    }
    image_like_models = {
        "actor_image": (ActorImage, "actor"),
        "scene_image": (SceneImage, "scene"),
        "prop_image": (PropImage, "prop"),
        "costume_image": (CostumeImage, "costume"),
        "character_image": (CharacterImage, "character"),
    }

    shot_frame_task_ids: list[str] = []
    shot_frame_image_ids: list[int] = []
    image_relation_ids: dict[str, list[int]] = {}

    for task_id, link in link_map.items():
        relation_type = str(link.relation_type or "")
        relation_entity_id = str(link.relation_entity_id or "")
        if not relation_type or not relation_entity_id:
            continue
        if relation_type in chapter_like_relation_types:
            result[task_id] = (chapter_like_relation_types[relation_type], relation_entity_id)
            continue
        if relation_type in shot_like_relation_types:
            result[task_id] = (shot_like_relation_types[relation_type], relation_entity_id)
            continue
        if relation_type == "shot_frame_image":
            try:
                shot_frame_image_ids.append(int(relation_entity_id))
                shot_frame_task_ids.append(task_id)
            except ValueError:
                continue
            continue
        if relation_type in image_like_models:
            try:
                image_relation_ids.setdefault(relation_type, []).append(int(relation_entity_id))
            except ValueError:
                continue

    if shot_frame_image_ids:
        rows = (
            await db.execute(
                select(ShotFrameImage.id, ShotFrameImage.shot_detail_id).where(
                    ShotFrameImage.id.in_(shot_frame_image_ids)
                )
            )
        ).all()
        shot_frame_map = {str(row.id): str(row.shot_detail_id) for row in rows}
        for task_id in shot_frame_task_ids:
            link = link_map[task_id]
            shot_id = shot_frame_map.get(str(link.relation_entity_id))
            if shot_id:
                result[task_id] = ("shot", shot_id)

    for relation_type, ids in image_relation_ids.items():
        model, navigate_type = image_like_models[relation_type]
        rows = (
            await db.execute(
                select(model.id, getattr(model, f"{navigate_type}_id")).where(model.id.in_(ids))
            )
        ).all()
        owner_map = {str(row[0]): str(row[1]) for row in rows}
        for task_id, link in link_map.items():
            if str(link.relation_type or "") != relation_type:
                continue
            owner_id = owner_map.get(str(link.relation_entity_id))
            if owner_id:
                result[task_id] = (navigate_type, owner_id)

    return result


def _task_record_from_row(row: GenerationTask) -> TaskRecord:
    return TaskRecord(
        id=row.id,
        mode=_to_app_mode(row.mode),
        task_kind=row.task_kind,
        status=_to_app_status(row.status),
        progress=row.progress,
        payload=row.payload,
        result=row.result,
        error=row.error or "",
        cancel_requested=bool(row.cancel_requested),
        cancel_requested_at_ts=_datetime_ts(row.cancel_requested_at),
        cancel_reason=row.cancel_reason or "",
        cancelled_at_ts=_datetime_ts(row.cancelled_at),
        started_at_ts=_datetime_ts(row.started_at),
        finished_at_ts=_datetime_ts(row.finished_at),
        elapsed_ms=_elapsed_ms_from_datetimes(row.started_at, row.finished_at),
        created_at_ts=_datetime_ts(row.created_at),
        updated_at_ts=_datetime_ts(row.updated_at),
        executor_type=row.executor_type,
        executor_task_id=row.executor_task_id,
    )


class TaskStore(Protocol):
    """任务存储抽象：可替换为内存、MySQL/SQLite(通过 SQLAlchemy) 等。"""

    async def create(self, payload: dict[str, Any], mode: DeliveryMode, task_kind: str) -> TaskRecord: ...
    async def get(self, task_id: str) -> Optional[TaskRecord]: ...
    async def get_status_view(self, task_id: str) -> Optional[TaskStatusView]: ...
    async def list_task_views(
        self,
        *,
        statuses: list[TaskStatus] | None = None,
        task_kind: str | None = None,
        relation_type: str | None = None,
        relation_entity_id: str | None = None,
        recent_seconds: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TaskListItemView], int]: ...
    async def set_status(self, task_id: str, status: TaskStatus) -> None: ...
    async def set_progress(self, task_id: str, progress: int) -> None: ...
    async def set_result(self, task_id: str, result: dict[str, Any]) -> None: ...
    async def set_error(self, task_id: str, error: str) -> None: ...
    async def set_executor(self, task_id: str, *, executor_type: str, executor_task_id: str | None = None) -> None: ...
    async def request_cancel(self, task_id: str, reason: str | None = None) -> Optional[TaskRecord]: ...
    async def mark_cancelled(self, task_id: str) -> Optional[TaskRecord]: ...
    async def is_cancel_requested(self, task_id: str) -> bool: ...


class InMemoryTaskStore(TaskStore):
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._data: dict[str, TaskRecord] = {}

    async def create(self, payload: dict[str, Any], mode: DeliveryMode, task_kind: str) -> TaskRecord:
        async with self._lock:
            task_id = _new_id()
            ts = _now_ts()
            rec = TaskRecord(
                id=task_id,
                mode=mode,
                task_kind=task_kind,
                status=TaskStatus.pending,
                progress=0,
                payload=payload,
                result=None,
                error="",
                cancel_requested=False,
                created_at_ts=ts,
                updated_at_ts=ts,
            )
            self._data[task_id] = rec
            return rec

    async def get(self, task_id: str) -> Optional[TaskRecord]:
        async with self._lock:
            return self._data.get(task_id)

    async def get_status_view(self, task_id: str) -> Optional[TaskStatusView]:
        async with self._lock:
            rec = self._data.get(task_id)
            if not rec:
                return None
            return TaskStatusView(
                id=rec.id,
                status=rec.status,
                progress=rec.progress,
                result=rec.result,
                error=rec.error,
                cancel_requested=rec.cancel_requested,
                cancel_requested_at_ts=rec.cancel_requested_at_ts,
                started_at_ts=rec.started_at_ts,
                finished_at_ts=rec.finished_at_ts,
                elapsed_ms=rec.elapsed_ms if rec.elapsed_ms is not None else self._elapsed_ms_for_record(rec),
                updated_at_ts=rec.updated_at_ts,
            )

    async def list_task_views(
        self,
        *,
        statuses: list[TaskStatus] | None = None,
        task_kind: str | None = None,
        relation_type: str | None = None,
        relation_entity_id: str | None = None,
        recent_seconds: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TaskListItemView], int]:
        items = [
            TaskListItemView(
                id=rec.id,
                task_kind=rec.task_kind,
                status=rec.status,
                progress=rec.progress,
                cancel_requested=rec.cancel_requested,
                cancel_requested_at_ts=rec.cancel_requested_at_ts,
                started_at_ts=rec.started_at_ts,
                finished_at_ts=rec.finished_at_ts,
                elapsed_ms=rec.elapsed_ms if rec.elapsed_ms is not None else self._elapsed_ms_for_record(rec),
                created_at_ts=rec.created_at_ts,
                updated_at_ts=rec.updated_at_ts,
                executor_type=rec.executor_type,
                executor_task_id=rec.executor_task_id,
            )
            for rec in self._data.values()
        ]
        if statuses:
            allow = set(statuses)
            items = [item for item in items if item.status in allow]
        elif recent_seconds is not None:
            now_ts = _now_ts()
            active = {TaskStatus.pending, TaskStatus.running, TaskStatus.streaming}
            items = [
                item
                for item in items
                if item.status in active
                or ((item.updated_at_ts or item.created_at_ts or 0) >= now_ts - recent_seconds)
            ]
        if task_kind:
            items = [item for item in items if item.task_kind == task_kind]
        items.sort(key=lambda item: item.updated_at_ts or item.created_at_ts or 0, reverse=True)
        total = len(items)
        start = max(0, (page - 1) * page_size)
        return items[start : start + page_size], total

    def _elapsed_ms_for_record(self, rec: TaskRecord) -> int | None:
        if rec.started_at_ts is None:
            return None
        end_ts = rec.finished_at_ts if rec.finished_at_ts is not None else _now_ts()
        return max(0, int((end_ts - rec.started_at_ts) * 1000))

    async def _update(self, task_id: str, **kwargs: Any) -> None:
        async with self._lock:
            rec = self._data.get(task_id)
            if not rec:
                return
            next_status = kwargs.get("status", rec.status)
            now_ts = _now_ts()
            if next_status == TaskStatus.running and rec.started_at_ts is None:
                rec.started_at_ts = now_ts
            if _is_terminal_status(next_status) and rec.finished_at_ts is None:
                rec.finished_at_ts = now_ts
                rec.elapsed_ms = self._elapsed_ms_for_record(rec)
            for k, v in kwargs.items():
                setattr(rec, k, v)
            rec.updated_at_ts = now_ts

    async def set_status(self, task_id: str, status: TaskStatus) -> None:
        await self._update(task_id, status=status)

    async def set_progress(self, task_id: str, progress: int) -> None:
        p = max(0, min(100, int(progress)))
        await self._update(task_id, progress=p)

    async def set_result(self, task_id: str, result: dict[str, Any]) -> None:
        await self._update(task_id, result=result)

    async def set_error(self, task_id: str, error: str) -> None:
        await self._update(task_id, error=error or "")

    async def set_executor(self, task_id: str, *, executor_type: str, executor_task_id: str | None = None) -> None:
        await self._update(task_id, executor_type=executor_type, executor_task_id=executor_task_id)

    async def request_cancel(self, task_id: str, reason: str | None = None) -> Optional[TaskRecord]:
        async with self._lock:
            rec = self._data.get(task_id)
            if not rec:
                return None
            now_ts = _now_ts()
            rec.cancel_requested = True
            rec.cancel_requested_at_ts = now_ts
            rec.cancel_reason = (reason or "").strip()
            if rec.status == TaskStatus.pending:
                rec.status = TaskStatus.cancelled
                rec.cancelled_at_ts = now_ts
                rec.finished_at_ts = rec.finished_at_ts or now_ts
                rec.elapsed_ms = self._elapsed_ms_for_record(rec)
            rec.updated_at_ts = now_ts
            return rec

    async def mark_cancelled(self, task_id: str) -> Optional[TaskRecord]:
        async with self._lock:
            rec = self._data.get(task_id)
            if not rec:
                return None
            now_ts = _now_ts()
            rec.status = TaskStatus.cancelled
            rec.cancel_requested = True
            rec.cancel_requested_at_ts = rec.cancel_requested_at_ts or now_ts
            rec.cancelled_at_ts = now_ts
            rec.finished_at_ts = rec.finished_at_ts or now_ts
            rec.elapsed_ms = self._elapsed_ms_for_record(rec)
            rec.updated_at_ts = now_ts
            return rec

    async def is_cancel_requested(self, task_id: str) -> bool:
        async with self._lock:
            rec = self._data.get(task_id)
            return bool(rec.cancel_requested) if rec else False


class SqlAlchemyTaskStore(TaskStore):
    """基于 SQLAlchemy AsyncSession 的任务存储（MySQL/SQLite 等均可）。"""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, payload: dict[str, Any], mode: DeliveryMode, task_kind: str) -> TaskRecord:
        task_id = _new_id()
        row = GenerationTask(
            id=task_id,
            mode=_to_db_mode(mode),
            task_kind=task_kind,
            status=_to_db_status(TaskStatus.pending),
            progress=0,
            payload=payload,
            result=None,
            error="",
        )
        self.db.add(row)
        await self.db.flush()
        await self.db.refresh(row)
        return _task_record_from_row(row)

    async def get(self, task_id: str) -> Optional[TaskRecord]:
        row = await self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        return _task_record_from_row(row)

    async def get_status_view(self, task_id: str) -> Optional[TaskStatusView]:
        # 轮询高频：只选择必要列，减少 IO 与 ORM 开销
        stmt = (
            select(
                GenerationTask.id,
                GenerationTask.status,
                GenerationTask.progress,
                GenerationTask.result,
                GenerationTask.error,
                GenerationTask.cancel_requested,
                GenerationTask.cancel_requested_at,
                GenerationTask.started_at,
                GenerationTask.finished_at,
                GenerationTask.updated_at,
            )
            .where(GenerationTask.id == task_id)
            .limit(1)
        )
        res = await self.db.execute(stmt)
        row = res.first()
        if not row:
            return None
        updated_at = row.updated_at
        return TaskStatusView(
            id=row.id,
            status=_to_app_status(row.status),
            progress=int(row.progress),
            result=row.result,
            error=row.error or "",
            cancel_requested=bool(row.cancel_requested),
            cancel_requested_at_ts=_datetime_ts(row.cancel_requested_at),
            started_at_ts=_datetime_ts(row.started_at),
            finished_at_ts=_datetime_ts(row.finished_at),
            elapsed_ms=_elapsed_ms_from_datetimes(row.started_at, row.finished_at),
            updated_at_ts=_datetime_ts(updated_at),
        )

    async def list_task_views(
        self,
        *,
        statuses: list[TaskStatus] | None = None,
        task_kind: str | None = None,
        relation_type: str | None = None,
        relation_entity_id: str | None = None,
        recent_seconds: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TaskListItemView], int]:
        # 任务中心只读取 async-polling 的可见任务；文本 SSE hidden run 只能由
        # 实验室专用接口按会话访问，不能因全局列表泄漏到任务中心。
        filters = [GenerationTask.visibility == GenerationTaskVisibility.task_center]
        cutoff_dt: datetime | None = None
        join_links = relation_type is not None or relation_entity_id is not None
        if relation_type is not None:
            filters.append(GenerationTaskLink.relation_type == relation_type)
        if relation_entity_id is not None:
            filters.append(GenerationTaskLink.relation_entity_id == relation_entity_id)
        if statuses:
            filters.append(GenerationTask.status.in_([_to_db_status(x) for x in statuses]))
        elif recent_seconds is not None:
            now = datetime.now(UTC).replace(tzinfo=None)
            active_statuses = [
                _to_db_status(TaskStatus.pending),
                _to_db_status(TaskStatus.running),
                _to_db_status(TaskStatus.streaming),
            ]
            cutoff_dt = datetime.fromtimestamp(now.timestamp() - recent_seconds, tz=UTC).replace(tzinfo=None)
            filters.append(
                or_(
                    GenerationTask.status.in_(active_statuses),
                    GenerationTask.updated_at >= cutoff_dt,
                )
            )
        if task_kind is not None:
            filters.append(GenerationTask.task_kind == task_kind)

        count_stmt = select(
            func.count(func.distinct(GenerationTask.id)) if join_links else func.count(GenerationTask.id)
        )
        if join_links:
            count_stmt = count_stmt.select_from(GenerationTask).join(
                GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id
            )
        else:
            count_stmt = count_stmt.select_from(GenerationTask)
        if filters:
            count_stmt = count_stmt.where(*filters)
        total_res = await self.db.execute(count_stmt)
        total = int(total_res.scalar() or 0)

        id_stmt = select(GenerationTask.id, GenerationTask.updated_at)
        if join_links:
            id_stmt = id_stmt.join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        if filters:
            id_stmt = id_stmt.where(*filters)
        if join_links:
            id_stmt = id_stmt.group_by(GenerationTask.id, GenerationTask.updated_at)
        id_stmt = id_stmt.order_by(GenerationTask.updated_at.desc(), GenerationTask.id.desc())

        id_res = await self.db.execute(id_stmt.offset((page - 1) * page_size).limit(page_size))
        ordered_task_ids = [row.id for row in id_res.all()]
        if not ordered_task_ids:
            return [], total

        task_stmt = select(GenerationTask).where(GenerationTask.id.in_(ordered_task_ids))
        res = await self.db.execute(task_stmt)
        task_map = {task.id: task for task in res.scalars().all()}
        tasks = [task_map[task_id] for task_id in ordered_task_ids if task_id in task_map]
        if not tasks:
            return [], total

        task_ids = [task.id for task in tasks]
        link_stmt = (
            select(GenerationTaskLink)
            .where(GenerationTaskLink.task_id.in_(task_ids))
            .order_by(GenerationTaskLink.updated_at.desc(), GenerationTaskLink.id.desc())
        )
        link_res = await self.db.execute(link_stmt)
        links = list(link_res.scalars().all())
        link_map: dict[str, GenerationTaskLink] = {}
        for link in links:
            link_map.setdefault(link.task_id, link)
        navigation_map = await _resolve_navigation_targets(self.db, link_map=link_map)

        return [
            TaskListItemView(
                id=task.id,
                task_kind=task.task_kind,
                status=_to_app_status(task.status),
                progress=int(task.progress),
                cancel_requested=bool(task.cancel_requested),
                cancel_requested_at_ts=_datetime_ts(task.cancel_requested_at),
                started_at_ts=_datetime_ts(task.started_at),
                finished_at_ts=_datetime_ts(task.finished_at),
                elapsed_ms=_elapsed_ms_from_datetimes(task.started_at, task.finished_at),
                created_at_ts=_datetime_ts(task.created_at),
                updated_at_ts=_datetime_ts(task.updated_at),
                executor_type=task.executor_type,
                executor_task_id=task.executor_task_id,
                relation_type=link_map.get(task.id).relation_type if link_map.get(task.id) else None,
                relation_entity_id=link_map.get(task.id).relation_entity_id if link_map.get(task.id) else None,
                resource_type=link_map.get(task.id).resource_type if link_map.get(task.id) else None,
                navigate_relation_type=navigation_map.get(task.id)[0] if navigation_map.get(task.id) else None,
                navigate_relation_entity_id=navigation_map.get(task.id)[1] if navigation_map.get(task.id) else None,
            )
            for task in tasks
        ], total

    async def _update_columns(self, task_id: str, **kwargs: Any) -> None:
        row = await self.db.get(GenerationTask, task_id)
        if row is None:
            return
        next_status = kwargs.get("status")
        now = datetime.now(UTC).replace(tzinfo=None)
        if next_status == _to_db_status(TaskStatus.running) and row.started_at is None:
            row.started_at = now
        if next_status is not None and _is_terminal_status(_to_app_status(next_status)) and row.finished_at is None:
            row.finished_at = now
        for k, v in kwargs.items():
            setattr(row, k, v)
        await self.db.flush()

    async def set_status(self, task_id: str, status: TaskStatus) -> None:
        await self._update_columns(task_id, status=_to_db_status(status))

    async def set_progress(self, task_id: str, progress: int) -> None:
        p = max(0, min(100, int(progress)))
        await self._update_columns(task_id, progress=p)

    async def set_result(self, task_id: str, result: dict[str, Any]) -> None:
        await self._update_columns(task_id, result=result)

    async def set_error(self, task_id: str, error: str) -> None:
        await self._update_columns(task_id, error=error or "")

    async def set_executor(self, task_id: str, *, executor_type: str, executor_task_id: str | None = None) -> None:
        await self._update_columns(task_id, executor_type=executor_type, executor_task_id=executor_task_id)

    async def request_cancel(self, task_id: str, reason: str | None = None) -> Optional[TaskRecord]:
        row = await self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        now = datetime.now(UTC).replace(tzinfo=None)
        row.cancel_requested = True
        row.cancel_requested_at = now
        row.cancel_reason = (reason or "").strip() or None
        if _to_app_status(row.status) == TaskStatus.pending:
            row.status = _to_db_status(TaskStatus.cancelled)
            row.cancelled_at = now
            row.finished_at = row.finished_at or now
        await self.db.flush()
        await self.db.refresh(row)
        return await self.get(task_id)

    async def mark_cancelled(self, task_id: str) -> Optional[TaskRecord]:
        row = await self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        now = datetime.now(UTC).replace(tzinfo=None)
        row.status = _to_db_status(TaskStatus.cancelled)
        row.cancel_requested = True
        row.cancel_requested_at = row.cancel_requested_at or now
        row.cancelled_at = now
        row.finished_at = row.finished_at or now
        await self.db.flush()
        await self.db.refresh(row)
        return await self.get(task_id)

    async def is_cancel_requested(self, task_id: str) -> bool:
        row = await self.db.get(GenerationTask, task_id)
        return bool(row.cancel_requested) if row is not None else False


class SyncSqlAlchemyTaskStore:
    """给同步 worker 使用的任务存储。"""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, task_id: str) -> Optional[TaskRecord]:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        return _task_record_from_row(row)

    def set_status(self, task_id: str, status: TaskStatus) -> None:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return
        now = datetime.now(UTC).replace(tzinfo=None)
        if status == TaskStatus.running and row.started_at is None:
            row.started_at = now
        if _is_terminal_status(status) and row.finished_at is None:
            row.finished_at = now
        row.status = _to_db_status(status)
        self.db.flush()

    def set_progress(self, task_id: str, progress: int) -> None:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return
        row.progress = max(0, min(100, int(progress)))
        self.db.flush()

    def set_result(self, task_id: str, result: dict[str, Any]) -> None:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return
        row.result = result
        self.db.flush()

    def set_error(self, task_id: str, error: str) -> None:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return
        row.error = error or ""
        self.db.flush()

    def set_executor(self, task_id: str, *, executor_type: str, executor_task_id: str | None = None) -> None:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return
        row.executor_type = executor_type
        row.executor_task_id = executor_task_id
        self.db.flush()

    def request_cancel(self, task_id: str, reason: str | None = None) -> Optional[TaskRecord]:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        now = datetime.now(UTC).replace(tzinfo=None)
        row.cancel_requested = True
        row.cancel_requested_at = now
        row.cancel_reason = (reason or "").strip() or None
        if _to_app_status(row.status) == TaskStatus.pending:
            row.status = _to_db_status(TaskStatus.cancelled)
            row.cancelled_at = now
            row.finished_at = row.finished_at or now
        self.db.flush()
        return self.get(task_id)

    def mark_cancelled(self, task_id: str) -> Optional[TaskRecord]:
        row = self.db.get(GenerationTask, task_id)
        if row is None:
            return None
        now = datetime.now(UTC).replace(tzinfo=None)
        row.status = _to_db_status(TaskStatus.cancelled)
        row.cancel_requested = True
        row.cancel_requested_at = row.cancel_requested_at or now
        row.cancelled_at = now
        row.finished_at = row.finished_at or now
        self.db.flush()
        return self.get(task_id)

    def is_cancel_requested(self, task_id: str) -> bool:
        row = self.db.get(GenerationTask, task_id)
        return bool(row.cancel_requested) if row is not None else False
