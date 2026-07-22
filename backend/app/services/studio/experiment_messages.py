"""实验室消息的统一创建与会话内顺序分配服务。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.experiment_sessions import ExperimentMessage, ExperimentSession


@dataclass(frozen=True, slots=True)
class ExperimentMessageDraft:
    """描述一条待持久化的实验室消息，由服务端统一补齐 ID 与顺序。"""

    role: str
    content: str = ""
    status: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    task_id: str | None = None


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
            status=draft.status,
            payload=dict(draft.payload),
            task_id=draft.task_id,
        )
        for sequence, draft in zip(sequences, drafts, strict=True)
    ]
    db.add_all(messages)
    return messages


__all__ = ["ExperimentMessageDraft", "append_experiment_messages", "reserve_message_sequences"]
