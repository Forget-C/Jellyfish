"""媒体物化 Worker 的领取、固定 key 上传与 HEAD 绑定回归。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.storage_operation import MediaBlobStatus, StorageOperationKind, StorageOperationStatus
from app.core.storage import StoredFileInfo
from app.models.generation_runs import GenerationRun
from app.models.provider_operations import ProviderOperation
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.services.generation.storage.materializer import (
    MaterializeSource,
    MediaDeleteWorker,
    MediaMaterializeWorker,
    ProviderReceiptMaterializeSourceResolver,
    ProviderReceiptSourceRegistry,
    UnsupportedProviderReceiptSourceError,
)
from app.services.generation.storage.repository import StorageOperationOutboxRepository
from app.core.db import Base


class _SourceResolver:
    """测试用受控来源：仅按 ID 返回内存字节，不暴露 URL。"""

    async def resolve(self, *, payload: dict[str, object], blob_id: str) -> MaterializeSource:
        assert payload == {"provider_operation_id": "provider-1"}
        assert blob_id
        return MaterializeSource(data=b"media", content_type="image/png")


class _StorageGateway:
    """测试用对象存储，记录固定 key 调用并返回 HEAD 元数据。"""

    def __init__(self) -> None:
        self.uploads: list[tuple[str, bytes, str | None]] = []
        self.head_keys: list[str] = []
        self.deleted_keys: list[str] = []

    async def upload_file(self, *, key: str, data: bytes, content_type: str | None = None) -> StoredFileInfo:
        self.uploads.append((key, data, content_type))
        return StoredFileInfo(key=key, url="unused", etag="upload-etag")

    async def get_file_info(self, *, key: str) -> StoredFileInfo:
        self.head_keys.append(key)
        return StoredFileInfo(key=key, url="unused", size=5, content_type="image/png", etag="head-etag")

    async def delete_file(self, *, key: str) -> None:
        self.deleted_keys.append(key)


@pytest.mark.asyncio
async def test_materialize_worker_uploads_stable_key_then_binds_head_metadata(tmp_path) -> None:
    """Worker 只从受控 resolver 取字节，并以 Blob 固定 key 上传、HEAD 后完成绑定。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'materialize.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(
            storage_key="generation/attempt-1/0/output.png",
            content_type="image/png",
        )
        operation = await repository.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.materialize,
            idempotency_key="attempt-1:0:materialize",
            payload={"provider_operation_id": "provider-1"},
        )
        gateway = _StorageGateway()
        worker = MediaMaterializeWorker(source_resolver=_SourceResolver(), storage=gateway)

        assert await worker.execute_next(db=db, owner="storage-worker") == operation.id
        assert gateway.uploads == [("generation/attempt-1/0/output.png", b"media", "image/png")]
        assert gateway.head_keys == ["generation/attempt-1/0/output.png"]

        await db.refresh(blob)
        await db.refresh(operation)
        assert blob.status == MediaBlobStatus.materialized.value
        assert blob.size_bytes == 5
        assert blob.etag == "head-etag"
        assert operation.status == StorageOperationStatus.completed.value
        assert operation.lease_owner is None
        assert operation.completed_at is not None
    await engine.dispose()


