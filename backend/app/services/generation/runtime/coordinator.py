"""GenerationRun callback 的唯一终态协调器。"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_delivery import GenerationOutcome
from app.core.contracts.generation_run import GenerationWorkerCallback, GenerationWorkerCallbackKind
from app.core.contracts.image_generation import ImageGenerationResult
from app.core.contracts.video_generation import VideoGenerationResult
from app.core.task_manager import SqlAlchemyTaskStore
from app.models.generation_artifacts import GenerationArtifact
from app.models.generation_runs import GenerationRun
from app.models.task import GenerationTask
from app.services.generation.runtime.finalizer import TaskFinalizer
from app.services.generation.runtime.artifacts import ArtifactStore


_OPERATION_BY_TASK_KIND = {
    "image_generation": GenerationOperation.image_generation,
    "video_generation": GenerationOperation.video_generation,
}


class GenerationCallbackDisposition(str, Enum):
    """描述 callback 是否取得当前 Run 的终态写权限。"""

    accepted = "accepted"
    ignored_stale = "ignored_stale"
    ignored_duplicate = "ignored_duplicate"


class GenerationLifecycleCoordinator:
    """以 ``run_id + lease_epoch`` fencing 收口 Worker 的唯一终态回调。

    调用方负责管理事务并在本方法成功后提交；本服务将 Run、Artifact、领域
    Handler 与 GenerationTask 的终态写入组合到同一事务。任何未匹配当前 epoch
    的 callback 都会在读取 Task 或 Artifact 前返回，保持零副作用。
    """

    def __init__(self, *, finalizer: TaskFinalizer | None = None) -> None:
        """注入内部 Finalizer，便于测试并避免 Worker 直接拥有终态写入能力。"""
        self._finalizer = finalizer or TaskFinalizer()

    async def handle_callback(
        self,
        *,
        db: AsyncSession,
        callback: GenerationWorkerCallback,
        artifacts: Sequence[GenerationArtifact] = (),
        provider_result: ImageGenerationResult | VideoGenerationResult | None = None,
    ) -> GenerationCallbackDisposition:
        """验证 callback 的 fencing token，并唯一执行对应的终态交付。

        ``provider_result`` 是 Worker 进程内的临时结果，绝不持久化到 callback
        payload。Coordinator 会将其归档为当前 Run 的 Artifact；``artifacts`` 仅为
        迁移期兼容入口，且必须已经归属当前 Run。
        """
        run = await self._claim_terminalization(db=db, callback=callback)
        if run is None:
            duplicate = await self._is_duplicate(db=db, callback=callback)
            return GenerationCallbackDisposition.ignored_duplicate if duplicate else GenerationCallbackDisposition.ignored_stale
        if any(artifact.generation_run_id != run.id for artifact in artifacts):
            raise ValueError("callback artifacts must belong to the fenced generation run")

        task = await db.get(GenerationTask, run.task_id)
        if task is None:
            raise RuntimeError(f"generation run task does not exist: {run.task_id}")
        operation = _OPERATION_BY_TASK_KIND.get(task.task_kind)
        snapshot_payload = (task.payload or {}).get("snapshot")
        if operation is None or not isinstance(snapshot_payload, dict):
            raise RuntimeError(f"generation run has no executable snapshot: {run.id}")
        snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
        store = SqlAlchemyTaskStore(db)

        if callback.kind is GenerationWorkerCallbackKind.succeeded:
            if provider_result is not None:
                artifacts = await self._archive_provider_result(
                    db=db,
                    run=run,
                    snapshot=snapshot,
                    operation=operation,
                    provider_result=provider_result,
                )
            result = await self._finalizer.finalize_success(
                db=db,
                store=store,
                task_id=run.task_id,
                operation=operation,
                snapshot=snapshot,
                artifacts=list(artifacts),
            )
            error = result.error_message if result.outcome is GenerationOutcome.failed else None
        elif callback.kind is GenerationWorkerCallbackKind.failed:
            error = callback.error or callback.error_code or "generation worker failed"
            await self._finalizer.finalize_failure(
                db=db,
                store=store,
                task_id=run.task_id,
                operation=operation,
                snapshot=snapshot,
                error=error,
            )
        else:
            error = callback.error or callback.error_code or "generation cancelled"
            await self._finalizer.finalize_cancelled(
                db=db,
                store=store,
                task_id=run.task_id,
                operation=operation,
                snapshot=snapshot,
                reason=error,
            )

        run.status = "terminal"
        run.provider_task_id = callback.provider_task_id
        run.error = error
        run.callback_payload = _callback_audit_payload(callback)
        run.finished_at = datetime.now(UTC).replace(tzinfo=None)
        await db.flush()
        return GenerationCallbackDisposition.accepted

    @staticmethod
    async def _archive_provider_result(
        *,
        db: AsyncSession,
        run: GenerationRun,
        snapshot: ResolvedGenerationSnapshot,
        operation: GenerationOperation,
        provider_result: ImageGenerationResult | VideoGenerationResult,
    ) -> list[GenerationArtifact]:
        """按当前 Run 归档 Worker 内存结果，禁止跨模态或跨 Run 写入。"""
        artifact_store = ArtifactStore()
        if operation is GenerationOperation.image_generation:
            if not isinstance(provider_result, ImageGenerationResult):
                raise ValueError("image callback requires ImageGenerationResult")
            return await artifact_store.store_images(
                db,
                task_id=run.task_id,
                generation_run_id=run.id,
                result=provider_result,
                name_prefix=f"image-{snapshot.canonical_target.entity_id}",
                storage_prefix=f"generated-images/{snapshot.canonical_target.kind.value}",
            )
        if not isinstance(provider_result, VideoGenerationResult):
            raise ValueError("video callback requires VideoGenerationResult")
        from app.services.film.generated_video import _resolve_snapshot_provider_config

        provider_config = await _resolve_snapshot_provider_config(db, snapshot=snapshot)
        headers = {"Authorization": f"Bearer {provider_config.api_key}"} if provider_config.provider == "openai" else None
        artifact = await artifact_store.store_video(
            db,
            task_id=run.task_id,
            generation_run_id=run.id,
            result=provider_result,
            name=f"shot-{snapshot.canonical_target.entity_id}-video",
            storage_prefix=f"generated-videos/shots/{snapshot.canonical_target.entity_id}",
            url_request_headers=headers,
            httpx_timeout=600.0,
        )
        return [artifact]

    @staticmethod
    async def _claim_terminalization(
        *, db: AsyncSession, callback: GenerationWorkerCallback
    ) -> GenerationRun | None:
        """锁定且仅允许当前活跃 epoch 进入 terminalizing。"""
        run = (
            await db.execute(
                select(GenerationRun)
                .where(
                    GenerationRun.id == callback.run_id,
                    GenerationRun.lease_epoch == callback.lease_epoch,
                    GenerationRun.status.in_(("claimed", "executing")),
                )
                .with_for_update()
            )
        ).scalars().first()
        if run is not None:
            run.status = "terminalizing"
            await db.flush()
        return run

    @staticmethod
    async def _is_duplicate(*, db: AsyncSession, callback: GenerationWorkerCallback) -> bool:
        """区分当前 epoch 已终态的重复 callback 与显然过期的 callback。"""
        run = await db.get(GenerationRun, callback.run_id)
        return run is not None and run.lease_epoch == callback.lease_epoch and run.status in {"terminalizing", "terminal"}


def _callback_audit_payload(callback: GenerationWorkerCallback) -> dict[str, str | int | None]:
    """保存可审计的 callback 摘要，不持久化 Provider 临时结果。"""

    return {
        "run_id": callback.run_id,
        "lease_epoch": callback.lease_epoch,
        "kind": callback.kind.value,
        "provider_task_id": callback.provider_task_id,
        "error_code": callback.error_code,
        "error": callback.error,
    }


__all__ = ["GenerationCallbackDisposition", "GenerationLifecycleCoordinator"]
