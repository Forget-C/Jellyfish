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
from app.core.contracts.generation_run import GenerationWorkerCallback, GenerationWorkerCallbackKind
from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind, ExecutionAttemptLease
from app.services.execution_attempt_runtime import AttemptTerminalCoordinator, DriverExecution, TaskExecutionCommand
from app.services.worker.task_registry import task_executor_registry
from app.services.generation.runtime.media_driver import MediaDriverOutput, MediaTaskExecutionDriver
from app.services.generation.runtime.text_chat_driver import TextChatDeliveryHandler, TextChatTaskExecutionDriver
from app.services.generation.runtime.script_consistency_driver import ScriptConsistencyDeliveryHandler, ScriptConsistencyTaskExecutionDriver
from app.services.generation.runtime.script_variant_driver import ScriptVariantDeliveryHandler, ScriptVariantTaskExecutionDriver
from app.services.generation.runtime.script_merge_driver import ScriptMergeDeliveryHandler, ScriptMergeTaskExecutionDriver
from app.services.generation.runtime.media_delivery import MediaDeliveryCoordinator
from app.services.generation.storage.materializer import (
    MediaDeleteWorker,
    MediaMaterializeWorker,
    ProviderReceiptMaterializeSourceResolver,
    default_provider_receipt_source_registry,
)
from app.core import storage
from app.models.generation_artifacts import GenerationArtifact
from sqlalchemy import select

logger = logging.getLogger(__name__)

