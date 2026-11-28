"""实验室消息的统一创建与会话内顺序分配服务。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import ImageGenerationOperationInput, VideoGenerationOperationInput
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import Task


def epoch_ms(value: datetime | None) -> int | None:
    """Normalize persisted UTC datetimes for comparisons across task and message records."""
    if value is None:
        return None
    return int((value if value.tzinfo else value.replace(tzinfo=UTC)).timestamp() * 1000)


def turn_timing(origin):
    """Record durable admission and terminal timestamps for a laboratory turn."""
    accepted = origin.payload.get('accepted_at_ms') if origin else None
    finished = epoch_ms(datetime.now(UTC))
    if accepted is None or finished < accepted:
        return {}
    return {'turn_timing': {'accepted_at_ms': accepted, 'finished_at_ms': finished}}


@dataclass(frozen=True, slots=True)
class ExperimentMessageDraft:
    """描述一条待持久化的实验室消息，由服务端统一补齐 ID 与顺序。"""

    role: str
    content: str = ""
    status: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    task_id: str | None = None


def experiment_user_message(
    *, prompt: str, model_id: str | None,
    media: ImageMediaInput | VideoMediaInput | None = None,
    operation_input: ImageGenerationOperationInput | VideoGenerationOperationInput | None = None,
) -> ExperimentMessageDraft:
    """冻结用户可编辑的输入，供实验历史回填。"""
    snapshot: dict[str, Any] = {"version": 1, "prompt": prompt, "model_id": model_id}
    if media is not None:
        snapshot["media"] = media.model_dump(mode="json")
    if operation_input is not None:
        snapshot["operation_input"] = operation_input.model_dump(mode="json")
    return ExperimentMessageDraft(role="user", content=prompt, payload={"input_snapshot": snapshot})


def task_message_display_payload(*, modality: str) -> dict[str, Any]:
    """构造异步任务消息的初始展示投影，不复制任务请求快照。

    任务消息只保存模态标签，状态与结果读取时从任务记录获取。
    """

    return {"modality": modality}


async def read_experiment_messages(
    db: AsyncSession, messages: Sequence[ExperimentMessage], *, include_media_receipts: bool = False,
) -> list["ExperimentMessageRead"]:
    """读时批量合成任务状态与结果，消息行不保存异步生命周期副本。"""
    from app.schemas.studio.experiment_sessions import ExperimentMessageRead
    from app.services.task_queries import TaskQueries

    task_ids = [message.task_id for message in messages if message.task_id]
    owners = dict((await db.execute(select(Task.id, Task.target_id).where(
        Task.id.in_(task_ids), Task.target_type == "experiment_session",
    ))).all()) if task_ids else {}
    task_ids = {message.task_id for message in messages if owners.get(message.task_id) == message.session_id}
    tasks = await TaskQueries(db).results(list(task_ids))
    from app.services.studio.media_receipts import media_task_receipts
    receipts = await media_task_receipts(db, tasks) if include_media_receipts else {}
    result = []
    for message in messages:
        view = ExperimentMessageRead.model_validate(message)
        if view.payload and (partial := view.payload.get('_stream_partial')):
            view.payload = {key: value for key, value in view.payload.items() if key != '_stream_partial'}
            view.payload['partial_text'] = ''.join(chunk for _, chunk in partial)
        if message.task_id:
            task = tasks.get(message.task_id) if owners.get(message.task_id) == message.session_id else None
            payload = task_message_display_payload(modality=str((message.payload or {}).get("modality") or "generation"))
            if turn_id := (message.payload or {}).get('turn_id'):
                payload['turn_id'] = turn_id
            if task is not None:
                if source_file_id := (message.payload or {}).get('source_file_id'):
                    payload['source_file_id'] = source_file_id
                payload.update(progress=task.progress, outputs=[item.model_dump() for item in task.outputs])
                if task.generation_delivery is not None:
                    payload["result"] = task.generation_delivery.model_dump(mode="json")
                elif task.result is not None:
                    payload["result"] = task.result
                if task.error:
                    payload["error"] = task.error
                view = view.model_copy(update={"status": task.status.value, "payload": payload,
                                              "media_receipt": receipts.get(message.task_id)})
            else:
                view = view.model_copy(update={"status": None, "payload": {**payload, "error": "关联任务不存在"}})
        result.append(view)
    return result


async def read_experiment_page(db: AsyncSession, session_id: str, page: int, page_size: int, *, include_media_receipts: bool = False):
    """Return the selected page of history in display order, including task projections."""
    rows = (await db.scalars(select(ExperimentMessage).where(
        ExperimentMessage.session_id == session_id,
    ).order_by(ExperimentMessage.sequence.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    return await read_experiment_messages(db, list(reversed(rows)), include_media_receipts=include_media_receipts)


async def has_active_experiment_tasks(db: AsyncSession, session_id: str) -> bool:
    """直接按任务唯一来源查询活动状态，不依赖展示消息是否存在。"""
    return await db.scalar(select(Task.id).where(
        Task.target_type == "experiment_session", Task.target_id == session_id,
        Task.status.in_(["queued", "running"]),
    ).limit(1)) is not None


async def reserve_message_sequences(
    db: AsyncSession,
    *,
    session_id: str,
    count: int,
) -> list[int]:
    """原子预留会话内连续消息序号，避免并发写入时出现重复顺序。

    先执行数据库原子自增，再读取当前事务可见的新计数值。数据库会对同一
    会话行的 UPDATE 串行化，因此多个提交不会像 ``max(sequence) + 1`` 那样
    读取到相同起点。
    """

    if count < 1:
        raise ValueError("count must be greater than zero")

    result = await db.execute(
        update(ExperimentSession)
        .where(ExperimentSession.id == session_id)
        .values(message_sequence=ExperimentSession.message_sequence + count)
    )
    if result.rowcount != 1:
        raise LookupError(f"Experiment session not found: {session_id}")

    end_sequence = await db.scalar(
        select(ExperimentSession.message_sequence).where(ExperimentSession.id == session_id)
    )
    if end_sequence is None:
        raise LookupError(f"Experiment session not found: {session_id}")
    start_sequence = end_sequence - count + 1
    return list(range(start_sequence, end_sequence + 1))


async def append_experiment_messages(
    db: AsyncSession,
    *,
    session_id: str,
    drafts: Sequence[ExperimentMessageDraft],
) -> list[ExperimentMessage]:
    """按输入顺序创建消息，并为整批消息一次性预留连续服务端序号。"""

    if not drafts:
        return []

    sequences = await reserve_message_sequences(db, session_id=session_id, count=len(drafts))
    messages = [
        ExperimentMessage(
            id=uuid.uuid4().hex,
            session_id=session_id,
            sequence=sequence,
            role=draft.role,
            content=draft.content,
            status=None if draft.task_id or draft.role == "task" else draft.status,
            payload=dict(draft.payload),
            task_id=draft.task_id,
        )
        for sequence, draft in zip(sequences, drafts, strict=True)
    ]
    db.add_all(messages)
    return messages


__all__ = [
    "ExperimentMessageDraft",
    "append_experiment_messages",
    "experiment_user_message",
    "read_experiment_messages",
    "reserve_message_sequences",
    "task_message_display_payload",
]
