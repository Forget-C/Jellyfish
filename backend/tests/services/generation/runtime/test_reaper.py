"""GenerationRunReaper 的持久化恢复投递测试。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime.reaper import GenerationRunReaper
from app.services.generation.runtime.run_repository import GenerationRunRepository


@pytest.mark.asyncio
async def test_reaper_persists_pending_dispatch_with_recovered_run(tmp_path) -> None:
    """恢复 Run 与 pending dispatch 必须在同一事务可见，避免提交后直接投递丢失。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'reaper-dispatch.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="image_generation", status=GenerationTaskStatus.pending, payload={}))
        await db.flush()
        repository = GenerationRunRepository(db)
        run = await repository.create_queued(task_id="task-1")
        assert await repository.claim(run_id=run.id, owner="worker-a", ttl_seconds=30) == 1
        assert await repository.begin_execution(run_id=run.id, owner="worker-a", lease_epoch=1)
        await db.execute(update(GenerationRun).where(GenerationRun.id == run.id).values(lease_expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)))

        assert await GenerationRunReaper(db).reap_expired(limit=10) == 1
        dispatch = await db.scalar(select(GenerationRunDispatch))
        assert dispatch is not None
        assert (dispatch.task_id, dispatch.generation_run_id, dispatch.lease_epoch, dispatch.source, dispatch.status) == ("task-1", run.id, 2, "reaper", "pending")
    await engine.dispose()
