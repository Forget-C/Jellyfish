from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import Base
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.models.task import GenerationTask
from app.services.execution_attempt_runtime import DriverExecution
from app.services.generation.runtime.media_driver import MediaDriverOutput
from app.services.script_processing_worker import MergeTaskExecutor, VariantTaskExecutor
from app.tasks import execute_task as execute_task_module
from app.services.worker.task_executor import AbstractAsyncDelegatingExecutor, AbstractWorkerTaskExecutor, WorkerTaskContext
from app.services.worker.task_registry import task_executor_registry


class _DummyTask:
    async def run(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None

    async def status(self) -> dict:
        return {}

    async def is_done(self) -> bool:
        return False

    async def get_result(self):
        return None


@pytest.mark.asyncio
async def test_task_manager_create_persists_task_kind() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        store = SqlAlchemyTaskStore(db)
        tm = TaskManager(store=store, strategies={})
        record = await tm.create(
            task=_DummyTask(),
            mode=DeliveryMode.async_polling,
            task_kind="script_divide",
            run_args={"chapter_id": "chapter-1"},
        )

        row = await db.get(GenerationTask, record.id)
        assert row is not None
        assert row.task_kind == "script_divide"
        assert row.payload["task_kind"] == "script_divide"

    await engine.dispose()


def test_run_task_celery_routes_by_task_kind(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "task-execute.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-1",
                mode="async_polling",
                task_kind="script_divide",
                status="pending",
                progress=0,
                payload={"task_kind": "script_divide", "run_args": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    called: list[str] = []

    class _FakeExecutor:
        def run(self, task_id: str) -> None:
            called.append(task_id)

    def _fake_resolve(task_kind: str):
        assert task_kind == "script_divide"
        return _FakeExecutor()

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module.task_executor_registry, "resolve", _fake_resolve)

    execute_task_module.run_task_celery("task-1")
    assert called == ["task-1"]

    sync_engine.dispose()


def test_run_task_celery_routes_generation_to_lifecycle_coordinator(monkeypatch, tmp_path) -> None:
    """图片/视频不再经旧注册表，而是进入 Run 生命周期主链。"""

    db_path = tmp_path / "generation-lifecycle-route.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-generation",
                mode="async_polling",
                task_kind="image_generation",
                status="pending",
                progress=0,
                payload={"snapshot": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    called: list[str] = []

    async def _run_lifecycle(task_id: str, *, work_id: str | None = None) -> None:
        assert work_id is None
        called.append(task_id)

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "_run_generation_lifecycle_task", _run_lifecycle)

    execute_task_module.run_task_celery("task-generation")
    assert called == ["task-generation"]
    sync_engine.dispose()


def test_run_task_celery_routes_async_text_to_attempt_lifecycle(monkeypatch, tmp_path) -> None:
    """异步文本与媒体共用 durable Attempt 入口，不得回退旧注册表。"""

    db_path = tmp_path / "text-attempt-route.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-text",
                mode="async_polling",
                task_kind="text_chat",
                status="pending",
                progress=0,
                payload={"snapshot": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    called: list[str] = []

    async def _run_lifecycle(task_id: str, *, work_id: str | None = None) -> None:
        assert work_id is None
        called.append(task_id)

    def _unexpected_registry_lookup(task_kind: str):
        raise AssertionError(f"text chat must not use registry: {task_kind}")

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "_run_generation_lifecycle_task", _run_lifecycle)
    monkeypatch.setattr(execute_task_module.task_executor_registry, "resolve", _unexpected_registry_lookup)

    execute_task_module.run_task_celery("task-text")
    assert called == ["task-text"]
    sync_engine.dispose()


def test_run_task_celery_routes_script_consistency_to_attempt_lifecycle(monkeypatch, tmp_path) -> None:
    """一致性检查已迁入 Attempt，不能回退到旧 script executor 注册表。"""
    db_path = tmp_path / "consistency-attempt-route.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(GenerationTask(id="task-consistency", mode="async_polling", task_kind="script_consistency", status="pending", progress=0, payload={"snapshot": {"run_args": {"script_text": "第一幕"}}}, result=None, error=""))
        db.commit()
    called: list[str] = []

    async def _run_attempt(task_id: str, *, work_id: str | None = None) -> None:
        assert work_id is None
        called.append(task_id)

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "_run_script_consistency_attempt_task", _run_attempt)
    monkeypatch.setattr(execute_task_module.task_executor_registry, "resolve", lambda kind: (_ for _ in ()).throw(AssertionError(kind)))
    execute_task_module.run_task_celery("task-consistency")
    assert called == ["task-consistency"]
    sync_engine.dispose()


def test_run_task_celery_routes_script_variant_to_attempt_lifecycle(monkeypatch, tmp_path) -> None:
    """变体分析迁入 Attempt 后不得回退到旧 script executor 注册表。"""
    db_path = tmp_path / "variant-attempt-route.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-variant",
                mode="async_polling",
                task_kind="script_variant",
                status="pending",
                progress=0,
                payload={"snapshot": {"run_args": {}}},
                result=None,
                error="",
            )
        )
        db.commit()
    called: list[str] = []

    async def _run_attempt(task_id: str, *, work_id: str | None = None) -> None:
        assert work_id is None
        called.append(task_id)

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "_run_script_variant_attempt_task", _run_attempt)
    monkeypatch.setattr(execute_task_module.task_executor_registry, "resolve", lambda kind: (_ for _ in ()).throw(AssertionError(kind)))
    execute_task_module.run_task_celery("task-variant")
    assert called == ["task-variant"]
    sync_engine.dispose()


