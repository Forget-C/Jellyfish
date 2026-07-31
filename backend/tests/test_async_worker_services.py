"""遗留通用 async TaskStore 领取语义测试。

图片和视频已迁移到 GenerationRun；这里仅覆盖仍被文本/脚本任务使用的通用领取门禁。
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import DeliveryMode


@pytest.mark.asyncio
async def test_claim_pending_allows_only_one_worker(tmp_path) -> None:
    """通用任务的重复领取只能有一个执行者成功。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'claim-pending.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(payload={}, mode=DeliveryMode.async_polling, task_kind="script_divide")
        assert await store.claim_pending(task.id)
        assert not await store.claim_pending(task.id)
    await engine.dispose()


@pytest.mark.asyncio
async def test_claim_pending_rejects_cancel_intent(tmp_path) -> None:
    """已登记取消的通用任务不得再被旧执行器领取。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cancel-intent.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(payload={}, mode=DeliveryMode.async_polling, task_kind="script_divide")
        await store.request_cancel_intent(task.id, "用户取消")
        assert not await store.claim_pending(task.id)
    await engine.dispose()
