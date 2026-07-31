"""统一 Celery 执行入口。

职责：
- Celery 统一只接收业务 task_id；
- 通过 GenerationTask.task_kind + registry 找到具体 WorkerTaskExecutor；
- 回写 executor_type / executor_task_id，便于排障。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from celery import current_task
from celery.result import AsyncResult

from app.core.celery_app import celery_app
from app.core.db_sync import sync_session_maker
from app.core.db import async_session_maker, close_db, reset_db_runtime
from app.models.task import GenerationTask
from app.models.generation_run_dispatches import GenerationRunDispatch
from app.services.generation.dispatch import GenerationOutboxDispatcher, GenerationRunDispatchDispatcher
from app.services.generation.runtime.coordinator import GenerationLifecycleCoordinator
from app.services.generation.runtime.executor import GenerationExecutor
from app.services.generation.runtime.reaper import GenerationRunReaper
from app.services.generation.runtime.workers import execute_worker_command
from app.core.contracts.generation_run import GenerationWorkerCallback, GenerationWorkerCallbackKind
from app.services.worker.task_registry import task_executor_registry

logger = logging.getLogger(__name__)


def _record_executor_dispatch(
    task_id: str,
    *,
    executor_type: str,
    executor_task_id: str | None,
    source: str,
) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        row.executor_type = executor_type
        row.executor_task_id = executor_task_id
        if executor_task_id:
            event = db.get(GenerationRunDispatch, executor_task_id)
            if event is None:
                db.add(
                    GenerationRunDispatch(
                        work_id=executor_task_id,
                        task_id=task_id,
                        source=source,
                        status="enqueued",
                        enqueued_at=datetime.now(UTC).replace(tzinfo=None),
                    )
                )
        db.commit()


def enqueue_task_execution(task_id: str, *, source: str = "outbox", work_id: str | None = None) -> AsyncResult:
    async_result = run_task_celery.apply_async(args=(task_id,), task_id=work_id) if work_id else run_task_celery.delay(task_id)
    _record_executor_dispatch(
        task_id,
        executor_type="celery",
        executor_task_id=async_result.id,
        source=source,
    )
    return async_result


def revoke_task_execution(task_id: str, *, terminate: bool = True, signal: str = "SIGTERM") -> bool:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return False
        if (row.executor_type or "").strip() != "celery":
            return False
        executor_task_id = (row.executor_task_id or "").strip()
        if not executor_task_id:
            return False

    try:
        AsyncResult(executor_task_id, app=celery_app).revoke(terminate=terminate, signal=signal)
    except Exception:  # noqa: BLE001
        logger.exception("failed to revoke celery task: task_id=%s executor_task_id=%s", task_id, executor_task_id)
        return False
    return True


@celery_app.task(name="task.execute")
def run_task_celery(task_id: str) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        task_kind = (row.task_kind or "").strip() or str((row.payload or {}).get("task_kind") or "").strip()
    if task_kind in {"image_generation", "video_generation"}:
        work_id = getattr(current_task.request, "id", None)
        asyncio.run(_run_generation_lifecycle_task(task_id, work_id=work_id))
        return
    executor = task_executor_registry.resolve(task_kind)
    executor.run(task_id)


async def _run_generation_lifecycle_task(task_id: str, *, work_id: str | None = None) -> None:
    """在 Celery 进程中执行 Command → Worker → callback 的生命周期主链。"""

    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            command = await GenerationExecutor(db).claim_command(
                task_id=task_id,
                owner=f"celery:{task_id}",
                lease_ttl_seconds=3600,
                work_id=work_id,
            )
            await db.commit()
        if command is None:
            return
        if command.cancel_requested:
            execution = _cancelled_worker_execution(command)
        else:
            execution = await execute_worker_command(command)
        async with async_session_maker() as db:
            await GenerationLifecycleCoordinator().handle_callback(
                db=db,
                callback=execution.callback,
                provider_result=execution.provider_result,
            )
            await db.commit()
    finally:
        await close_db()


def _cancelled_worker_execution(command):  # noqa: ANN001, ANN201
    """把 Executor 观察到的取消意图转为 callback，避免启动 Provider。"""
    from app.services.generation.runtime.workers import GenerationWorkerExecution

    return GenerationWorkerExecution(
        callback=GenerationWorkerCallback(
            run_id=command.run_id,
            lease_epoch=command.lease_epoch,
            kind=GenerationWorkerCallbackKind.cancelled,
            error_code="generation_cancelled",
            error="任务已取消",
        )
    )


@celery_app.task(name="task.dispatch_generation_outbox")
def dispatch_generation_outbox_celery() -> int:
    """由 Celery Beat 投递已提交但尚未发送的统一生成任务。"""
    return GenerationOutboxDispatcher().dispatch_pending() + GenerationRunDispatchDispatcher().dispatch_pending()


@celery_app.task(name="task.reap_generation_runs")
def reap_generation_runs_celery() -> int:
    """回收过期 lease；持久化事件在提交后由 dispatcher 可靠发布。"""
    recovered = asyncio.run(_reap_generation_runs())
    GenerationRunDispatchDispatcher().dispatch_pending()
    return recovered


async def _reap_generation_runs() -> int:
    """在异步事务内完成 Run 恢复，提交后才向 Celery 发送重试消息。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            recovered = await GenerationRunReaper(db).reap_expired(limit=100)
            await db.commit()
            return recovered
    finally:
        await close_db()
