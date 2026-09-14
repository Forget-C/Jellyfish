"""文件删除登记与业务引用保护回归。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio import FileItem, FileType
from app.models.studio_file_usages import FileUsage
from app.services.studio.files import delete_file


@pytest.mark.asyncio
async def test_delete_file_records_request_without_storage_io(tmp_path, monkeypatch) -> None:
    """删除接口只登记意图并保留历史元信息，物理删除由 Worker 完成。"""
    async def forbidden_delete(**kwargs):
        """请求事务内不得连接对象存储。"""
        raise AssertionError("storage deletion must run in worker")
    monkeypatch.setattr("app.core.storage.delete_file", forbidden_delete)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'file-delete.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(FileItem(id="file-1", type=FileType.image, name="image", tags=[], storage_key="files/file-1.png"))
        await db.flush()

        await delete_file(db, file_id="file-1")

        await db.commit()
        file = await db.get(FileItem, "file-1")
        assert file is not None and file.delete_requested_at is not None
        assert file.deleted_at is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_delete_file_rejects_project_usage_reference(tmp_path) -> None:
    """项目使用中的文件不得登记删除，避免关系仍存在时误删对象。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'file-delete-reference.db'}")
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as db:
        db.add(FileItem(id="file-2", type=FileType.image, name="image", tags=[], storage_key="files/file-2.png"))
        await db.flush()
        db.add(FileUsage(file_id="file-2", project_id="project-1", usage_kind="asset_image", source_ref="slot-1"))
        await db.flush()

        with pytest.raises(HTTPException) as raised:
            await delete_file(db, file_id="file-2")

        assert raised.value.status_code == 409
        assert await db.get(FileItem, "file-2") is not None
        assert (await db.get(FileItem, "file-2")).delete_requested_at is None
    await engine.dispose()
