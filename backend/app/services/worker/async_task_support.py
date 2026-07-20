"""Async worker 任务的通用辅助函数。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.task_manager import SqlAlchemyTaskStore
from app.models.experiment_sessions import ExperimentMessage


async def cancel_if_requested_async(
    *,
    store: SqlAlchemyTaskStore,
    task_id: str,
    session: AsyncSession,
) -> bool:
    """在 async service 阶段边界执行协作式取消检查。"""

    if not await store.is_cancel_requested(task_id):
        return False
    await store.mark_cancelled(task_id)
    message_row = (await session.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
    if message_row is not None:
        message_row.status = "cancelled"
        message_row.payload = {**message_row.payload, "error": "任务已取消"}
    await session.commit()
    return True
