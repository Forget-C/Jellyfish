"""P3 expand 存储登记表的最小仓储回归。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.contracts.storage_operation import MediaBlobStatus, StorageOperationKind, StorageOperationStatus
from app.models.media_blobs import MediaBlob, StorageOperationOutbox
from app.services.generation.storage import StorageOperationOutboxRepository


def test_media_blob_storage_key_uses_mysql_safe_unique_index_length() -> None:
    """稳定对象 key 的唯一索引必须适配 MySQL utf8mb4 的 3072-byte 上限。"""
    assert MediaBlob.__table__.c.storage_key.type.length == 700


@pytest.mark.asyncio
async def test_storage_repository_creates_stable_blob_and_idempotent_materialize_intent(tmp_path) -> None:
    """同一稳定 key 复用 Blob，同一 outbox 幂等键不会产生重复物化意图。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'storage-outbox.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(
            storage_key="generation/attempt-1/0/output.bin",
            content_type="image/png",
        )
        assert (await repository.create_pending_blob(
            storage_key="generation/attempt-1/0/output.bin",
            content_type="image/png",
        )).id == blob.id
        outbox = await repository.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.materialize,
            idempotency_key="attempt-1:0:materialize",
            payload={"provider_operation_id": "provider-1"},
        )
        assert (await repository.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.materialize,
            idempotency_key="attempt-1:0:materialize",
            payload={"provider_operation_id": "provider-1"},
        )).id == outbox.id
        assert (await db.scalars(select(MediaBlob))).all() == [blob]
        assert (await db.scalars(select(StorageOperationOutbox))).all() == [outbox]
        assert outbox.payload == {"provider_operation_id": "provider-1"}
    await engine.dispose()


@pytest.mark.asyncio
async def test_storage_outbox_claim_increments_epoch_and_fences_stale_lease(tmp_path) -> None:
    """同一 outbox 只能由当前 epoch 完成，旧 lease 不能绑定 Blob。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'storage-outbox-lease.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(storage_key="generation/attempt-2/0/output.bin", content_type="image/png")
        await repository.enqueue(
            blob_id=blob.id,
            operation_kind=StorageOperationKind.materialize,
            idempotency_key="attempt-2:0:materialize",
            payload={"provider_operation_id": "provider-2"},
        )
        first = await repository.claim_next_materialize(owner="worker-a", ttl_seconds=30)
        assert first is not None
        assert await repository.complete_materialization(
            lease=first, size_bytes=1, content_type="image/png", etag="etag-a"
        )
        assert not await repository.complete_materialization(
            lease=first, size_bytes=2, content_type="image/png", etag="stale"
        )
        await db.refresh(blob)
        assert blob.etag == "etag-a"
    await engine.dispose()


@pytest.mark.asyncio
async def test_storage_outbox_rejects_provider_url_and_credentials(tmp_path) -> None:
    """临时 Provider URL 与凭据不得进入可重试 outbox payload。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'storage-outbox-sensitive.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(storage_key="generation/attempt-1/0/output.bin", content_type="image/png")
        with pytest.raises(ValueError, match="must not contain"):
            await repository.enqueue(
                blob_id=blob.id,
                operation_kind=StorageOperationKind.materialize,
                idempotency_key="attempt-1:0:unsafe-url",
                payload={"source_url": "https://provider.test/output?token=secret"},
            )
        with pytest.raises(ValueError, match="must not contain"):
            await repository.enqueue(
                blob_id=blob.id,
                operation_kind=StorageOperationKind.materialize,
                idempotency_key="attempt-1:0:unsafe-token",
                payload={"provider": {"token": "secret"}},
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_storage_outbox_rejects_non_receipt_materialize_payload(tmp_path) -> None:
    """materialize 只允许 ProviderOperation ID，避免未来调用方把媒体来源塞进 outbox。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'storage-outbox-payload-shape.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_pending_blob(storage_key="generation/attempt-3/0/output.bin", content_type="image/png")
        with pytest.raises(ValueError, match="only provider_operation_id"):
            await repository.enqueue(
                blob_id=blob.id,
                operation_kind=StorageOperationKind.materialize,
                idempotency_key="attempt-3:0:extra",
                payload={"provider_operation_id": "provider-3", "ordinal": 0},
            )
    await engine.dispose()


@pytest.mark.asyncio
async def test_storage_outbox_tombstones_blob_and_completes_delete_after_current_lease(tmp_path) -> None:
    """删除意图先写墓碑；只有当前 lease 完成后才记录 Blob 已物理删除。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'storage-delete.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        repository = StorageOperationOutboxRepository(db)
        blob = await repository.create_materialized_blob(storage_key="files/delete-me.png", content_type="image/*")
        operation = await repository.request_delete(blob_id=blob.id, idempotency_key="blob:delete-me:delete")
        assert blob.status == MediaBlobStatus.delete_pending.value
        assert blob.delete_tombstoned_at is not None

        lease = await repository.claim_next(operation_kind=StorageOperationKind.delete, owner="delete-worker", ttl_seconds=30)
        assert lease is not None
        assert await repository.complete_deletion(lease=lease)

        await db.refresh(blob)
        await db.refresh(operation)
        assert blob.status == MediaBlobStatus.deleted.value
        assert blob.deleted_at is not None
        assert operation.status == StorageOperationStatus.completed.value
    await engine.dispose()
