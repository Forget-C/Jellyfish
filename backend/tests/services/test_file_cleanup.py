"""文件清理的重试、历史保留、分页范围和事务边界。"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core import storage
from app.core.db import Base
from app.models.studio_prompts_files_timeline import FileItem
from app.services.file_cleanup import FileCleaner, orphan_cleanup_scope
from app.services.task_service import TaskService, utcnow


@pytest.mark.asyncio
async def test_cleanup_retries_preserves_rows_and_skips_active_objects(tmp_path, monkeypatch):
    """失败删除不饿死下一批，存储 I/O 无事务，注册对象和活动生成对象保留。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'owned.sqlite'}")
    monkeypatch.setattr(settings, "s3_endpoint_url", "https://storage.example.test")
    monkeypatch.setattr(settings, "s3_bucket_name", "test-owned")
    monkeypatch.setattr(settings, "s3_base_path", "validation/owned")
    monkeypatch.setattr(settings, "s3_orphan_cleanup_scope", orphan_cleanup_scope(engine.url))
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    transactions = 0

    def begin(connection):
        """追踪数据库实际事务。"""
        nonlocal transactions
        transactions += 1

    def end(connection):
        """提交与回滚都释放事务。"""
        nonlocal transactions
        transactions -= 1

    event.listen(engine.sync_engine, "begin", begin)
    event.listen(engine.sync_engine, "commit", end)
    event.listen(engine.sync_engine, "rollback", end)
    deleted = []
    failure = True
    now = datetime.now(UTC)

    def obj(key, *, age=2):
        """构造不同年龄的存储对象。"""
        return storage.StoredFileInfo(key=key, url="unused", extra={"LastModified": now - timedelta(days=age)})

    async def delete(*, key):
        """模拟一次网络失败，其他对象仍可继续删除。"""
        assert transactions == 0
        if key == "files/a" and failure:
            raise RuntimeError("temporary error")
        deleted.append(key)

    pages = {}
    seen = []

    async def list_page(*, prefix, cursor, limit):
        """返回受控分页，不连接真实对象存储。"""
        assert transactions == 0
        seen.append((prefix, cursor))
        return pages[(prefix, cursor)]

    monkeypatch.setattr(storage, "delete_file", delete)
    monkeypatch.setattr(storage, "list_files_page", list_page)
    try:
        async with sessions() as db:
            db.add_all([
                FileItem(id="a", name="a", type="image", storage_key="files/a", delete_requested_at=utcnow()),
                FileItem(id="b", name="b", type="image", storage_key="files/b", thumbnail_key="files/thumb-b", delete_requested_at=utcnow()),
                FileItem(id="saved", name="saved", type="image", storage_key="files/saved", thumbnail_key="files/thumb-saved"),
            ])
            active = await TaskService(db).submit(kind="video_generation", execution_mode="remote", snapshot={})
            await TaskService(db).claim(active.id, worker_id="worker")
            await db.commit()
        pages.update({
            ("files/", None): ([obj("files/saved"), obj("files/thumb-saved"), obj("files/new", age=0)], "page-2"),
            ("files/", "page-2"): ([obj("files/orphan")], None),
            ("generated/", None): ([obj(f"generated/{active.id}/0"), obj("generated/missing/0")], None),
        })
        cleaner = FileCleaner(sessions, batch_size=1)
        await cleaner.run_once()
        assert deleted == []
        await cleaner.run_once()
        assert set(deleted) == {"files/b", "files/thumb-b", "files/orphan"}
        await cleaner.run_once()
        assert "generated/missing/0" in deleted
        assert f"generated/{active.id}/0" not in deleted
        assert seen[:3] == [("files/", None), ("files/", "page-2"), ("generated/", None)]
        failure = False
        await cleaner.run_once()
        async with sessions() as db:
            assert (await db.get(FileItem, "a")).deleted_at is not None
            assert (await db.get(FileItem, "b")).deleted_at is not None
            assert (await db.get(FileItem, "saved")).deleted_at is None
        assert "files/a" in deleted
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_storage_page_uses_logical_keys_and_continuation_token(monkeypatch):
    """带 base path 的分页结果可直接删除，不重复添加前缀或越出应用目录。"""
    requests = []

    class Client:
        """模拟 S3 协议边界。"""

        def list_objects_v2(self, **kwargs):
            """保留请求以验证前缀和分页参数。"""
            requests.append(kwargs)
            return {"Contents": [{"Key": "app/files/one", "Size": 2}], "IsTruncated": True, "NextContinuationToken": "next"}

        def delete_object(self, **kwargs):
            """记录最终物理 key。"""
            requests.append(kwargs)

    monkeypatch.setattr(storage, "settings", SimpleNamespace(s3_bucket_name="bucket", s3_base_path="/app/", s3_public_base_url="https://example.invalid"))
    monkeypatch.setattr(storage, "_build_s3_client", lambda: Client())
    objects, cursor = await storage.list_files_page(prefix="files/", cursor="previous", limit=7)
    assert cursor == "next" and objects[0].key == "files/one"
    assert objects[0].url == "https://example.invalid/app/files/one"
    await storage.delete_file(key=objects[0].key)
    assert requests == [
        {"Bucket": "bucket", "Prefix": "app/files/", "MaxKeys": 7, "ContinuationToken": "previous"},
        {"Bucket": "bucket", "Key": "app/files/one"},
    ]