def test_run_task_celery_routes_script_merge_to_attempt_lifecycle(monkeypatch, tmp_path) -> None:
    """实体合并迁入 Attempt 后不得回退到旧 script executor 注册表。"""
    db_path = tmp_path / "merge-attempt-route.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(GenerationTask(id="task-merge", mode="async_polling", task_kind="script_merge", status="pending", progress=0, payload={"snapshot": {"run_args": {"all_shot_extractions": []}}}, result=None, error=""))
        db.commit()
    called: list[str] = []

    async def _run_attempt(task_id: str, *, work_id: str | None = None) -> None:
        assert work_id is None
        called.append(task_id)

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "_run_script_merge_attempt_task", _run_attempt)
    monkeypatch.setattr(execute_task_module.task_executor_registry, "resolve", lambda kind: (_ for _ in ()).throw(AssertionError(kind)))
    execute_task_module.run_task_celery("task-merge")
    assert called == ["task-merge"]
    sync_engine.dispose()


@pytest.mark.asyncio
async def test_materialize_attempt_commits_retry_state_after_worker_error() -> None:
    """物化异常时必须提交 Worker 已写入的 retry 状态，不能由上下文回滚 lease。"""
    class _Db:
        def __init__(self) -> None:
            self.commits = 0

        async def commit(self) -> None:
            self.commits += 1

    class _Worker:
        async def execute_next(self, **_kwargs: object) -> str | None:
            raise RuntimeError("temporary provider error")

    db = _Db()
    assert await execute_task_module._execute_materialize_attempt(db=db, worker=_Worker()) is None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_execute_media_driver_adapts_lifecycle_command(monkeypatch) -> None:
    """媒体生命周期入口必须经通用 Driver，而非直接调用旧 Worker。"""

    captured = []
    worker_execution = object()

    class _FakeMediaDriver:
        async def execute(self, command):  # noqa: ANN001
            captured.append(command)
            return DriverExecution(
                callback=ExecutionAttemptCallback(
                    attempt_id="run-1",
                    lease_epoch=2,
                    kind=ExecutionAttemptCallbackKind.succeeded,
                ),
                output=MediaDriverOutput(worker_execution=worker_execution),
            )

    command = SimpleNamespace(
        run_id="run-1",
        task_id="task-1",
        lease_epoch=2,
        lease_owner="celery:task-1",
        lease_ttl_seconds=3600,
        operation=SimpleNamespace(value="image_generation"),
        snapshot=SimpleNamespace(model_dump=lambda **_kwargs: {"operation": "image_generation"}),
        cancel_requested=False,
        provider_idempotency_key="provider-key",
    )
    monkeypatch.setattr(execute_task_module, "MediaTaskExecutionDriver", _FakeMediaDriver)

    actual = await execute_task_module._execute_media_driver(command)

    assert actual is worker_execution
    assert len(captured) == 1
    generic_command = captured[0]
    assert generic_command.lease.attempt_id == "run-1"
    assert generic_command.task_kind == "image_generation"
    assert generic_command.snapshot == {"operation": "image_generation"}
    assert generic_command.idempotency_key == "provider-key"


