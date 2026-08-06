"""媒体 Blob 物化完成后的短事务终态交付。"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_delivery import GenerationOutcome
from app.core.task_manager import SqlAlchemyTaskStore
from app.models.generation_artifacts import GenerationArtifact
from app.models.generation_runs import GenerationRun
from app.models.media_blobs import MediaBlob
from app.models.studio import FileItem
from app.models.task import GenerationTask
from app.models.types import FileType
from app.services.generation.runtime.finalizer import TaskFinalizer


_OPERATION_BY_TASK_KIND = {
    "image_generation": GenerationOperation.image_generation,
    "video_generation": GenerationOperation.video_generation,
}


class MediaDeliveryCoordinator:
    """在所有 Blob 可用后绑定 FileItem，并复用 Finalizer 唯一完成媒体任务终态。"""

    def __init__(self, *, finalizer: TaskFinalizer | None = None) -> None:
        """注入 Finalizer，保证媒体发布仍沿用现有 WorkflowHandler 与 CAS 语义。"""
        self._finalizer = finalizer or TaskFinalizer()

    async def finalize_if_ready(self, *, db: AsyncSession, run_id: str) -> bool:
        """若 Run 的全部主产物已物化则终态化；尚有 pending Blob 时返回 False。"""
        run = (
            await db.execute(select(GenerationRun).where(GenerationRun.id == run_id).with_for_update())
        ).scalars().first()
        if run is None or run.status != "delivering":
            return False
        task = await db.get(GenerationTask, run.task_id)
        if task is None:
            raise RuntimeError(f"media delivery task does not exist: {run.task_id}")
        operation = _OPERATION_BY_TASK_KIND.get(task.task_kind)
        snapshot_payload = (task.payload or {}).get("snapshot")
        if operation is None or not isinstance(snapshot_payload, dict):
            raise RuntimeError(f"media delivery has no executable snapshot: {run.id}")
        artifacts = list(
            (await db.scalars(select(GenerationArtifact).where(GenerationArtifact.generation_run_id == run.id).order_by(GenerationArtifact.ordinal).with_for_update()))
        )
        if not artifacts:
            raise RuntimeError(f"media delivery has no staged artifacts: {run.id}")
        blob_ids = [artifact.blob_id for artifact in artifacts]
        if any(blob_id is None for blob_id in blob_ids):
            raise RuntimeError(f"media delivery artifact has no blob: {run.id}")
        blobs = {
            blob.id: blob
            for blob in await db.scalars(select(MediaBlob).where(MediaBlob.id.in_(blob_ids)).with_for_update())
        }
        if len(blobs) != len(blob_ids) or any(blobs[blob_id].status != "materialized" for blob_id in blob_ids):
            return False
        self._bind_file_items(db=db, artifacts=artifacts, blobs=blobs)
        snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
        result = await self._finalizer.finalize_success(
            db=db,
            store=SqlAlchemyTaskStore(db),
            task_id=task.id,
            operation=operation,
            snapshot=snapshot,
            artifacts=artifacts,
        )
        run.status = "terminal"
        run.error = result.error_message if result.outcome is GenerationOutcome.failed else None
        run.finished_at = datetime.now(UTC).replace(tzinfo=None)
        await db.flush()
        return True

    @staticmethod
    def _bind_file_items(
        *, db: AsyncSession, artifacts: list[GenerationArtifact], blobs: dict[str, MediaBlob]
    ) -> None:
        """用已经 HEAD 验证的稳定 key 创建 FileItem，不触发对象存储 I/O。"""
        for artifact in artifacts:
            if artifact.file_id is not None:
                continue
            blob_id = artifact.blob_id
            if blob_id is None:
                raise RuntimeError("media artifact blob is unavailable")
            blob = blobs[blob_id]
            file_type = FileType.image if artifact.modality == "image" else FileType.video
            file_item = FileItem(
                id=uuid4().hex,
                type=file_type,
                name=f"generated-{artifact.modality}-{artifact.ordinal}",
                thumbnail="",
                tags=[],
                storage_key=blob.storage_key,
            )
            db.add(file_item)
            artifact.file_id = file_item.id


__all__ = ["MediaDeliveryCoordinator"]
