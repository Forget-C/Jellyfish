"""GenerationLifecycleCoordinator 的 callback fencing 与终态收口测试。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.generation import (
    GenerationOperation,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.generation_delivery import GenerationDeliveryResult, GenerationOutcome
from app.core.contracts.generation_run import GenerationWorkerCallback, GenerationWorkerCallbackKind
from app.core.contracts.image_generation import ImageGenerationResult, ImageItem
from app.core.db import Base
from app.models.generation_artifacts import GenerationArtifact
from app.models.generation_runs import GenerationRun
from app.models.media_blobs import MediaBlob, StorageOperationOutbox
from app.models.provider_operations import ProviderOperation
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.runtime.coordinator import GenerationCallbackDisposition, GenerationLifecycleCoordinator
from app.services.generation.runtime.finalizer import TaskFinalizer
from app.services.generation.runtime.media_delivery import MediaDeliveryCoordinator
from app.services.generation.workflows.base import (
    GenerationWorkflowExecutionContext,
    GenerationWorkflowKey,
    GenerationWorkflowSubmissionContext,
    GenerationWorkflowTerminalContext,
)
from app.services.generation.workflows.registry import GenerationWorkflowRegistry


class _Handler:
    """记录终态调用次数的最小 WorkflowHandler 测试替身。"""

    key = GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.experiment_session)

    def __init__(self) -> None:
        """初始化可观察的终态调用记录。"""
        self.calls: list[str] = []

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:  # noqa: ARG002
        """本测试只覆盖终态协调。"""

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:  # noqa: ARG002
        """本测试只覆盖终态协调。"""

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:  # noqa: ARG002
        """记录成功投影并返回稳定交付结果。"""
        self.calls.append("success")
        return GenerationDeliveryResult(outcome=GenerationOutcome.succeeded)

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """记录失败投影。"""
        self.calls.append("failed")

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """记录取消投影。"""
        self.calls.append("cancelled")


def _snapshot() -> ResolvedGenerationSnapshot:
    """构造实验室图片任务的可信执行快照。"""

    return ResolvedGenerationSnapshot(
        model_id="model-1",
        canonical_target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id="session-1"),
        operation_input=ImageGenerationOperationInput(),
        execution_prompt="一只水母",
    )


def _coordinator(handler: _Handler) -> GenerationLifecycleCoordinator:
    """以受控 Handler 构造 Coordinator，隔离真实领域投影。"""

    return GenerationLifecycleCoordinator(finalizer=_finalizer(handler))


def _finalizer(handler: _Handler) -> TaskFinalizer:
    """为媒体终态测试构造只包含记录 Handler 的 Finalizer。"""

    registry = GenerationWorkflowRegistry(supported_keys=[handler.key])
    registry.register(handler)  # type: ignore[arg-type]
    return TaskFinalizer(workflow_registry=registry)


async def _seed(db: AsyncSession, *, epoch: int = 1) -> None:
    """写入处于 executing 状态且可接收 callback 的最小 Task/Run 对。"""

    db.add(
        GenerationTask(
            id="task-1",
            mode=GenerationDeliveryMode.async_polling,
            visibility=GenerationTaskVisibility.task_center,
            task_kind="image_generation",
            status=GenerationTaskStatus.running,
            payload={"snapshot": _snapshot().model_dump(mode="json")},
        )
    )
    db.add(
        GenerationRun(
            id="run-1",
            task_id="task-1",
            attempt_no=1,
            status="executing",
            lease_owner="worker-1",
            lease_epoch=epoch,
        )
    )
    await db.flush()


@pytest.mark.asyncio
async def test_provider_success_stages_blob_outbox_before_task_terminalization(tmp_path) -> None:
    """媒体 callback 只能登记交付意图，不能在 Coordinator 中上传或提前完成 Task。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'staged-media.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        await _seed(db)
        db.add(
            ProviderOperation(
                id="operation-1",
                attempt_id="run-1",
                ordinal=1,
                operation_kind="image_generation",
                provider_key="vidu",
                route_identity={},
                status="succeeded_remote",
                remote_id="remote-1",
                remote_receipt={"remote_id": "remote-1"},
            )
        )
        await db.flush()
        handler = _Handler()
        result = ImageGenerationResult(
            provider="vidu",
            provider_task_id="remote-1",
            status="succeeded",
            images=[ImageItem(url="https://provider.test/one.png"), ImageItem(url="https://provider.test/two.png")],
        )

        assert await _coordinator(handler).handle_callback(
            db=db,
            callback=GenerationWorkerCallback(
                run_id="run-1", lease_epoch=1, kind=GenerationWorkerCallbackKind.succeeded, provider_task_id="remote-1"
            ),
            provider_result=result,
        ) is GenerationCallbackDisposition.accepted

        task = await db.get(GenerationTask, "task-1")
        run = await db.get(GenerationRun, "run-1")
        artifacts = list(await db.scalars(select(GenerationArtifact).order_by(GenerationArtifact.ordinal)))
        blobs = list(await db.scalars(select(MediaBlob).order_by(MediaBlob.storage_key)))
        outbox = list(await db.scalars(select(StorageOperationOutbox).order_by(StorageOperationOutbox.id)))
        assert handler.calls == []
        assert task is not None and task.status == GenerationTaskStatus.running
        assert run is not None and run.status == "delivering"
        assert [artifact.file_id for artifact in artifacts] == [None, None]
        assert [artifact.blob_id for artifact in artifacts] == [blob.id for blob in blobs]
        assert [blob.storage_key for blob in blobs] == ["generated/run-1/0/output.png", "generated/run-1/1/output.png"]
        assert [operation.payload for operation in outbox] == [
            {"provider_operation_id": "operation-1"},
            {"provider_operation_id": "operation-1"},
        ]
    await engine.dispose()