def test_enqueue_task_execution_records_executor(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "task-enqueue.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-2",
                mode="async_polling",
                task_kind="script_extract",
                status="pending",
                progress=0,
                payload={"task_kind": "script_extract", "run_args": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(
        execute_task_module.run_task_celery,
        "delay",
        lambda task_id: SimpleNamespace(id=f"celery-{task_id}"),
    )

    result = execute_task_module.enqueue_task_execution("task-2")
    assert result.id == "celery-task-2"

    with sync_session_local() as db:
        row = db.get(GenerationTask, "task-2")
        assert row is not None
        assert row.executor_type == "celery"
        assert row.executor_task_id == "celery-task-2"
        dispatch = db.get(GenerationRunDispatch, "celery-task-2")
        assert dispatch is not None
        assert (dispatch.task_id, dispatch.source, dispatch.status) == ("task-2", "outbox", "enqueued")

    sync_engine.dispose()


def test_revoke_task_execution_revokes_celery_task(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "task-revoke.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-revoke",
                mode="async_polling",
                task_kind="video_generation",
                status="running",
                progress=30,
                payload={"task_kind": "video_generation", "run_args": {}},
                result=None,
                error="",
                executor_type="celery",
                executor_task_id="celery-task-revoke",
            )
        )
        db.commit()

    calls: list[tuple[str, bool, str]] = []

    class _FakeAsyncResult:
        def __init__(self, task_id: str, app=None) -> None:  # noqa: ANN001
            self.task_id = task_id

        def revoke(self, *, terminate: bool, signal: str) -> None:
            calls.append((self.task_id, terminate, signal))

    monkeypatch.setattr(execute_task_module, "sync_session_maker", sync_session_local)
    monkeypatch.setattr(execute_task_module, "AsyncResult", _FakeAsyncResult)

    assert execute_task_module.revoke_task_execution("task-revoke") is True
    assert calls == [("celery-task-revoke", True, "SIGTERM")]

    sync_engine.dispose()


def test_dispatch_generation_outbox_celery_runs_dispatcher(monkeypatch) -> None:
    """Beat task 必须调用统一 Outbox dispatcher，而非让路由直接投递。"""

    class _FakeDispatcher:
        def dispatch_pending(self) -> int:
            return 3

    monkeypatch.setattr(execute_task_module, "GenerationOutboxDispatcher", _FakeDispatcher)
    monkeypatch.setattr(execute_task_module, "GenerationRunDispatchDispatcher", _FakeDispatcher)

    assert execute_task_module.dispatch_generation_outbox_celery() == 6


def test_async_delegating_executors_use_positional_runner_signature() -> None:
    for task_kind, executor in task_executor_registry._executors.items():
        if not isinstance(executor, AbstractAsyncDelegatingExecutor):
            continue
        signature = inspect.signature(executor._runner)
        params = list(signature.parameters.values())
        assert len(params) == 2, f"{task_kind} runner must accept exactly 2 params, got {signature}"
        assert all(
            param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
            for param in params
        ), f"{task_kind} runner must accept positional args, got {signature}"


def test_generation_async_executor_dispatches_only_submitter_snapshot(monkeypatch, tmp_path) -> None:
    """图片/视频执行器只将 P3 command 与 snapshot 交给运行时。"""
    db_path = tmp_path / "snapshot-dispatch.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    command = {"operation": "video_generation", "delivery": "async_polling"}
    snapshot = {"model_id": "model-1"}
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-snapshot",
                mode="async_polling",
                task_kind="video_generation",
                status="pending",
                progress=0,
                payload={"command": command, "snapshot": snapshot},
                result=None,
                error="",
            )
        )
        db.commit()

    received: dict[str, object] = {}

    async def _runner(task_id: str, execution_payload: dict) -> None:
        received["task_id"] = task_id
        received["payload"] = execution_payload

    async def _close_db() -> None:
        return None

    monkeypatch.setattr("app.services.worker.task_executor.reset_db_runtime", lambda: None)
    monkeypatch.setattr("app.services.worker.task_executor.close_db", _close_db)
    executor = AbstractAsyncDelegatingExecutor(
        task_kind="video_generation",
        runner=_runner,
        require_generation_snapshot=True,
        session_maker=sync_session_local,
    )

    executor.run("task-snapshot")

    assert received == {
        "task_id": "task-snapshot",
        "payload": {"command": command, "snapshot": snapshot},
    }
    sync_engine.dispose()


