"""GenerationExecutor 的 Run 领取与重复投递防护测试。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.generation import (
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.db import Base
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime.executor import GenerationExecutor


def _snapshot() -> ResolvedGenerationSnapshot:
    """构造可由图片 Worker 复用的最小冻结快照。"""

    return ResolvedGenerationSnapshot(
        model_id="model-1",
        canonical_target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id="session-1"),
        operation_input=ImageGenerationOperationInput(),
        execution_prompt="一只水母",
    )


@pytest.mark.asyncio
async def test_claim_command_creates_single_executing_run_and_rejects_redelivery(tmp_path) -> None:
    """同一 Task 的重复调度只能产生一条携带 epoch 的执行命令。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'executor.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        snapshot = _snapshot()
        db.add(
            GenerationTask(
                id="task-1",
                mode=GenerationDeliveryMode.async_polling,
                visibility=GenerationTaskVisibility.task_center,
                task_kind="image_generation",
                status=GenerationTaskStatus.pending,
                payload={"snapshot": snapshot.model_dump(mode="json")},
            )
        )
        await db.flush()

        executor = GenerationExecutor(db)
        command = await executor.claim_command(
            task_id="task-1",
            owner="executor-a",
            lease_ttl_seconds=30,
            work_id="celery-work-1",
        )
        duplicate = await executor.claim_command(
            task_id="task-1",
            owner="executor-b",
            lease_ttl_seconds=30,
            work_id="celery-work-2",
        )

        run = await db.get(GenerationRun, command.run_id if command else "")
        task = await db.get(GenerationTask, "task-1")
        assert command is not None
        assert command.lease_epoch == 1
        assert command.task_id == "task-1"
        assert command.snapshot == snapshot
        assert duplicate is None
        assert run is not None and run.status == "executing" and run.lease_owner == "executor-a"
        assert task is not None and task.status == GenerationTaskStatus.running
        dispatch = await db.get(GenerationRunDispatch, "celery-work-1")
        assert dispatch is not None
        assert (dispatch.task_id, dispatch.generation_run_id, dispatch.lease_epoch, dispatch.status) == (
            "task-1",
            command.run_id,
            1,
            "claimed",
        )
        duplicate_dispatch = await db.get(GenerationRunDispatch, "celery-work-2")
        assert duplicate_dispatch is not None
        assert (duplicate_dispatch.status, duplicate_dispatch.error) == ("ignored", "run_not_queued")
    await engine.dispose()


@pytest.mark.asyncio
async def test_claim_command_returns_cancelled_command_for_cancel_intent(tmp_path) -> None:
    """取消意图也必须取得 Run，供 Coordinator 唯一写入 cancelled 终态。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cancelled-executor.db'}")
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
                cancel_requested=True,
                payload={"snapshot": _snapshot().model_dump(mode="json")},
            )
        )
        await db.flush()

        command = await GenerationExecutor(db).claim_command(task_id="task-1", owner="executor-a", lease_ttl_seconds=30)
        assert command is not None and command.cancel_requested
        assert await db.scalar(select(GenerationRun.id)) == command.run_id
        task = await db.get(GenerationTask, "task-1")
        assert task is not None and task.status == GenerationTaskStatus.running
    await engine.dispose()
