"""通用 ExecutionAttempt 仓储 facade。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.execution_attempt import ExecutionAttempt
from app.services.generation.runtime.run_repository import GenerationRunRepository


class ExecutionAttemptRepository:
    """以中立术语暴露 Attempt 的 lease、fencing 与恢复控制面。

    当前实现委托给 ``GenerationRunRepository``，避免在 Artifact 和 dispatch 已经
    依赖 ``generation_runs`` 时创建第二套状态表。媒体专属 Provider checkpoint 仍由
    原仓储保留，P2 将迁移到 ProviderOperation。
    """

    def __init__(self, db: AsyncSession) -> None:
        """绑定单次事务，并复用现有经过验证的 Run 条件更新。"""
        self._delegate = GenerationRunRepository(db)

    async def create_queued(self, *, task_id: str) -> ExecutionAttempt:
        """为 durable Task 创建或复用唯一有效 Attempt。"""
        return await self._delegate.create_queued(task_id=task_id)

    async def claim(self, *, attempt_id: str, owner: str, ttl_seconds: int) -> int | None:
        """原子领取 queued Attempt，返回新的 fencing epoch。"""
        return await self._delegate.claim(run_id=attempt_id, owner=owner, ttl_seconds=ttl_seconds)

    async def heartbeat(self, *, attempt_id: str, owner: str, lease_epoch: int, ttl_seconds: int) -> bool:
        """仅为当前 owner/epoch 续租，拒绝过期或被接管的执行者。"""
        return await self._delegate.heartbeat(
            run_id=attempt_id,
            owner=owner,
            lease_epoch=lease_epoch,
            ttl_seconds=ttl_seconds,
        )

    async def begin_execution(self, *, attempt_id: str, owner: str, lease_epoch: int) -> bool:
        """将已领取 Attempt 切换为 executing。"""
        return await self._delegate.begin_execution(
            run_id=attempt_id,
            owner=owner,
            lease_epoch=lease_epoch,
        )

    async def requeue_expired(self, *, limit: int) -> list[str]:
        """回收过期 Attempt，保留既有 epoch 接管语义。"""
        return await self._delegate.requeue_expired(limit=limit)


__all__ = ["ExecutionAttemptRepository"]
