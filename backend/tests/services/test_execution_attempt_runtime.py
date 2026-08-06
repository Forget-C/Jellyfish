"""通用 Attempt terminal fencing 协调器测试。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.execution_attempt import (
    ExecutionAttemptCallback,
    ExecutionAttemptCallbackKind,
    ExecutionAttemptLease,
)
from app.core.db import Base
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.execution_attempt_repository import ExecutionAttemptRepository
from app.services.execution_attempt_runtime import (
    AttemptCallbackDisposition,
    AttemptTerminalCoordinator,
    DeliveryContext,
    DriverExecution,
    TaskExecutionCommand,
)


class _ResultHandler:
    """最小领域投影替身，验证 Coordinator 而非 Driver 写 Task 终态。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, object]:
        """投影成功输出为稳定 Task result。"""
        return {"outcome": "succeeded", "text": str(context.output)}

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, object]:
        """投影失败摘要。"""
        return {"outcome": "failed", "error": context.error}

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, object]:
        """投影取消摘要。"""
        return {"outcome": "cancelled", "error": context.error}


@pytest.mark.asyncio
async def test_attempt_terminal_coordinator_fences_stale_and_duplicate_callbacks(tmp_path) -> None:
    """同 epoch 首次 callback 可终态化，重复和旧 epoch 必须零写权限。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'attempt-terminal.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(
            GenerationTask(
                id="task-1",
                mode=GenerationDeliveryMode.async_polling,
                visibility=GenerationTaskVisibility.task_center,
                task_kind="script_consistency",
                status=GenerationTaskStatus.running,
                payload={},
            )
        )
        await db.flush()
        attempts = ExecutionAttemptRepository(db)
        attempt = await attempts.create_queued(task_id="task-1")
        assert await attempts.claim(attempt_id=attempt.id, owner="worker-a", ttl_seconds=30) == 1
        assert await attempts.begin_execution(attempt_id=attempt.id, owner="worker-a", lease_epoch=1)

        callback = ExecutionAttemptCallback(
            attempt_id=attempt.id,
            lease_epoch=1,
            kind=ExecutionAttemptCallbackKind.succeeded,
        )
        coordinator = AttemptTerminalCoordinator()
        assert await coordinator.disposition(db=db, callback=callback) is AttemptCallbackDisposition.accepted
        assert await coordinator.disposition(db=db, callback=callback) is AttemptCallbackDisposition.ignored_duplicate
        assert await coordinator.disposition(
            db=db,
            callback=callback.model_copy(update={"lease_epoch": 2}),
        ) is AttemptCallbackDisposition.ignored_stale
    await engine.dispose()


@pytest.mark.asyncio
async def test_attempt_terminal_coordinator_writes_task_once_after_delivery(tmp_path) -> None:
    """成功交付与 Task/Attempt 终态必须在同一 fencing 事务中完成。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'attempt-delivery.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        task = GenerationTask(
            id="task-1",
            mode=GenerationDeliveryMode.async_polling,
            visibility=GenerationTaskVisibility.task_center,
            task_kind="text_chat",
            status=GenerationTaskStatus.running,
            payload={},
        )
        db.add(task)
        await db.flush()
        attempts = ExecutionAttemptRepository(db)
        attempt = await attempts.create_queued(task_id=task.id)
        assert await attempts.claim(attempt_id=attempt.id, owner="worker-a", ttl_seconds=30) == 1
        assert await attempts.begin_execution(attempt_id=attempt.id, owner="worker-a", lease_epoch=1)
        command = TaskExecutionCommand(
            lease=ExecutionAttemptLease(
                attempt_id=attempt.id,
                task_id=task.id,
                lease_epoch=1,
                lease_owner="worker-a",
                lease_ttl_seconds=30,
            ),
            task_kind="text_chat",
            snapshot={},
            cancel_requested=False,
        )
        execution = DriverExecution(
            callback=ExecutionAttemptCallback(
                attempt_id=attempt.id,
                lease_epoch=1,
                kind=ExecutionAttemptCallbackKind.succeeded,
            ),
            output="hello",
        )

        assert await AttemptTerminalCoordinator().terminalize(
            db=db,
            command=command,
            execution=execution,
            handler=_ResultHandler(),
        ) is AttemptCallbackDisposition.accepted
        await db.refresh(task)
        await db.refresh(attempt)
        assert task.status == GenerationTaskStatus.succeeded
        assert task.result == {"outcome": "succeeded", "text": "hello"}
        assert attempt.status == "terminal"
        assert attempt.finished_at is not None
    await engine.dispose()
