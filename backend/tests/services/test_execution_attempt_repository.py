"""中立 ExecutionAttempt facade 的兼容存储测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.execution_attempt import ExecutionAttempt
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.execution_attempt_repository import ExecutionAttemptRepository


@pytest.mark.asyncio
async def test_execution_attempt_facade_reuses_generation_run_storage(tmp_path) -> None:
    """P1 不创建第二张状态表，Attempt facade 必须复用既有 fencing 存储。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'execution-attempt.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(
            GenerationTask(
                id="task-1",
                mode=GenerationDeliveryMode.async_polling,
                visibility=GenerationTaskVisibility.task_center,
                task_kind="image_generation",
                status=GenerationTaskStatus.pending,
                payload={},
            )
        )
        await db.flush()

        attempts = ExecutionAttemptRepository(db)
        attempt: ExecutionAttempt = await attempts.create_queued(task_id="task-1")
        assert isinstance(attempt, GenerationRun)
        assert await attempts.claim(attempt_id=attempt.id, owner="worker-a", ttl_seconds=30) == 1
        assert await attempts.begin_execution(attempt_id=attempt.id, owner="worker-a", lease_epoch=1)
        assert await attempts.heartbeat(attempt_id=attempt.id, owner="worker-a", lease_epoch=1, ttl_seconds=30)
    await engine.dispose()
