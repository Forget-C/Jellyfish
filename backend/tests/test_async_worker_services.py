"""唯一任务服务的领取与取消门禁。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.services.task_service import TaskService


@pytest.mark.asyncio
async def test_claim_pending_allows_only_one_worker(tmp_path) -> None:
    """通用任务的重复领取只能有一个执行者成功。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'claim-pending.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        store = TaskService(db)
        task = await store.submit(snapshot={}, kind="directing_divide")
        assert await store.claim(task.id, worker_id="worker")
        assert not await store.claim(task.id, worker_id="worker")
    await engine.dispose()


@pytest.mark.asyncio
async def test_claim_pending_rejects_cancel_intent(tmp_path) -> None:
    """已登记取消的通用任务不得再被旧执行器领取。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cancel-intent.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        store = TaskService(db)
        task = await store.submit(snapshot={}, kind="directing_divide")
        await store.request_cancel(task.id, reason="用户取消")
        assert not await store.claim(task.id, worker_id="worker")
    await engine.dispose()
