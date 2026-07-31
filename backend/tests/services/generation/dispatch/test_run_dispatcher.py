"""Run 级持久化投递的稳定 work_id 与失败重试测试。"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import Base
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.models.task import GenerationTask
from app.services.generation.dispatch import GenerationRunDispatchDispatcher


def test_run_dispatcher_retries_pending_event_with_same_work_id(tmp_path) -> None:
    """broker 失败后必须保留 pending 事件，并以同一 work_id 重发。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'run-dispatcher.db'}", future=True)
    sessions = sessionmaker(engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as db:
        db.add(GenerationTask(id="task-1", mode="async_polling", task_kind="image_generation", status="pending", progress=0, payload={}, result=None, error=""))
        db.add(GenerationRunDispatch(work_id="work-1", task_id="task-1", source="reaper", status="pending"))
        db.commit()

    calls: list[tuple[str, str, str]] = []

    def failing(*args: str) -> None:
        calls.append(args)
        raise ConnectionError("broker unavailable")

    assert GenerationRunDispatchDispatcher(session_maker=sessions, enqueue=failing).dispatch_pending() == 0
    with sessions() as db:
        event = db.get(GenerationRunDispatch, "work-1")
        assert event is not None and (event.status, event.attempts) == ("pending", 1)
        assert event.error == "ConnectionError: broker unavailable"

    def succeed(*args: str) -> None:
        calls.append(args)

    assert GenerationRunDispatchDispatcher(session_maker=sessions, enqueue=succeed).dispatch_pending() == 1
    assert calls == [("task-1", "work-1", "reaper"), ("task-1", "work-1", "reaper")]
    with sessions() as db:
        event = db.get(GenerationRunDispatch, "work-1")
        assert event is not None and (event.status, event.attempts, event.error) == ("published", 2, None)
    engine.dispose()
