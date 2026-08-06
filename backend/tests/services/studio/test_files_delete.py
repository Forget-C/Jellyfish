"""文件删除的可靠 outbox 与引用保护回归。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.storage_operation import MediaBlobStatus, StorageOperationKind
from app.core.db import Base
from app.models.media_blobs import MediaBlob, StorageOperationOutbox
from app.models.studio import FileItem, FileType
from app.models.studio_file_usages import FileUsage
from app.services.studio.files import delete_file


@pytest.mark.asyncio
async def test_delete_file_writes_tombstone_and_outbox_without_sync_storage_io(tmp_path) -> None:
    """无引用文件删除只提交墓碑与 outbox，物理对象删除交给后续 Worker。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'file-delete.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(FileItem(id="file-1", type=FileType.image, name="image", thumbnail="", tags=[], storage_key="files/file-1.png"))
        await db.flush()

        await delete_file(db, file_id="file-1")

        assert await db.get(FileItem, "file-1") is None
        blob = await db.scalar(select(MediaBlob).where(MediaBlob.storage_key == "files/file-1.png"))
        assert blob is not None
        assert blob.status == MediaBlobStatus.delete_pending.value
        operation = await db.scalar(select(StorageOperationOutbox).where(StorageOperationOutbox.blob_id == blob.id))
        assert operation is not None
        assert operation.operation_kind == StorageOperationKind.delete.value
        assert operation.payload == {}
    await engine.dispose()


@pytest.mark.asyncio
async def test_delete_file_rejects_project_usage_reference(tmp_path) -> None:
    """项目使用中的文件不得登记删除，避免关系仍存在时误删对象。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'file-delete-reference.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(FileItem(id="file-2", type=FileType.image, name="image", thumbnail="", tags=[], storage_key="files/file-2.png"))
        await db.flush()
        db.add(FileUsage(file_id="file-2", project_id="project-1", usage_kind="asset_image", source_ref="slot-1"))
        await db.flush()

        with pytest.raises(HTTPException) as raised:
            await delete_file(db, file_id="file-2")

        assert raised.value.status_code == 409
        assert await db.get(FileItem, "file-2") is not None
        assert (await db.scalars(select(StorageOperationOutbox))).all() == []
    await engine.dispose()
