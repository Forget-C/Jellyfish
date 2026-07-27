"""镜头视频槽位的统一生成结果发布器。"""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationTargetKind, ResolvedGenerationSnapshot
from app.models.studio_shots import Shot
from app.services.generation.publishers.base import GenerationResultPublisher


class ShotVideoPublisher(GenerationResultPublisher):
    """以镜头视频专用版本字段保护自动采用，不改变 shot.status 语义。"""

    target_kind = GenerationTargetKind.shot_video

    async def _publish_file(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        file_id: str,
        expected_version_id: int,
    ) -> bool:
        """通过 Shot.generated_video_version_id 比较并单调递增版本。"""
        result = await db.execute(
            update(Shot)
            .where(
                Shot.id == snapshot.canonical_target.entity_id,
                Shot.generated_video_version_id == expected_version_id,
            )
            .values(
                generated_video_file_id=file_id,
                generated_video_version_id=Shot.generated_video_version_id + 1,
            )
        )
        return bool(result.rowcount)

