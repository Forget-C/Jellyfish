"""真实对象存储联调：仅操作独立随机前缀，不调用生成供应商。"""

import base64
import os
from uuid import uuid4

import httpx
import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core import storage
from app.core.db import Base
from app.core.integrations.media_provider import MediaResult
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import TaskOutput
from app.services.file_cleanup import FileCleaner
from app.services.generation.media_execution import store_media_output
from app.services.studio.files import delete_file
from app.services.task_queries import TaskQueries
from app.services.task_service import TaskService

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_real_storage_output_history_and_deletion(monkeypatch):
    """真实上传、分页、读取和删除后，数据库仍保存完整任务及文件历史。"""
    if os.environ.get("JELLYFISH_TEST_STORAGE") != "1":
        pytest.skip("Set JELLYFISH_TEST_STORAGE=1 to test configured storage in an isolated prefix")
    prefix = f"{settings.s3_base_path.strip('/')}/validation/{uuid4().hex}".strip("/")
    monkeypatch.setattr(settings, "s3_base_path", prefix)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    keys = ["files/probe-a.txt", "files/probe-b.txt"]
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=")
    try:
        for key in keys:
            await storage.upload_file(key=key, data=b"isolated storage test", content_type="text/plain")
        first, cursor = await storage.list_files_page(prefix="files/", limit=1)
        assert cursor and [item.key for item in first] == keys[:1]
        second, cursor = await storage.list_files_page(prefix="files/", cursor=cursor, limit=1)
        assert cursor is None and [item.key for item in second] == keys[1:]
        async with sessions.begin() as db:
            service = TaskService(db)
            task = await service.submit(kind="image_generation", snapshot={})
            await service.claim(task.id, worker_id="storage-test")
        key = f"generated/{task.id}/0"
        keys.append(key)
        async with httpx.AsyncClient() as client:
            await store_media_output(sessions, client, task_id=task.id, ordinal=0, kind=task.kind,
                                     output=MediaResult(b64_json=base64.b64encode(png).decode()))
        assert await storage.download_file(key=key) == png
        info = await storage.get_file_info(key=key)
        assert info.size == len(png) and info.content_type == "image/png"
        assert (info.extra or {}).get("Metadata", {}).get("sha256")
        async with sessions() as db:
            output = await db.get(TaskOutput, (task.id, 0))
            file_id = output.file_id
            with pytest.raises(HTTPException) as error:
                await delete_file(db, file_id=file_id)
            assert error.value.status_code == 409
            await db.rollback()
        async with sessions.begin() as db:
            await TaskService(db).finish(task.id)
            await delete_file(db, file_id=file_id)
        await FileCleaner(sessions).run_once()
        with pytest.raises(ClientError) as error:
            await storage.get_file_info(key=key)
        assert str(error.value.response["Error"]["Code"]) in {"404", "NoSuchKey", "NotFound"}
        async with sessions() as db:
            assert (await db.get(FileItem, file_id)).deleted_at is not None
            result = await TaskQueries(db).result(task.id)
            assert result.status == "succeeded" and result.outputs[0].deleted
            assert result.outputs[0].file_id == file_id
    finally:
        # 只清理本测试明确创建的对象；不会扫描或删除其他前缀。
        try:
            for key in keys:
                await storage.delete_file(key=key)
        finally:
            await engine.dispose()
