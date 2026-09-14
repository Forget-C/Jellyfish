"""任务唯一维护入口的状态、取消、轮询和重复收取约束。"""

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.contracts.task import TaskStatus
from app.models.studio import FileItem
from app.services.task_service import TaskService


@pytest.mark.asyncio
async def test_cancel_wins_and_terminal_rejects_late_writes():
    """取消先提交后，成功和进度事件不能重新发布或覆盖终态。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    published = []

    async def deliver(db, task):
        """记录业务发布是否被错误调用。"""
        published.append(task.id)

    async with sessions() as db:
        service = TaskService(db)
        task = await service.submit(kind="text_chat", snapshot={"prompt": "test"})
        await db.commit()
        assert await service.claim(task.id, worker_id="worker-a")
        await db.commit()
        await service.request_cancel(task.id, reason="user")
        await db.commit()
        await service.finish(task.id, result={"text": "late"}, deliver=deliver)
        await db.commit()
        await service.report_progress(task.id, progress=90, stage="late")
        await service.finish(task.id, error_code="late_error", error="late")
        await db.commit()
        await db.refresh(task)
        assert task.status == TaskStatus.cancelled
        assert published == []
        assert task.result is None
        assert task.stage != "late"
    await engine.dispose()


@pytest.mark.asyncio
async def test_remote_restart_preserves_handle_and_missing_handle_fails():
    """重启只中断本地执行，已受理媒体继续跟踪，缺 ID 直接失败。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        service = TaskService(db)
        remote = await service.submit(kind="video_generation", snapshot={}, execution_mode="remote")
        missing = await service.submit(kind="image_generation", snapshot={}, execution_mode="remote")
        text = await service.submit(kind="text_chat", snapshot={})
        await db.commit()
        for task in (remote, missing, text):
            assert await service.claim(task.id, worker_id="old")
        await service.record_submission(remote.id, provider_task_id="remote-123")
        with pytest.raises(ValueError, match="immutable"):
            await service.record_submission(remote.id, provider_task_id="different-id")
        assert remote.provider_task_id == "remote-123"
        await service.record_submission(missing.id, provider_task_id="")
        await db.commit()
        await service.interrupt_previous_workers(worker_id="new")
        await db.commit()
        for task in (remote, missing, text):
            await db.refresh(task)
        assert remote.status == TaskStatus.running
        assert remote.provider_task_id == "remote-123"
        assert missing.status == TaskStatus.failed
        assert missing.error_code == "provider_task_id_missing"
        assert text.status == TaskStatus.failed
        assert not await service.claim(remote.id, worker_id="new")
        await service.record_poll_result(remote.id, error="temporary network failure", next_poll_seconds=15)
        assert remote.status == TaskStatus.running and remote.provider_task_id == "remote-123"
        assert remote.last_poll_error == "temporary network failure" and remote.next_poll_at is not None
        await service.record_poll_result(remote.id, remote_status="succeeded")
        assert remote.status == TaskStatus.running
        assert remote.stage == "saving"
        db.add(FileItem(id="video-file", type="video", name="test", storage_key="generated/test.mp4"))
        await db.flush()
        await service.add_output(remote.id, ordinal=0, file_id="video-file")
        await service.finish(remote.id)
        await db.commit()
        assert remote.status == TaskStatus.succeeded
    await engine.dispose()


@pytest.mark.asyncio
async def test_queued_cancel_and_expiry_never_execute():
    """排队取消和过期均在领取前结束，不产生供应商调用机会。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        service = TaskService(db)
        cancelled = await service.submit(kind="text_chat", snapshot={})
        expired = await service.submit(kind="text_chat", snapshot={}, queue_timeout_seconds=-1)
        await db.commit()
        await service.request_cancel(cancelled.id)
        await service.expire_tasks()
        await db.commit()
        assert not await service.claim(cancelled.id, worker_id="new")
        assert not await service.claim(expired.id, worker_id="new")
        assert expired.status == TaskStatus.failed
        assert expired.error_code == "queue_expired"
    await engine.dispose()


@pytest.mark.asyncio
async def test_delivery_failure_rolls_back_business_write_and_success_delivers_once():
    """交付中途异常必须同时回滚业务写入和终态，成功后重复通知不能再次交付。"""
    from app.models.task import Task

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    calls = []

    async def broken_delivery(db, task):
        """写入后抛错，模拟业务交付失败。"""
        file = await db.get(FileItem, "business-file")
        file.name = "uncommitted"
        await db.flush()
        raise RuntimeError("delivery failed")

    async def delivery(db, task):
        """通过同一事务更新实际业务对象。"""
        file = await db.get(FileItem, "business-file")
        file.name = "published"
        calls.append(task.id)

    try:
        async with sessions() as db:
            db.add(FileItem(id="business-file", name="original", type="image", storage_key="business-file"))
            task = await TaskService(db).submit(kind="text_chat", snapshot={})
            await TaskService(db).claim(task.id, worker_id="worker")
            await db.commit()
            task_id = task.id
        with pytest.raises(RuntimeError, match="delivery failed"):
            async with sessions.begin() as db:
                await TaskService(db).finish(task_id, result={"text": "test"}, deliver=broken_delivery)
        async with sessions() as db:
            assert (await db.get(FileItem, "business-file")).name == "original"
            assert (await db.get(Task, task_id)).status == "running"
            await TaskService(db).finish(task_id, result={"text": "test"}, deliver=delivery)
            await db.commit()
        async with sessions() as db:
            await TaskService(db).finish(task_id, result={"text": "late"}, deliver=delivery)
            await db.commit()
            assert (await db.get(FileItem, "business-file")).name == "published"
            completed = await db.get(Task, task_id)
            assert completed.status == "succeeded" and completed.result == {"text": "test"}
            assert calls == [task_id]
    finally:
        await engine.dispose()
