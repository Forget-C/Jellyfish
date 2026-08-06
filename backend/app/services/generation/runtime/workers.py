"""只执行 Provider 的 GenerationWorker 适配层。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.core.contracts.generation import GenerationOperation
from app.core.contracts.provider_capabilities import provider_operation_capabilities
from app.core.contracts.provider_operation import ProviderCreateUncertainError
from app.core.contracts.generation_run import (
    GenerationWorkerCallback,
    GenerationWorkerCallbackKind,
    GenerationWorkerCommand,
)
from app.core.contracts.image_generation import ImageGenerationResult
from app.core.contracts.video_generation import VideoGenerationResult
from app.core.db import async_session_maker
from app.models.generation_runs import GenerationRun
from app.services.generation.runtime.provider_operation_repository import ProviderOperationRepository
from app.services.generation.runtime.run_repository import GenerationRunRepository
from app.services.film.generated_video import _resolve_snapshot_provider_config as resolve_video_provider_config, execute_snapshot_video_generation
from app.services.studio.image_task_runner import _resolve_snapshot_provider_config as resolve_image_provider_config, execute_snapshot_image_generation


@dataclass(frozen=True, slots=True)
class GenerationWorkerExecution:
    """Worker 执行的内存结果；仅 Celery 适配器可将其交给 Coordinator。"""

    callback: GenerationWorkerCallback
    provider_result: ImageGenerationResult | VideoGenerationResult | None = None


async def execute_worker_command(command: GenerationWorkerCommand) -> GenerationWorkerExecution:
    """消费冻结 Command 并执行 Provider，绝不写 Task、Artifact 或领域投影。"""

    stop_heartbeat = asyncio.Event()
    heartbeat_task = asyncio.create_task(_renew_lease_until_stopped(command, stop_heartbeat))
    operation_id: str | None = None
    provider_task_id: str | None = None
    try:
        async with async_session_maker() as db:
            run = await db.get(GenerationRun, command.run_id)
            if run is None:
                raise RuntimeError(f"generation run is unavailable: {command.run_id}")
            operation_id, provider_task_id = await _resolve_provider_operation_remote_id(
                db=db,
                command=command,
                legacy_provider_task_id=run.provider_task_id,
            )
            await db.commit()

            async def _record_accepted(provider_task_id: str) -> bool:
                """使用独立短事务写入供应商受理检查点，不与长轮询共享会话。"""
                async with async_session_maker() as accepted_db:
                    run_recorded = await GenerationRunRepository(accepted_db).record_provider_accepted(
                        run_id=command.run_id,
                        owner=command.lease_owner,
                        lease_epoch=command.lease_epoch,
                        provider_task_id=provider_task_id,
                    )
                    operation_repository = ProviderOperationRepository(accepted_db)
                    operation_recorded = await operation_repository.record_accepted(
                        operation_id=operation_id,
                        remote_id=provider_task_id,
                    )
                    polling_recorded = operation_recorded and await operation_repository.begin_polling(
                        operation_id=operation_id
                    )
                    await accepted_db.commit()
                    return run_recorded and operation_recorded and polling_recorded

            if command.operation is GenerationOperation.image_generation:
                if provider_task_id and not await ProviderOperationRepository(db).begin_polling(operation_id=operation_id):
                    raise RuntimeError("provider operation polling checkpoint was rejected")
                result = await execute_snapshot_image_generation(
                    db,
                    task_id=command.task_id,
                    snapshot=command.snapshot,
                    provider_task_id=provider_task_id,
                    on_provider_accepted=_record_accepted,
                )
            elif command.operation is GenerationOperation.video_generation:
                if provider_task_id and not await ProviderOperationRepository(db).begin_polling(operation_id=operation_id):
                    raise RuntimeError("provider operation polling checkpoint was rejected")
                result, _provider_config = await execute_snapshot_video_generation(
                    db,
                    task_id=command.task_id,
                    snapshot=command.snapshot,
                    provider_task_id=provider_task_id,
                    on_provider_accepted=_record_accepted,
                )
            else:  # pragma: no cover - Executor 仅支持当前两种异步模态
                raise ValueError(f"unsupported lifecycle operation: {command.operation.value}")
            if not await ProviderOperationRepository(db).record_remote_success(
                operation_id=operation_id,
                remote_status=result.status,
            ):
                raise RuntimeError("provider operation remote success checkpoint was rejected")
            await db.commit()
    except Exception as error:  # noqa: BLE001
        if isinstance(error, ProviderCreateUncertainError) and operation_id is not None:
            async with async_session_maker() as error_db:
                await ProviderOperationRepository(error_db).mark_create_uncertain(
                    operation_id=operation_id,
                    error_class="create_outcome_unknown",
                    error_message=str(error),
                )
                await error_db.commit()
        elif operation_id is not None and provider_task_id is not None:
            async with async_session_maker() as error_db:
                await ProviderOperationRepository(error_db).record_poll_error(
                    operation_id=operation_id,
                    error_class="poll_execution_error",
                    error_message=str(error),
                )
                await error_db.commit()
        return GenerationWorkerExecution(
            callback=GenerationWorkerCallback(
                run_id=command.run_id,
                lease_epoch=command.lease_epoch,
                kind=GenerationWorkerCallbackKind.failed,
                error_code="provider_create_uncertain" if isinstance(error, ProviderCreateUncertainError) else "generation_worker_failed",
                error=str(error),
            )
        )
    finally:
        stop_heartbeat.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

    return GenerationWorkerExecution(
        callback=GenerationWorkerCallback(
            run_id=command.run_id,
            lease_epoch=command.lease_epoch,
            kind=GenerationWorkerCallbackKind.succeeded,
            provider_task_id=result.provider_task_id,
        ),
        provider_result=result,
    )


async def _renew_lease_until_stopped(command: GenerationWorkerCommand, stop: asyncio.Event) -> None:
    """以独立短事务续租，避免长 Provider 调用耗尽当前 Run 的 lease。"""
    interval_seconds = max(1, command.lease_ttl_seconds // 3)
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            return
        except TimeoutError:
            pass
        async with async_session_maker() as db:
            renewed = await GenerationRunRepository(db).heartbeat(
                run_id=command.run_id,
                owner=command.lease_owner,
                lease_epoch=command.lease_epoch,
                ttl_seconds=command.lease_ttl_seconds,
            )
            await db.commit()
        if not renewed:
            return


async def _resolve_provider_operation_remote_id(
    *,
    db,
    command: GenerationWorkerCommand,
    legacy_provider_task_id: str | None,
) -> tuple[str, str | None]:  # noqa: ANN001
    """创建或读取 ProviderOperation，并将历史 Run checkpoint 回填为明确 receipt。"""
    provider_config = (
        await resolve_image_provider_config(db, snapshot=command.snapshot)
        if command.operation is GenerationOperation.image_generation
        else await resolve_video_provider_config(db, snapshot=command.snapshot)
    )
    capabilities = provider_operation_capabilities(
        provider_key=provider_config.provider,
        operation_kind=command.operation.value,
    )
    operation = await ProviderOperationRepository(db).create_or_get(
        attempt_id=command.run_id,
        operation_kind=command.operation.value,
        provider_key=provider_config.provider,
        model_id=command.snapshot.model_id,
        route_identity=_safe_route_identity(provider_config.base_url),
        capability_version="verified-v1",
        request_hash=None,
        idempotency_key=command.provider_idempotency_key,
    )
    receipt = await ProviderOperationRepository(db).get_remote_receipt(operation_id=operation.id)
    if receipt is not None:
        if not capabilities.supports_poll_by_handle or not capabilities.supports_result_retrieval_by_handle:
            raise RuntimeError("provider operation has a remote id but poll-by-handle is not verified")
        return operation.id, receipt.remote_id
    if legacy_provider_task_id:
        if not capabilities.supports_poll_by_handle or not capabilities.supports_result_retrieval_by_handle:
            raise RuntimeError("legacy provider checkpoint cannot be recovered without verified poll-by-handle support")
        if not await ProviderOperationRepository(db).record_accepted(
            operation_id=operation.id,
            remote_id=legacy_provider_task_id,
        ):
            raise RuntimeError("provider operation legacy checkpoint backfill was rejected")
        return operation.id, legacy_provider_task_id
    if not (
        capabilities.supports_remote_handle
        and capabilities.supports_poll_by_handle
        and capabilities.supports_result_retrieval_by_handle
    ):
        raise RuntimeError("durable media provider does not support recoverable remote receipts")
    return operation.id, None


def _safe_route_identity(base_url: str | None) -> dict[str, str | None]:
    """构造可审计但不含 URL query、fragment 或用户凭据的 Provider 路由身份。"""
    if not base_url:
        return {"scheme": None, "host": None, "path": None}
    parsed = urlsplit(base_url)
    return {
        "scheme": parsed.scheme or None,
        "host": parsed.hostname,
        "path": parsed.path.rstrip("/") or None,
    }


__all__ = ["GenerationWorkerExecution", "execute_worker_command"]
