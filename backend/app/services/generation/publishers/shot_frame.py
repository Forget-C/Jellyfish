"""分镜帧槽位的统一生成结果发布器。"""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationTargetKind, ResolvedGenerationSnapshot
from app.models.studio_shots import ShotFrameImage
from app.services.generation.publishers.base import GenerationResultPublisher


class ShotFramePublisher(GenerationResultPublisher):
    """以 CAS 将主图片 Artifact 发布到指定的分镜帧槽位。"""

    target_kind = GenerationTargetKind.shot_frame_slot

    async def _publish_file(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        file_id: str,
        expected_version_id: int,
    ) -> bool:
        """只更新 slot_id 指向的帧行，不通过 relation_type 推断目标。"""
        slot_id = snapshot.canonical_target.slot_id
        if slot_id is None:
            raise ValueError("shot frame target requires slot_id")
        try:
            numeric_slot_id = int(slot_id)
        except ValueError as error:
            raise ValueError("shot frame slot_id must be numeric") from error
        result = await db.execute(
            update(ShotFrameImage)
            .where(ShotFrameImage.id == numeric_slot_id, ShotFrameImage.version_id == expected_version_id)
            .values(file_id=file_id, version_id=ShotFrameImage.version_id + 1)
        )
        return bool(result.rowcount)

