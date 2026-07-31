"""只执行 Provider 的 GenerationWorker 适配层。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.core.contracts.generation import GenerationOperation
from app.core.contracts.generation_run import (
    GenerationWorkerCallback,
    GenerationWorkerCallbackKind,
    GenerationWorkerCommand,
)
from app.core.contracts.image_generation import ImageGenerationResult
from app.core.contracts.video_generation import VideoGenerationResult
from app.core.db import async_session_maker
from app.models.generation_runs import GenerationRun
from app.services.generation.runtime.run_repository import GenerationRunRepository
from app.services.film.generated_video import execute_snapshot_video_generation
from app.services.studio.image_task_runner import execute_snapshot_image_generation


@dataclass(frozen=True, slots=True)
class GenerationWorkerExecution:
    """Worker 执行的内存结果；仅 Celery 适配器可将其交给 Coordinator。"""

    callback: GenerationWorkerCallback
    provider_result: ImageGenerationResult | VideoGenerationResult | None = None


async def execute_worker_command(command: GenerationWorkerCommand) -> GenerationWorkerExecution:
    """消费冻结 Command 并执行 Provider，绝不写 Task、Artifact 或领域投影。"""

    stop_heartbeat = asyncio.Event()
    heartbeat_task = asyncio.create_task(_renew_lease_until_stopped(command, stop_heartbeat))
    try:
        async with async_session_maker() as db:
            run = await db.get(GenerationRun, command.run_id)
            if run is None:
                raise RuntimeError(f"generation run is unavailable: {command.run_id}")

            async def _record_accepted(provider_task_id: str) -> bool:
                """使用独立短事务写入供应商受理检查点，不与长轮询共享会话。"""
                async with async_session_maker() as accepted_db:
                    recorded = await GenerationRunRepository(accepted_db).record_provider_accepted(
                        run_id=command.run_id,
                        owner=command.lease_owner,
                        lease_epoch=command.lease_epoch,
                        provider_task_id=provider_task_id,
                    )
                    await accepted_db.commit()
                    return recorded

            if command.operation is GenerationOperation.image_generation:
                result = await execute_snapshot_image_generation(
                    db,
                    task_id=command.task_id,
                    snapshot=command.snapshot,
                    provider_task_id=run.provider_task_id,
                    on_provider_accepted=_record_accepted,
                )
            elif command.operation is GenerationOperation.video_generation:
                result, _provider_config = await execute_snapshot_video_generation(
                    db,
                    task_id=command.task_id,
                    snapshot=command.snapshot,
                    provider_task_id=run.provider_task_id,
                    on_provider_accepted=_record_accepted,
                )
            else:  # pragma: no cover - Executor 仅支持当前两种异步模态
                raise ValueError(f"unsupported lifecycle operation: {command.operation.value}")
    except Exception as error:  # noqa: BLE001
        return GenerationWorkerExecution(
            callback=GenerationWorkerCallback(
                run_id=command.run_id,
                lease_epoch=command.lease_epoch,
                kind=GenerationWorkerCallbackKind.failed,
                error_code="generation_worker_failed",
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


__all__ = ["GenerationWorkerExecution", "execute_worker_command"]