@pytest.mark.asyncio
async def test_worker_cleanup_does_not_overlap_or_consume_generation_slots(monkeypatch):
    """慢速文件清理只占一个独立后台操作，不能累计任务或占用生成配额。"""
    import asyncio
    from app.task_worker import TaskWorker

    worker = TaskWorker()
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def clean():
        """挂起模拟慢速对象存储。"""
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()

    monkeypatch.setattr(worker.cleaner, "run_once", clean)
    try:
        worker._schedule_cleanup()
        await started.wait()
        original = worker.maintenance
        worker.next_cleanup_at = 0
        worker._schedule_cleanup()
        assert worker.maintenance is original and calls == 1
        assert not worker.jobs and not worker.phases
        release.set()
        await original
        worker._schedule_cleanup()
        await worker.maintenance
        assert calls == 2
    finally:
        worker.text_pool.shutdown(wait=False, cancel_futures=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("scope_state", [
    "unconfigured", "other_database", "other_prefix", "implicit_endpoint", "database_options",
])
async def test_unverified_scope_skips_orphan_scan_but_processes_requested_delete(tmp_path, monkeypatch, scope_state):
    monkeypatch.setattr(settings, "s3_endpoint_url", "https://storage.example.test")
    monkeypatch.setattr(settings, "s3_bucket_name", "shared")
    monkeypatch.setattr(settings, "s3_base_path", "development")
    db_url = f"sqlite+aiosqlite:///{tmp_path / 'worker.sqlite'}"
    engine = create_async_engine(db_url + ("?timeout=1" if scope_state == "database_options" else ""))
    authorization = ""
    if scope_state == "other_database":
        authorization = orphan_cleanup_scope(engine.url.set(database=str(tmp_path / "other.sqlite")))
    if scope_state == "implicit_endpoint":
        authorization = orphan_cleanup_scope(engine.url)
        monkeypatch.setattr(settings, "s3_endpoint_url", None)
    if scope_state == "database_options":
        authorization = orphan_cleanup_scope(engine.url.set(query={}))
    if scope_state == "other_prefix":
        authorization = orphan_cleanup_scope(engine.url)
        monkeypatch.setattr(settings, "s3_base_path", "other")
    monkeypatch.setattr(settings, "s3_orphan_cleanup_scope", authorization)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    deleted = []

    async def delete(*, key):
        deleted.append(key)

    async def list_page(**_kwargs):
        pytest.fail("An unverified database must not scan the shared bucket")

    monkeypatch.setattr(storage, "delete_file", delete)
    monkeypatch.setattr(storage, "list_files_page", list_page)
    try:
        async with sessions.begin() as db:
            db.add(FileItem(id="requested", name="requested", type="image",
                            storage_key="files/requested", delete_requested_at=utcnow()))
        await FileCleaner(sessions).run_once()
        assert deleted == ["files/requested"]
        async with sessions() as db:
            assert (await db.get(FileItem, "requested")).deleted_at is not None
    finally:
        await engine.dispose()