def test_generation_async_executor_rejects_legacy_run_args(monkeypatch, tmp_path) -> None:
    """历史图片/视频 payload 不得再把 Provider 凭据传进 Worker。"""
    db_path = tmp_path / "legacy-payload.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-legacy",
                mode="async_polling",
                task_kind="image_generation",
                status="pending",
                progress=0,
                payload={
                    "task_kind": "image_generation",
                    "run_args": {"api_key": "must-not-be-read", "base_url": "https://legacy.invalid"},
                },
                result=None,
                error="",
            )
        )
        db.commit()

    called: list[str] = []

    async def _runner(task_id: str, _execution_payload: dict) -> None:
        called.append(task_id)

    monkeypatch.setattr("app.services.worker.task_executor.reset_db_runtime", lambda: None)
    executor = AbstractAsyncDelegatingExecutor(
        task_kind="image_generation",
        runner=_runner,
        require_generation_snapshot=True,
        session_maker=sync_session_local,
    )

    with pytest.raises(RuntimeError, match="Generation snapshot is required.*legacy run_args"):
        executor.run("task-legacy")

    assert called == []
    with sync_session_local() as db:
        row = db.get(GenerationTask, "task-legacy")
        assert row is not None
        assert row.status == "failed"
        assert "legacy run_args payload is unsupported" in (row.error or "")
    sync_engine.dispose()


