"""统一生成 Outbox dispatcher 的可靠投递回归。"""

from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import Base
from app.models.generation_artifacts import GenerationDispatchOutbox
from app.models.task import GenerationTask
from app.services.generation.dispatch import GenerationOutboxDispatcher


def _create_outbox(session_local: sessionmaker[Session], *, task_id: str) -> None:
    """写入一条待投递任务及其同事务 outbox 记录。"""
    with session_local() as db:
        db.add(
            GenerationTask(
                id=task_id,
                mode="async_polling",
                task_kind="image_generation",
                status="pending",
                progress=0,
                payload={"command": {}, "snapshot": {}},
                result=None,
                error="",
            )
        )
        db.add(GenerationDispatchOutbox(task_id=task_id, payload={"task_id": task_id}))
        db.commit()


def test_dispatcher_retries_failure_then_marks_success_once(tmp_path) -> None:
    """broker 失败保留 outbox；成功后标记且后续 Beat 不重复投递。"""
    sync_engine = create_engine(f"sqlite:///{tmp_path / 'outbox.db'}", future=True)
    session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    _create_outbox(session_local, task_id="task-outbox-1")

    calls: list[str] = []

    def _failing_enqueue(task_id: str) -> None:
        calls.append(task_id)
        raise ConnectionError("broker unavailable")

    dispatcher = GenerationOutboxDispatcher(session_maker=session_local, enqueue=_failing_enqueue)
    assert dispatcher.dispatch_pending() == 0

    with session_local() as db:
        row = db.scalar(select(GenerationDispatchOutbox).where(GenerationDispatchOutbox.task_id == "task-outbox-1"))
        assert row is not None
        assert row.dispatched_at is None
        assert row.attempts == 1
        assert row.last_error == "ConnectionError: broker unavailable"

    dispatcher = GenerationOutboxDispatcher(session_maker=session_local, enqueue=calls.append)
    assert dispatcher.dispatch_pending() == 1
    assert dispatcher.dispatch_pending() == 0
    assert calls == ["task-outbox-1", "task-outbox-1"]

    with session_local() as db:
        row = db.scalar(select(GenerationDispatchOutbox).where(GenerationDispatchOutbox.task_id == "task-outbox-1"))
        assert row is not None
        assert row.dispatched_at is not None
        assert row.attempts == 2
        assert row.last_error is None

    sync_engine.dispose()


def test_dispatcher_ignores_non_positive_batch_limit(tmp_path) -> None:
    """无效批次大小不应读取或修改待投递记录。"""
    sync_engine = create_engine(f"sqlite:///{tmp_path / 'outbox-limit.db'}", future=True)
    session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    _create_outbox(session_local, task_id="task-outbox-limit")
    calls: list[str] = []

    assert GenerationOutboxDispatcher(session_maker=session_local, enqueue=calls.append).dispatch_pending(limit=0) == 0
    assert calls == []

    with session_local() as db:
        row = db.scalar(select(GenerationDispatchOutbox).where(GenerationDispatchOutbox.task_id == "task-outbox-limit"))
        assert row is not None
        assert row.attempts == 0
        assert row.dispatched_at is None

    sync_engine.dispose()
