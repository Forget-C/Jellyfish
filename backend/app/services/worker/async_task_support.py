"""Async worker 任务的通用辅助函数。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.task_manager import SqlAlchemyTaskStore
from app.models.experiment_sessions import ExperimentMessage
from app.services.generation.runtime.finalizer import TaskFinalizer


async def cancel_if_requested_async(
    *,
    store: SqlAlchemyTaskStore,
    task_id: str,
    session: AsyncSession,
    operation: GenerationOperation | None = None,
    snapshot: ResolvedGenerationSnapshot | None = None,
) -> bool:
    """在 async 阶段边界收口取消，并兼容尚未迁移的历史任务。"""

    if not await store.is_cancel_requested(task_id):
        return False
    if operation is not None and snapshot is not None:
        await TaskFinalizer().finalize_cancelled(
            db=session,
            store=store,
            task_id=task_id,
            operation=operation,
            snapshot=snapshot,
        )
        await session.commit()
        return True

    # 旧 payload 在快照解析失败前也必须能取消；待所有历史执行器退役后删除
    # 此兼容分支，统一改由 WorkflowHandler 处理领域投影。
    await store.mark_cancelled(task_id)
    message_row = (await session.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
    if message_row is not None:
        message_row.status = "cancelled"
        message_row.payload = {**message_row.payload, "error": "任务已取消"}
    await session.commit()
    return True