@pytest.mark.asyncio
async def test_materialize_worker_releases_lease_after_source_failure(tmp_path) -> None:
    """来源解析失败只留下诊断并释放 lease，临时下载地址不会进入 outbox。"""
    class _FailingResolver:
        async def resolve(self, *, payload: dict[str, object], blob_id: str) -> MaterializeSource:
            raise RuntimeError("provider result no longer available")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'materialize-failure.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(storage_key="generation/attempt-1/1/output.png", content_type="image/png")
        operation = await repository.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.materialize,
            idempotency_key="attempt-1:1:materialize",
            payload={"provider_operation_id": "provider-2"},
        )
        worker = MediaMaterializeWorker(source_resolver=_FailingResolver(), storage=_StorageGateway())

        with pytest.raises(RuntimeError, match="no longer available"):
            await worker.execute_next(db=db, owner="storage-worker")

        await db.refresh(operation)
        assert operation.status == StorageOperationStatus.pending.value
        assert operation.last_error_code == "materialize_failed"
        assert operation.lease_owner is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_delete_worker_marks_blob_deleted_only_after_storage_delete(tmp_path) -> None:
    """物理对象删除成功才完成 outbox 并将 Blob 迁移到 deleted。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'delete-worker.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_materialized_blob(storage_key="files/delete-worker.png", content_type="image/*")
        operation = await repository.request_delete(blob_id=blob.id, idempotency_key="blob:delete-worker:delete")
        gateway = _StorageGateway()
        worker = MediaDeleteWorker(storage=gateway)

        assert await worker.execute_next(db=db, owner="delete-worker") == operation.id
        assert gateway.deleted_keys == ["files/delete-worker.png"]
        await db.refresh(blob)
        await db.refresh(operation)
        assert blob.status == MediaBlobStatus.deleted.value
        assert operation.status == StorageOperationStatus.completed.value
    await engine.dispose()


@pytest.mark.asyncio
async def test_receipt_source_resolver_exposes_only_controlled_receipt_to_registered_adapter(tmp_path) -> None:
    """物化来源只能按 operation ID 读取 receipt，Provider 原始响应不会流入 adapter。"""
    class _ViduAdapter:
        provider_key = "vidu"

        async def resolve_bytes(self, *, request):  # type: ignore[no-untyped-def]
            assert request.provider_key == "vidu"
            assert request.receipt.remote_id == "remote-1"
            assert request.receipt.remote_status == "succeeded"
            return MaterializeSource(data=b"receipt-media", content_type="video/mp4")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'receipt-source.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={"snapshot": {"model_id": "model-1", "canonical_target": {"kind": "experiment_session", "entity_id": "session-1"}, "operation_input": {"kind": "video_generation", "ratio": "16:9"}, "execution_prompt": "测试"}}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        db.add(ProviderOperation(id="provider-1", attempt_id="attempt-1", ordinal=1, operation_kind="video_generation", provider_key="vidu", route_identity={}, status="succeeded_remote", remote_id="remote-1", remote_receipt={"remote_id": "remote-1", "remote_status": "succeeded", "download_url": "https://unsafe.test/a?token=nope"}))
        await db.flush()

        resolver = ProviderReceiptMaterializeSourceResolver(
            db=db,
            registry=ProviderReceiptSourceRegistry(adapters=[_ViduAdapter()]),
        )
        blob_id = "blob-1"
        from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
        db.add(GenerationArtifact(id="artifact-1", task_id="task-1", generation_run_id="attempt-1", modality="video", ordinal=0, blob_id=blob_id, provider_result={}, publish_status=GenerationArtifactPublishStatus.skipped, publish_error="pending_materialization"))
        from app.models.media_blobs import MediaBlob
        db.add(MediaBlob(id=blob_id, storage_key="generated/attempt-1/0/output.mp4", content_type="video/mp4", status="pending_materialization"))
        await db.flush()
        source = await resolver.resolve(payload={"provider_operation_id": "provider-1"}, blob_id=blob_id)
        assert source == MaterializeSource(data=b"receipt-media", content_type="video/mp4")
    await engine.dispose()


@pytest.mark.asyncio
async def test_receipt_source_resolver_rejects_unregistered_provider_and_invalid_payload(tmp_path) -> None:
    """无专用 bytes adapter 或历史脏 payload 时，Worker 必须失败而不能猜测下载 URL。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'receipt-source-reject.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(GenerationTask(id="task-1", mode=GenerationDeliveryMode.async_polling, visibility=GenerationTaskVisibility.task_center, task_kind="video_generation", status=GenerationTaskStatus.running, payload={"snapshot": {"model_id": "model-1", "canonical_target": {"kind": "experiment_session", "entity_id": "session-1"}, "operation_input": {"kind": "video_generation", "ratio": "16:9"}, "execution_prompt": "测试"}}))
        db.add(GenerationRun(id="attempt-1", task_id="task-1", attempt_no=1, status="executing"))
        db.add(ProviderOperation(id="provider-1", attempt_id="attempt-1", ordinal=1, operation_kind="video_generation", provider_key="unknown", route_identity={}, status="accepted", remote_id="remote-1", remote_receipt={"remote_id": "remote-1"}))
        from app.models.generation_artifacts import GenerationArtifact, GenerationArtifactPublishStatus
        from app.models.media_blobs import MediaBlob
        db.add(MediaBlob(id="blob-1", storage_key="generated/attempt-1/0/output.mp4", content_type="video/mp4", status="pending_materialization"))
        db.add(GenerationArtifact(id="artifact-1", task_id="task-1", generation_run_id="attempt-1", modality="video", ordinal=0, blob_id="blob-1", provider_result={}, publish_status=GenerationArtifactPublishStatus.skipped, publish_error="pending_materialization"))
        await db.flush()
        resolver = ProviderReceiptMaterializeSourceResolver(db=db, registry=ProviderReceiptSourceRegistry())

        with pytest.raises(UnsupportedProviderReceiptSourceError, match="no receipt-backed"):
            await resolver.resolve(payload={"provider_operation_id": "provider-1"}, blob_id="blob-1")
        with pytest.raises(ValueError, match="only provider_operation_id"):
            await resolver.resolve(payload={"provider_operation_id": "provider-1", "source_url": "https://unsafe.test"}, blob_id="blob-1")
    await engine.dispose()
