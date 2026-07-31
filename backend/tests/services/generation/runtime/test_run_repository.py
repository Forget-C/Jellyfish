"""GenerationRunRepository 的执行尝试与 fencing 基础测试。"""

from __future__ import annotations

import pytest
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.task import GenerationTask, GenerationTaskStatus, GenerationDeliveryMode, GenerationTaskVisibility
from app.models.generation_runs import GenerationRun
from app.services.generation.runtime.run_repository import GenerationRunRepository


@pytest.mark.asyncio
async def test_create_deduplicates_active_attempt_and_claim_once(tmp_path) -> None:
    """同一任务只能保留一个 active Run，queued run 只能被一个 owner 领取。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'runs.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="image_generation", status=GenerationTaskStatus.pending, payload={}))
        await db.flush()
        repo = GenerationRunRepository(db)
        first = await repo.create_queued(task_id="task-1")
        second = await repo.create_queued(task_id="task-1")
        assert (first.id, second.id, first.attempt_no) == (second.id, first.id, 1)
        assert await repo.claim(run_id=first.id, owner="worker-a", ttl_seconds=30) == 1
        assert await repo.claim(run_id=first.id, owner="worker-b", ttl_seconds=30) is None
        assert await repo.begin_execution(run_id=first.id, owner="worker-a", lease_epoch=1)
        assert await repo.record_provider_accepted(
            run_id=first.id,
            owner="worker-a",
            lease_epoch=1,
            provider_task_id="provider-job-1",
        )
        assert not await repo.record_provider_accepted(
            run_id=first.id,
            owner="worker-a",
            lease_epoch=1,
            provider_task_id="provider-job-2",
        )
        assert (await db.get(GenerationRun, first.id)).provider_task_id == "provider-job-1"  # type: ignore[union-attr]
    await engine.dispose()


@pytest.mark.asyncio
async def test_heartbeat_accepts_only_current_unexpired_lease(tmp_path) -> None:
    """续租必须同时匹配 owner、epoch 与未过期 lease，旧执行者无副作用。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'heartbeats.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="image_generation", status=GenerationTaskStatus.pending, payload={}))
        await db.flush()
        repo = GenerationRunRepository(db)
        run = await repo.create_queued(task_id="task-1")
        assert await repo.claim(run_id=run.id, owner="worker-a", ttl_seconds=30) == 1
        assert await repo.heartbeat(run_id=run.id, owner="worker-a", lease_epoch=1, ttl_seconds=60)
        assert not await repo.heartbeat(run_id=run.id, owner="worker-a", lease_epoch=2, ttl_seconds=60)

        await db.execute(
            update(GenerationRun)
            .where(GenerationRun.id == run.id)
            .values(lease_expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1))
        )
        await db.flush()
        assert not await repo.heartbeat(run_id=run.id, owner="worker-a", lease_epoch=1, ttl_seconds=60)
    await engine.dispose()


@pytest.mark.asyncio
async def test_requeue_expired_run_fences_old_epoch_and_allows_reclaim(tmp_path) -> None:
    """reaper 回收过期 Run 后，重新领取必须产生更高 epoch。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'reaper.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="image_generation", status=GenerationTaskStatus.pending, payload={}))
        await db.flush()
        repo = GenerationRunRepository(db)
        run = await repo.create_queued(task_id="task-1")
        assert await repo.claim(run_id=run.id, owner="worker-a", ttl_seconds=30) == 1
        await repo.begin_execution(run_id=run.id, owner="worker-a", lease_epoch=1)
        await db.execute(
            update(GenerationRun)
            .where(GenerationRun.id == run.id)
            .values(lease_expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1))
        )

        assert await repo.requeue_expired(limit=10) == [run.id]
        recovered = await db.get(GenerationRun, run.id)
        assert recovered is not None
        await db.refresh(recovered)
        assert recovered.status == "queued" and recovered.lease_epoch == 2
        assert not await repo.heartbeat(run_id=run.id, owner="worker-a", lease_epoch=1, ttl_seconds=30)
        assert await repo.claim(run_id=run.id, owner="worker-b", ttl_seconds=30) == 3
    await engine.dispose()
