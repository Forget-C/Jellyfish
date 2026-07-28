from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.task_manager import (
    AsyncPollingDeliveryStrategy,
    DeliveryMode,
    InMemoryTaskStore,
    SqlAlchemyTaskStore,
    StreamingDeliveryStrategy,
    TaskManager,
)
from app.core.task_manager.types import BaseTask, TaskStatus
from app.models.task import GenerationTask, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink, GenerationTaskLinkStatus


class DummyTask(BaseTask):
    """用于满足 TaskManager.create 的最小 Task 实现。"""

    run_mode = "async_result"

    def __init__(self) -> None:
        self._result: Any = None

    async def run(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any] | None:  # type: ignore[override]
        self._result = {"args": args, "kwargs": kwargs}
        return None

    async def status(self) -> dict[str, Any]:  # type: ignore[override]
        return {}

    async def is_done(self) -> bool:  # type: ignore[override]
        return self._result is not None

    async def get_result(self) -> Any:  # type: ignore[override]
        return self._result


@pytest.mark.asyncio
async def test_inmemory_async_polling_strategy_updates_status_progress_and_result() -> None:
    store = InMemoryTaskStore()

    async def worker(task_record, task_store) -> None:
        await task_store.set_progress(task_record.id, 10)
        await task_store.set_progress(task_record.id, 120)  # clamp to 100
        await task_store.set_result(task_record.id, {"url": "x"})
        await task_store.set_status(task_record.id, TaskStatus.succeeded)

    tm = TaskManager(
        store=store,
        strategies={
            DeliveryMode.async_polling: AsyncPollingDeliveryStrategy(store, worker),
        },
    )

    task = await tm.create(task=DummyTask(), mode=DeliveryMode.async_polling, run_args={"a": 1})
    assert task.status == TaskStatus.pending
    assert task.progress == 0

    await tm.start(task_id=task.id)

    # 等待后台 task 跑完（AsyncPollingDeliveryStrategy 使用 asyncio.create_task）
    for _ in range(50):
        view = await tm.get_status(task_id=task.id)
        if view.status in (TaskStatus.succeeded, TaskStatus.failed):
            break
        await asyncio.sleep(0.01)

    view = await tm.get_status(task_id=task.id)
    assert view.status == TaskStatus.succeeded
    assert view.progress == 100
    assert view.result == {"url": "x"}
    assert view.error == ""
    assert view.started_at_ts is not None
    assert view.finished_at_ts is not None
    assert view.elapsed_ms is not None


@pytest.mark.asyncio
async def test_inmemory_streaming_strategy_yields_chunks_and_marks_succeeded() -> None:
    store = InMemoryTaskStore()

    async def streaming_fn(payload: dict[str, Any]):
        assert "run_args" in payload
        yield {"chunk": 1}
        yield {"chunk": 2}

    tm = TaskManager(
        store=store,
        strategies={
            DeliveryMode.streaming: StreamingDeliveryStrategy(store, streaming_fn),
        },
    )

    task = await tm.create(task=DummyTask(), mode=DeliveryMode.streaming, run_args={"p": "x"})
    it = await tm.start(task_id=task.id)
    assert it is not None

    chunks = []
    async for c in it:
        chunks.append(c)

    assert chunks == [{"chunk": 1}, {"chunk": 2}]
    view = await tm.get_status(task_id=task.id)
    assert view.status == TaskStatus.succeeded
    assert view.progress == 100


@pytest.mark.asyncio
async def test_sqlalchemy_store_create_and_get_status_view_sqlite_memory() -> None:
    # 使用 sqlite in-memory，验证 SqlAlchemyTaskStore 的读写与轻量轮询查询
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 确保 generation_tasks 表在 metadata 中已注册
    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        store = SqlAlchemyTaskStore(db)
        tm = TaskManager(
            store=store,
            strategies={
                DeliveryMode.async_polling: AsyncPollingDeliveryStrategy(store, lambda *_: asyncio.sleep(0)),
            },
        )

        task = await tm.create(task=DummyTask(), mode=DeliveryMode.async_polling, run_args={"k": "v"})
        view = await tm.get_status(task_id=task.id)
        assert view.id == task.id
        assert view.status == TaskStatus.pending
        assert view.progress == 0

        await store.set_status(task.id, TaskStatus.running)
        await store.set_progress(task.id, 55)
        await store.set_result(task.id, {"url": "db"})
        await store.set_status(task.id, TaskStatus.succeeded)

        view2 = await tm.get_status(task_id=task.id)
        assert view2.status == TaskStatus.succeeded
        assert view2.progress == 55
        assert view2.result == {"url": "db"}
        assert view2.started_at_ts is not None
        assert view2.finished_at_ts is not None
        assert view2.elapsed_ms is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_sqlalchemy_store_list_task_views_relation_filter_deduplicates_tasks() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        store = SqlAlchemyTaskStore(db)

        first = await store.create(
            payload={"run_args": {"chapter_id": "chapter-1"}},
            mode=DeliveryMode.async_polling,
            task_kind="script_extract",
        )
        second = await store.create(
            payload={"run_args": {"chapter_id": "chapter-2"}},
            mode=DeliveryMode.async_polling,
            task_kind="script_extract",
        )
        await store.set_status(first.id, TaskStatus.running)
        await store.set_status(second.id, TaskStatus.running)

        db.add_all(
            [
                GenerationTaskLink(
                    task_id=first.id,
                    resource_type="text",
                    relation_type="chapter",
                    relation_entity_id="chapter-1",
                    status=GenerationTaskLinkStatus.todo,
                ),
                GenerationTaskLink(
                    task_id=first.id,
                    resource_type="text",
                    relation_type="chapter",
                    relation_entity_id="chapter-1-draft",
                    status=GenerationTaskLinkStatus.todo,
                ),
                GenerationTaskLink(
                    task_id=second.id,
                    resource_type="text",
                    relation_type="chapter",
                    relation_entity_id="chapter-2",
                    status=GenerationTaskLinkStatus.todo,
                ),
            ]
        )
        await db.flush()

        items, total = await store.list_task_views(
            relation_type="chapter",
            page=1,
            page_size=20,
        )

        assert total == 2
        assert len(items) == 2
        assert {item.id for item in items} == {first.id, second.id}

    await engine.dispose()


@pytest.mark.asyncio
async def test_sqlalchemy_store_task_center_list_hides_streaming_runs() -> None:
    """任务中心列表不得包含实验室的 hidden streaming 运行记录。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        store = SqlAlchemyTaskStore(db)
        visible = await store.create(payload={}, mode=DeliveryMode.async_polling, task_kind="image_generation")
        db.add(
            GenerationTask(
                id="hidden-text-run",
                mode="streaming",
                visibility=GenerationTaskVisibility.hidden,
                task_kind="text_chat",
                status="streaming",
                payload={},
            )
        )
        await db.flush()

        items, total = await store.list_task_views(page=1, page_size=20)

        assert total == 1
        assert [item.id for item in items] == [visible.id]

    await engine.dispose()


@pytest.mark.asyncio
async def test_request_cancel_keeps_running_task_pending_cancellation() -> None:
    store = InMemoryTaskStore()
    tm = TaskManager(store=store, strategies={})

    task = await tm.create(task=DummyTask(), mode=DeliveryMode.async_polling, run_args={"a": 1})
    await store.set_status(task.id, TaskStatus.running)

    rec = await tm.request_cancel(task_id=task.id, reason="用户取消")
    assert rec.cancel_requested is True
    assert rec.status == TaskStatus.running

    view = await tm.get_status(task_id=task.id)
    assert view.cancel_requested is True
    assert view.status == TaskStatus.running