def test_async_delegating_executor_marks_failed_on_timeout(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "async-executor-timeout.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-timeout",
                mode="async_polling",
                task_kind="video_generation",
                status="pending",
                progress=0,
                payload={"task_kind": "video_generation", "run_args": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    async def _runner(_task_id: str, _run_args: dict) -> None:
        await asyncio.sleep(0.05)

    async def _close_db() -> None:
        return None

    monkeypatch.setattr("app.services.worker.task_executor.reset_db_runtime", lambda: None)
    monkeypatch.setattr("app.services.worker.task_executor.close_db", _close_db)

    executor = AbstractAsyncDelegatingExecutor(
        task_kind="video_generation",
        runner=_runner,
        timeout_seconds=0.01,
        session_maker=sync_session_local,
    )
    executor.run("task-timeout")

    with sync_session_local() as db:
        row = db.get(GenerationTask, "task-timeout")
        assert row is not None
        assert row.status == "failed"
        assert "timed out" in (row.error or "")

    sync_engine.dispose()


def test_async_delegating_executor_marks_cancelled_before_start(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "async-executor-cancel.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-cancelled",
                mode="async_polling",
                task_kind="image_generation",
                status="running",
                progress=10,
                payload={"task_kind": "image_generation", "run_args": {}},
                result=None,
                error="",
                cancel_requested=True,
            )
        )
        db.commit()

    called: list[str] = []

    async def _runner(task_id: str, _run_args: dict) -> None:
        called.append(task_id)

    async def _close_db() -> None:
        return None

    monkeypatch.setattr("app.services.worker.task_executor.reset_db_runtime", lambda: None)
    monkeypatch.setattr("app.services.worker.task_executor.close_db", _close_db)

    executor = AbstractAsyncDelegatingExecutor(
        task_kind="image_generation",
        runner=_runner,
        timeout_seconds=10,
        session_maker=sync_session_local,
    )
    executor.run("task-cancelled")

    assert called == []
    with sync_session_local() as db:
        row = db.get(GenerationTask, "task-cancelled")
        assert row is not None
        assert row.status == "cancelled"
        assert bool(row.cancel_requested) is True

    sync_engine.dispose()


def test_async_delegating_executor_closes_db_in_same_event_loop(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "async-executor-close-loop.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-close-loop",
                mode="async_polling",
                task_kind="image_generation",
                status="pending",
                progress=0,
                payload={"task_kind": "image_generation", "run_args": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    loops: dict[str, asyncio.AbstractEventLoop] = {}

    async def _runner(_task_id: str, _run_args: dict) -> None:
        loops["runner"] = asyncio.get_running_loop()

    async def _close_db() -> None:
        loops["close_db"] = asyncio.get_running_loop()

    monkeypatch.setattr("app.services.worker.task_executor.reset_db_runtime", lambda: None)
    monkeypatch.setattr("app.services.worker.task_executor.close_db", _close_db)

    executor = AbstractAsyncDelegatingExecutor(
        task_kind="image_generation",
        runner=_runner,
        timeout_seconds=10,
        session_maker=sync_session_local,
    )
    executor.run("task-close-loop")

    assert loops["runner"] is loops["close_db"]

    sync_engine.dispose()


def test_sync_executor_marks_failed_on_boundary_timeout(tmp_path) -> None:
    db_path = tmp_path / "sync-executor-timeout.db"
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    sync_session_local = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401

    Base.metadata.create_all(sync_engine)
    with sync_session_local() as db:
        db.add(
            GenerationTask(
                id="task-sync-timeout",
                mode="async_polling",
                task_kind="script_divide",
                status="pending",
                progress=0,
                payload={"task_kind": "script_divide", "run_args": {}},
                result=None,
                error="",
            )
        )
        db.commit()

    class _SlowExecutor(AbstractWorkerTaskExecutor):
        task_kind = "script_divide"
        timeout_seconds = 0.01

        def __init__(self) -> None:
            super().__init__(session_maker=sync_session_local)

        def execute(self, ctx: WorkerTaskContext, run_args: dict[str, object]) -> dict[str, object]:  # noqa: ARG002
            import time

            time.sleep(0.03)
            return {"ok": True}

    _SlowExecutor().run("task-sync-timeout")

    with sync_session_local() as db:
        row = db.get(GenerationTask, "task-sync-timeout")
        assert row is not None
        assert row.status == "failed"
        assert "timed out" in (row.error or "")

    sync_engine.dispose()


def test_task_executor_registry_resolves_sync_and_async_executor_types() -> None:
    divide_executor = task_executor_registry.resolve("script_divide")
    merge_executor = task_executor_registry.resolve("script_merge")
    variant_executor = task_executor_registry.resolve("script_variant")

    assert isinstance(divide_executor, AbstractWorkerTaskExecutor)
    assert divide_executor.task_kind == "script_divide"
    assert isinstance(merge_executor, MergeTaskExecutor)
    assert merge_executor.task_kind == "script_merge"
    assert isinstance(variant_executor, VariantTaskExecutor)
    assert variant_executor.task_kind == "script_variant"
    with pytest.raises(RuntimeError, match="Unsupported task_kind: video_generation"):
        task_executor_registry.resolve("video_generation")


def test_script_merge_executor_requires_frozen_text_agent_snapshot() -> None:
    """实体合并 Worker 不再接受历史 run_args payload。"""

    executor = MergeTaskExecutor()
    legacy_context = SimpleNamespace(task=SimpleNamespace(payload={"run_args": {"all_shot_extractions": []}}))
    valid_context = SimpleNamespace(
        task=SimpleNamespace(
            payload={
                "command": {"operation": "text_agent"},
                "snapshot": {"run_args": {"all_shot_extractions": []}},
            }
        )
    )

    with pytest.raises(RuntimeError, match="command and snapshot are required"):
        executor.load_run_args(legacy_context)
    assert executor.load_run_args(valid_context) == {"all_shot_extractions": []}
