"""GenerationRun 的执行尝试与 lease 持久化入口。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.generation_runs import GenerationRun
from app.models.task import GenerationTask


class GenerationRunRepository:
    """创建、领取与续租执行尝试；供后续 Executor/Coordinator 复用。"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create_queued(self, *, task_id: str) -> GenerationRun:
        """为任务创建下一次 queued 尝试，且不与已有有效尝试并存。

        锁定 Task 行使同一任务的 attempt 分配在支持行锁的数据库上串行化；
        迁移期不会由 Worker 直接调用本方法，因此尚未接入的旧执行器不受影响。
        """
        await self._db.execute(
            select(GenerationTask.id).where(GenerationTask.id == task_id).with_for_update()
        )
        active = (
            await self._db.execute(
                select(GenerationRun)
                .where(
                    GenerationRun.task_id == task_id,
                    GenerationRun.status.in_(("queued", "claimed", "executing", "terminalizing")),
                )
                .order_by(GenerationRun.attempt_no.desc())
            )
        ).scalars().first()
        if active is not None:
            return active
        attempt_no = int((await self._db.scalar(select(func.coalesce(func.max(GenerationRun.attempt_no), 0)).where(GenerationRun.task_id == task_id))) or 0) + 1
        run_id = uuid4().hex
        run = GenerationRun(
            id=run_id,
            task_id=task_id,
            attempt_no=attempt_no,
            status="queued",
            provider_idempotency_key=f"generation-run:{run_id}",
        )
        self._db.add(run)
        await self._db.flush()
        return run

    async def claim(self, *, run_id: str, owner: str, ttl_seconds: int) -> int | None:
        """原子领取 queued run，返回新的 fencing epoch；失败返回 None。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(GenerationRun)
            .where(GenerationRun.id == run_id, GenerationRun.status == "queued")
            .values(
                status="claimed", lease_owner=owner, lease_epoch=GenerationRun.lease_epoch + 1,
                lease_expires_at=now + timedelta(seconds=ttl_seconds), heartbeat_at=now, started_at=now,
            )
            .returning(GenerationRun.lease_epoch)
        )
        await self._db.flush()
        return updated.scalar_one_or_none()

    async def heartbeat(self, *, run_id: str, owner: str, lease_epoch: int, ttl_seconds: int) -> bool:
        """仅允许当前 lease 持有者续租，拒绝过期或旧 epoch 的执行者。"""
        now = datetime.now(UTC).replace(tzinfo=None)
        updated = await self._db.execute(
            update(GenerationRun)
            .where(
                GenerationRun.id == run_id,
                GenerationRun.lease_owner == owner,
                GenerationRun.lease_epoch == lease_epoch,
                GenerationRun.status.in_(("claimed", "executing")),
                GenerationRun.lease_expires_at > now,
            )
            .values(
                heartbeat_at=now,
                lease_expires_at=now + timedelta(seconds=ttl_seconds),
            )
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def begin_execution(self, *, run_id: str, owner: str, lease_epoch: int) -> bool:
        """将已领取的 Run 置为执行中，拒绝不匹配的 owner 或旧 epoch。"""
        updated = await self._db.execute(
            update(GenerationRun)
            .where(
                GenerationRun.id == run_id,
                GenerationRun.status == "claimed",
                GenerationRun.lease_owner == owner,
                GenerationRun.lease_epoch == lease_epoch,
            )
            .values(status="executing")
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def record_provider_accepted(self, *, run_id: str, owner: str, lease_epoch: int, provider_task_id: str) -> bool:
        """在供应商已受理后立即写入任务 ID，使重启路径只轮询、不重复创建。"""
        updated = await self._db.execute(
            update(GenerationRun)
            .where(
                GenerationRun.id == run_id,
                GenerationRun.status == "executing",
                GenerationRun.lease_owner == owner,
                GenerationRun.lease_epoch == lease_epoch,
                GenerationRun.provider_task_id.is_(None),
            )
            .values(provider_task_id=provider_task_id)
        )
        await self._db.flush()
        return bool(updated.rowcount)

    async def requeue_expired(self, *, limit: int) -> list[str]:
        """回收 lease 已过期的 Run，使下一次领取递增 epoch 后安全重试。

        旧执行者的 callback 在 Run 重新变为 queued 后已不再匹配活跃状态；新的
        Executor 领取时会递增 epoch，因而其迟到 callback 无法影响新执行尝试。
        """
        if limit <= 0:
            return []
        now = datetime.now(UTC).replace(tzinfo=None)
        candidates = list(
            (
                await self._db.scalars(
                    select(GenerationRun.id)
                    .where(
                        GenerationRun.status.in_(("claimed", "executing")),
                        GenerationRun.lease_expires_at.is_not(None),
                        GenerationRun.lease_expires_at <= now,
                    )
                    .order_by(GenerationRun.lease_expires_at, GenerationRun.id)
                    .limit(limit)
                )
            )
        )
        recovered: list[str] = []
        for run_id in candidates:
            updated = await self._db.execute(
                update(GenerationRun)
                .where(
                    GenerationRun.id == run_id,
                    GenerationRun.status.in_(("claimed", "executing")),
                    GenerationRun.lease_expires_at.is_not(None),
                    GenerationRun.lease_expires_at <= now,
                )
                .values(
                    status="queued",
                    lease_owner=None,
                    lease_epoch=GenerationRun.lease_epoch + 1,
                    lease_expires_at=None,
                    heartbeat_at=None,
                    error="lease_expired_requeued",
                )
            )
            if updated.rowcount:
                recovered.append(run_id)
        await self._db.flush()
        return recovered


__all__ = ["GenerationRunRepository"]