@pytest.mark.asyncio
async def test_materialized_blobs_bind_files_before_media_task_succeeds(tmp_path) -> None:
    """只有全部 Blob HEAD 完成后，才允许绑定 FileItem、投影领域结果并完成 Task。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'media-delivery.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        await _seed(db)
        run = await db.get(GenerationRun, "run-1")
        assert run is not None
        run.status = "delivering"
        blob = MediaBlob(id="blob-1", storage_key="generated/run-1/0/output.png", content_type="image/png", status="materialized")
        db.add(blob)
        db.add(GenerationArtifact(id="artifact-1", task_id="task-1", generation_run_id="run-1", modality="image", ordinal=0, blob_id="blob-1", provider_result={}, publish_status="skipped", publish_error="pending_materialization"))
        await db.flush()
        handler = _Handler()

        assert await MediaDeliveryCoordinator(finalizer=_finalizer(handler)).finalize_if_ready(db=db, run_id="run-1")

        task = await db.get(GenerationTask, "task-1")
        await db.refresh(run)
        artifact = await db.get(GenerationArtifact, "artifact-1")
        assert handler.calls == ["success"]
        assert task is not None and task.status == GenerationTaskStatus.succeeded
        assert run.status == "terminal"
        assert artifact is not None and artifact.file_id is not None
    await engine.dispose()


@pytest.mark.asyncio
async def test_success_callback_is_fenced_and_idempotent(tmp_path) -> None:
    """相同 callback 只允许一次领域交付与 Task/Run 终态写入。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'coordinator.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        await _seed(db)
        handler = _Handler()
        coordinator = _coordinator(handler)
        callback = GenerationWorkerCallback(run_id="run-1", lease_epoch=1, kind=GenerationWorkerCallbackKind.succeeded)

        assert await coordinator.handle_callback(db=db, callback=callback) is GenerationCallbackDisposition.accepted
        assert await coordinator.handle_callback(db=db, callback=callback) is GenerationCallbackDisposition.ignored_duplicate

        task = await db.get(GenerationTask, "task-1")
        run = await db.get(GenerationRun, "run-1")
        assert handler.calls == ["success"]
        assert task is not None and task.status == GenerationTaskStatus.succeeded
        assert run is not None and run.status == "terminal" and run.callback_payload is not None
    await engine.dispose()


@pytest.mark.asyncio
async def test_old_epoch_callback_has_no_task_or_handler_side_effect(tmp_path) -> None:
    """旧 epoch callback 必须在读取 Task/投影领域结果前被拒绝。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'stale-callback.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        await _seed(db, epoch=2)
        handler = _Handler()
        callback = GenerationWorkerCallback(run_id="run-1", lease_epoch=1, kind=GenerationWorkerCallbackKind.succeeded)

        assert await _coordinator(handler).handle_callback(db=db, callback=callback) is GenerationCallbackDisposition.ignored_stale

        task = await db.get(GenerationTask, "task-1")
        run = await db.get(GenerationRun, "run-1")
        assert handler.calls == []
        assert task is not None and task.status == GenerationTaskStatus.running
        assert run is not None and run.status == "executing"
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancel_intent_wins_over_success_callback(tmp_path) -> None:
    """已登记取消时，成功 callback 必须收口为取消且不得执行成功投影。"""

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cancel-wins.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        await _seed(db)
        task = await db.get(GenerationTask, "task-1")
        assert task is not None
        task.cancel_requested = True
        handler = _Handler()
        callback = GenerationWorkerCallback(run_id="run-1", lease_epoch=1, kind=GenerationWorkerCallbackKind.succeeded)

        assert await _coordinator(handler).handle_callback(db=db, callback=callback) is GenerationCallbackDisposition.accepted

        task = await db.get(GenerationTask, "task-1")
        assert handler.calls == ["cancelled"]
        assert task is not None and task.status == GenerationTaskStatus.cancelled
    await engine.dispose()
