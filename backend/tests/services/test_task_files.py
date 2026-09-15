"""不可变上传身份与任务文件删除边界。"""

from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio_prompts_files_timeline import FileItem
from app.schemas.studio.files import FileRead
from app.services.studio.files import delete_file, require_available_file, upload_file
from app.services.task_queries import TaskQueries
from app.services.task_service import TaskService


@pytest.mark.asyncio
async def test_same_upload_name_gets_distinct_storage_identity(monkeypatch):
    """同名上传使用不同 key，上传直接读取临时文件而不是复制整个文件到内存。"""
    uploads = []

    async def capture_upload(*, key, data, content_type):
        """记录对象写入，测试不连接真实存储。"""
        uploads.append((key, data.read()))

    monkeypatch.setattr("app.services.studio.files.storage.upload_file", capture_upload)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            first = await upload_file(db, file=UploadFile(filename="same.png", file=BytesIO(b"first"), size=5))
            second = await upload_file(db, file=UploadFile(filename="same.png", file=BytesIO(b"second"), size=6))
            assert first.id != second.id and first.storage_key != second.storage_key
            assert uploads == [(first.storage_key, b"first"), (second.storage_key, b"second")]
            assert first.size_bytes == 5 and second.size_bytes == 6
            view = FileRead.model_validate(first)
            assert view.thumbnail.endswith(f"/{first.id}/download")
            assert not view.deleted
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_active_task_blocks_delete_but_history_survives_delete_request():
    """文件删除与新使用关系共享文件锁；终态历史引用保留但不永久占用存储。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            file = FileItem(id="file", type="image", name="test", storage_key="file.png")
            db.add(file)
            await db.flush()
            service = TaskService(db)
            task = await service.submit(kind="image_generation", snapshot={}, inputs=[("references", 0, file.id)])
            with pytest.raises(HTTPException) as error:
                await delete_file(db, file_id=file.id)
            assert error.value.status_code == 409
            await service.claim(task.id, worker_id="worker")
            await service.add_output(task.id, ordinal=0, file_id=file.id)
            await service.finish(task.id)
            await delete_file(db, file_id=file.id)
            await db.commit()
            assert await db.get(FileItem, file.id) is not None
            assert file.delete_requested_at is not None
            assert (await TaskQueries(db).result(task.id)).outputs[0].file_id == file.id
            with pytest.raises(HTTPException) as error:
                await require_available_file(db, file_id=file.id)
            assert error.value.status_code == 410
            with pytest.raises(ValueError):
                await service.submit(kind="image_generation", snapshot={}, inputs=[("references", 0, file.id)])
            assert FileRead.model_validate(file).deleted
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_business_adoption_rejects_deleted_and_wrong_media():
    """资产采用仍校验媒体、删除保护与 CAS；场次采用由 directing 回归验证。"""
    from types import SimpleNamespace
    from app.models.studio import Actor
    from app.services.studio import entity_images
    from app.services.generation.publishers import AssetImagePublisher

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            file = FileItem(id="usable", type="image", name="test", storage_key="usable")
            wrong = FileItem(id="wrong", type="video", name="wrong", storage_key="wrong")
            db.add_all([file, wrong, Actor(id="actor", name="actor", style="realistic")])
            await db.flush()
            slot = await entity_images.create_entity_image(db, entity_type="actor", entity_id="actor", body={})

            async def adopt(file_id):
                """使用真实业务服务维护槽位与文件引用。"""
                await entity_images.update_entity_image(db, entity_type="actor", entity_id="actor",
                    image_id=slot["id"], body={"file_id": file_id})

            with pytest.raises(HTTPException) as error:
                await adopt(wrong.id)
            assert error.value.status_code == 422
            await adopt(file.id)
            snapshot = SimpleNamespace(canonical_target=SimpleNamespace(entity_id="actor", asset_type="actor", slot_id=str(slot["id"])))
            assert not await AssetImagePublisher()._publish_file(db, snapshot=snapshot, file_id=file.id, expected_version_id=1)
            with pytest.raises(HTTPException) as error:
                await delete_file(db, file_id=file.id)
            assert error.value.status_code == 409
            await adopt(None)
            await delete_file(db, file_id=file.id)
            with pytest.raises(HTTPException) as error:
                await adopt(file.id)
            assert error.value.status_code == 410
    finally:
        await engine.dispose()


def test_storage_key_unique_index_fits_mysql_utf8mb4_limit():
    """不可变对象身份的完整唯一索引不能超出 InnoDB 的 3072 字节上限。"""
    key = FileItem.__table__.c.storage_key
    assert key.unique and not key.nullable
    assert key.type.length * 4 <= 3072