_DURABLE_ATTEMPT_TASK_KINDS = frozenset({"image_generation", "video_generation", "text_chat", "script_consistency", "script_variant", "script_merge"})


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
    if task_kind in _DURABLE_ATTEMPT_TASK_KINDS:
        work_id = getattr(current_task.request, "id", None)
        if task_kind == "script_consistency":
            asyncio.run(_run_script_consistency_attempt_task(task_id, work_id=work_id))
            return
        if task_kind == "script_variant":
            asyncio.run(_run_script_variant_attempt_task(task_id, work_id=work_id))
            return
        if task_kind == "script_merge":
            asyncio.run(_run_script_merge_attempt_task(task_id, work_id=work_id))
            return
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
        if command.operation.value in {"image_generation", "video_generation"}:
            if command.cancel_requested:
                execution = _cancelled_worker_execution(command)
            else:
                execution = await _execute_media_driver(command)
            async with async_session_maker() as db:
                await GenerationLifecycleCoordinator().handle_callback(
                    db=db,
                    callback=execution.callback,
                    provider_result=execution.provider_result,
                )
                await db.commit()
            if execution.provider_result is not None:
                materialize_media_celery.delay()
        else:
            attempt_command = _as_attempt_command(command)
            execution = _cancelled_attempt_execution(attempt_command) if command.cancel_requested else await _execute_text_chat_driver(attempt_command)
            async with async_session_maker() as db:
                await AttemptTerminalCoordinator().terminalize(
                    db=db,
                    command=attempt_command,
                    execution=execution,
                    handler=TextChatDeliveryHandler(),
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


async def _execute_media_driver(command):  # noqa: ANN001, ANN201
    """通过通用 Driver 协议运行媒体 Provider，并保留既有 Coordinator 交付兼容。"""
    execution = await MediaTaskExecutionDriver().execute(
        _as_attempt_command(command)
    )
    if not isinstance(execution.output, MediaDriverOutput):
        raise RuntimeError("media driver returned an unsupported output")
    return execution.output.worker_execution


def _as_attempt_command(command) -> TaskExecutionCommand:  # noqa: ANN001
    """将现有 GenerationRun 命令投影为中立的 ExecutionAttempt 输入。"""
    return TaskExecutionCommand(
        lease=ExecutionAttemptLease(
            attempt_id=command.run_id,
            task_id=command.task_id,
            lease_epoch=command.lease_epoch,
            lease_owner=command.lease_owner,
            lease_ttl_seconds=command.lease_ttl_seconds,
        ),
        task_kind=command.operation.value,
        snapshot=command.snapshot.model_dump(mode="json"),
        cancel_requested=command.cancel_requested,
        idempotency_key=command.provider_idempotency_key,
    )


async def _execute_text_chat_driver(command: TaskExecutionCommand) -> DriverExecution:
    """在独立会话中运行文本 Driver，令 Provider 调用不持有领取事务。"""
    async with async_session_maker() as db:
        return await TextChatTaskExecutionDriver(db).execute(command)


async def _run_script_consistency_attempt_task(task_id: str, *, work_id: str | None = None) -> None:
    """以通用 Attempt 领取并执行无领域写入的一致性检查。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            command = await GenerationExecutor(db).claim_attempt_command(
                task_id=task_id, owner=f"celery:{task_id}", lease_ttl_seconds=3600, work_id=work_id
            )
            await db.commit()
        if command is None:
            return
        execution = _cancelled_attempt_execution(command) if command.cancel_requested else await ScriptConsistencyTaskExecutionDriver().execute(command)
        async with async_session_maker() as db:
            await AttemptTerminalCoordinator().terminalize(
                db=db, command=command, execution=execution, handler=ScriptConsistencyDeliveryHandler()
            )
            await db.commit()
    finally:
        await close_db()


async def _run_script_variant_attempt_task(task_id: str, *, work_id: str | None = None) -> None:
    """以通用 Attempt 领取并执行无领域写入的剧本变体分析。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            command = await GenerationExecutor(db).claim_attempt_command(
                task_id=task_id, owner=f"celery:{task_id}", lease_ttl_seconds=3600, work_id=work_id
            )
            await db.commit()
        if command is None:
            return
        execution = _cancelled_attempt_execution(command) if command.cancel_requested else await ScriptVariantTaskExecutionDriver().execute(command)
        async with async_session_maker() as db:
            await AttemptTerminalCoordinator().terminalize(
                db=db, command=command, execution=execution, handler=ScriptVariantDeliveryHandler()
            )
            await db.commit()
    finally:
        await close_db()


async def _run_script_merge_attempt_task(task_id: str, *, work_id: str | None = None) -> None:
    """以通用 Attempt 领取并执行纯实体合并分析，不自动写回业务实体库。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            command = await GenerationExecutor(db).claim_attempt_command(
                task_id=task_id, owner=f"celery:{task_id}", lease_ttl_seconds=3600, work_id=work_id
            )
            await db.commit()
        if command is None:
            return
        execution = _cancelled_attempt_execution(command) if command.cancel_requested else await ScriptMergeTaskExecutionDriver().execute(command)
        async with async_session_maker() as db:
            await AttemptTerminalCoordinator().terminalize(
                db=db, command=command, execution=execution, handler=ScriptMergeDeliveryHandler()
            )
            await db.commit()
    finally:
        await close_db()


def _cancelled_attempt_execution(command: TaskExecutionCommand) -> DriverExecution:
    """把已领取的取消意图交给通用 Coordinator 唯一完成终态投影。"""
    return DriverExecution(
        callback=ExecutionAttemptCallback(
            attempt_id=command.lease.attempt_id,
            lease_epoch=command.lease.lease_epoch,
            kind=ExecutionAttemptCallbackKind.cancelled,
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


@celery_app.task(name="task.materialize_media")
def materialize_media_celery() -> str | None:
    """消费一个媒体 materialize outbox；重复投递由 lease 与幂等键安全吸收。"""
    return asyncio.run(_materialize_media())


@celery_app.task(name="task.delete_media")
def delete_media_celery() -> str | None:
    """消费一个媒体 delete outbox；失败保留墓碑并由 Beat 重试。"""
    return asyncio.run(_delete_media())


async def _materialize_media() -> str | None:
    """在 Worker 中执行受控媒体物化，并在全部 Blob 就绪时完成领域交付。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            async def _finalize_after_materialization(session, blob_id: str) -> None:  # noqa: ANN001
                """由当前 Blob 反查 Run，并仅在全部主产物可用时完成 Task。"""
                artifact = await session.scalar(select(GenerationArtifact).where(GenerationArtifact.blob_id == blob_id))
                if artifact is not None and artifact.generation_run_id is not None:
                    await MediaDeliveryCoordinator().finalize_if_ready(db=session, run_id=artifact.generation_run_id)

            worker = MediaMaterializeWorker(
                source_resolver=ProviderReceiptMaterializeSourceResolver(
                    db=db, registry=default_provider_receipt_source_registry()
                ),
                storage=storage,
                on_materialized=_finalize_after_materialization,
            )
            return await _execute_materialize_attempt(db=db, worker=worker)
    finally:
        await close_db()


async def _execute_materialize_attempt(*, db, worker) -> str | None:  # noqa: ANN001
    """执行一次物化并提交成功或 retry 状态，避免异常回滚已释放的 outbox lease。"""
    try:
        operation_id = await worker.execute_next(db=db, owner="celery:media-materialize")
    except Exception:  # noqa: BLE001 - Worker 已写入 retry 状态，必须提交后再由 Beat 重试。
        await db.commit()
        logger.exception("media materialize operation failed and was released for retry")
        return None
    await db.commit()
    return operation_id


async def _delete_media() -> str | None:
    """在独立 Worker 中执行对象删除，成功后才持久化 Blob 的物理删除状态。"""
    reset_db_runtime()
    try:
        async with async_session_maker() as db:
            worker = MediaDeleteWorker(storage=storage)
            return await _execute_delete_attempt(db=db, worker=worker)
    finally:
        await close_db()


async def _execute_delete_attempt(*, db, worker) -> str | None:  # noqa: ANN001
    """提交删除成功或 retry 状态，避免异常回滚已释放 lease。"""
    try:
        operation_id = await worker.execute_next(db=db, owner="celery:media-delete")
    except Exception:  # noqa: BLE001 - Worker 已写入 retry 状态，必须提交后再由 Beat 重试。
        await db.commit()
        logger.exception("media delete operation failed and was released for retry")
        return None
    await db.commit()
    return operation_id


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
