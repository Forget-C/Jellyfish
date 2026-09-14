"""文件收取的事务边界与输出幂等性。"""

import httpx
import pytest
from botocore.exceptions import ClientError
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import storage
from app.core.integrations.media_provider import MediaResult
from app.core.contracts.generation import ResolvedGenerationSnapshot
from app.models.task import TaskOutput
from app.models.studio_prompts_files_timeline import FileItem
from app.core.db import Base
from app.services.generation.media_execution import store_media_output
from app.services.generation.task_snapshot import split_snapshot
from app.services.task_queries import TaskQueries
from app.services.task_service import TaskService, utcnow


@pytest.mark.asyncio
async def test_output_download_has_no_open_transaction_and_is_idempotent(monkeypatch):
    """下载与上传期间连接已释放，重复收取不创建新文件或重写已完成对象。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    active_transactions = 0
    requests = []
    objects = {}

    def begin(connection):
        """统计实际 SQL 事务，而不是只检查调用顺序。"""
        nonlocal active_transactions
        active_transactions += 1

    def end(connection):
        """事务提交或回滚均释放计数。"""
        nonlocal active_transactions
        active_transactions -= 1

    event.listen(engine.sync_engine, "begin", begin)
    event.listen(engine.sync_engine, "commit", end)
    event.listen(engine.sync_engine, "rollback", end)

    async def head(*, key):
        """对象查询时不允许仍持有数据库事务。"""
        assert active_transactions == 0
        if key not in objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")
        return objects[key]

    async def upload(*, key, data, content_type, extra_args):
        """使用模拟对象存储保存完整流。"""
        assert active_transactions == 0
        body = data.read()
        assert key not in objects
        objects[key] = storage.StoredFileInfo(key=key, url="unused", size=len(body), content_type=content_type, extra=extra_args)

    def handle(request):
        """仅供应商文件下载会到达此模拟传输。"""
        assert active_transactions == 0
        requests.append(request)
        return httpx.Response(200, content=b"media-content", headers={"content-type": "video/mp4"})

    monkeypatch.setattr(storage, "get_file_info", head)
    monkeypatch.setattr(storage, "upload_file", upload)
    try:
        async with sessions() as db:
            task = await TaskService(db).submit(kind="video_generation", snapshot={})
            await TaskService(db).claim(task.id, worker_id="worker")
            await db.commit()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            for _ in range(2):
                await store_media_output(sessions, client, task_id=task.id, ordinal=0, kind=task.kind,
                                         output=MediaResult(url="https://provider.invalid/video"))
        assert len(objects) == len(requests) == 1
        async with sessions() as db:
            outputs = list(await db.scalars(select(TaskOutput)))
            files = list(await db.scalars(select(FileItem)))
            assert len(outputs) == len(files) == 1
            assert outputs[0].file_id == files[0].id
            assert files[0].size_bytes == len(b"media-content")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_output_history_cursor_includes_all_outputs_and_excludes_deleted():
    """同一个任务的多个产物跨页不丢失，并排除已申请删除的候选文件。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            snapshot = ResolvedGenerationSnapshot.model_validate({
                "model_id": "model", "execution_prompt": "test",
                "operation_input": {"kind": "image_generation", "count": 3},
                "canonical_target": {"kind": "experiment_session", "entity_id": "session"},
            })
            data, target_type, target_id, inputs = split_snapshot(snapshot)
            service = TaskService(db)
            task = await service.submit(kind="image_generation", snapshot=data, target_type=target_type, target_id=target_id)
            await service.claim(task.id, worker_id="worker")
            for ordinal in range(3):
                db.add(FileItem(id=f"file-{ordinal}", name="image", type="image", storage_key=f"image-{ordinal}"))
                await db.flush()
                await service.add_output(task.id, ordinal=ordinal, file_id=f"file-{ordinal}")
            await service.finish(task.id)
            await db.commit()
            queries = TaskQueries(db)
            first = await queries.outputs(target_type=target_type, target_id=target_id, limit=2)
            second = await queries.outputs(target_type=target_type, target_id=target_id, limit=2, cursor=first.next_cursor)
            assert [item.ordinal for item in first.items + second.items] == [0, 1, 2]
            assert not second.next_cursor
            file = await db.get(FileItem, "file-1")
            file.delete_requested_at = utcnow()
            await db.commit()
            remaining = await queries.outputs(target_type=target_type, target_id=target_id)
            assert [item.ordinal for item in remaining.items] == [0, 2]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_existing_storage_object_must_match_output_media_type(monkeypatch):
    """上传后登记前中断时可以复用对象，但不能把错误页等内容登记成媒体输出。"""
    from app.core.integrations.media_provider import ProviderDataError

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def head(**kwargs):
        """模拟稳定输出 key 下存在内容类型错误的对象。"""
        return storage.StoredFileInfo(key=kwargs["key"], url="unused", size=10, content_type="text/html")

    monkeypatch.setattr(storage, "get_file_info", head)
    try:
        async with sessions.begin() as db:
            task = await TaskService(db).submit(kind="image_generation", snapshot={})
            await TaskService(db).claim(task.id, worker_id="worker")
        async with httpx.AsyncClient() as client:
            with pytest.raises(ProviderDataError, match="stored_output_type_mismatch"):
                await store_media_output(sessions, client, task_id=task.id, ordinal=0, kind=task.kind,
                                         output=MediaResult(url="https://provider.invalid/image"))
        async with sessions() as db:
            assert not list(await db.scalars(select(TaskOutput)))
            assert not list(await db.scalars(select(FileItem)))
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("key,stored_type,expected", [
    ("files/reference.jpg", None, "image/jpeg"),
    ("generated/task/0", "image/webp", "image/webp"),
    ("generated/task/0", "text/html", None),
])
async def test_reference_type_is_resolved_without_assuming_png(monkeypatch, key, stored_type, expected):
    """旧文件元信息缺失时使用扩展名或对象类型，未知类型不伪装为 PNG。"""
    from types import SimpleNamespace
    from app.core.integrations.media_provider import ProviderDataError
    from app.services.generation.media_execution import build_media_input

    async def download(**kwargs):
        """只提供本地测试字节，不访问对象存储。"""
        return b"reference"

    async def head(**kwargs):
        """无扩展名对象从存储元信息取 MIME 类型。"""
        return storage.StoredFileInfo(key=key, url="unused", content_type=stored_type)

    monkeypatch.setattr(storage, "download_file", download)
    monkeypatch.setattr(storage, "get_file_info", head)
    snapshot = ResolvedGenerationSnapshot.model_validate({
        "model_id": "model", "execution_prompt": "test",
        "canonical_target": {"kind": "experiment_session", "entity_id": "session"},
        "operation_input": {"kind": "image_generation"},
        "media": {"references": [{"file_id": "file", "media_kind": "image", "ordinal": 0}]},
    })
    task = SimpleNamespace(kind="image_generation", input_snapshot={"model_name": "model"})
    file = FileItem(id="file", type="image", storage_key=key, content_type="application/octet-stream")
    if expected is None:
        with pytest.raises(ProviderDataError, match="input_file_type_mismatch"):
            await build_media_input(task, snapshot, {file.id: file})
    else:
        result = await build_media_input(task, snapshot, {file.id: file})
        assert result.images[0].image_url.startswith(f"data:{expected};base64,")
