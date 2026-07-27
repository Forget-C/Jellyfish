"""资产图片槽位的统一生成结果发布器。"""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationTargetKind, ResolvedGenerationSnapshot
from app.models.studio_asset_images import ActorImage, CharacterImage, CostumeImage, PropImage, SceneImage
from app.services.generation.publishers.base import GenerationResultPublisher


class AssetImagePublisher(GenerationResultPublisher):
    """以 CAS 将图片 Artifact 自动采用到五类资产图片槽位。"""

    target_kind = GenerationTargetKind.asset_image_slot
    _slot_models = (ActorImage, CharacterImage, SceneImage, PropImage, CostumeImage)

    async def _publish_file(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        file_id: str,
        expected_version_id: int,
    ) -> bool:
        """更新匹配的跨资产槽位；所有候选都不匹配即表示版本或目标已变化。"""
        slot_id = snapshot.canonical_target.slot_id
        if slot_id is None:
            raise ValueError("asset image target requires slot_id")
        try:
            numeric_slot_id = int(slot_id)
        except ValueError as error:
            raise ValueError("asset image slot_id must be numeric") from error

        for model in self._slot_models:
            result = await db.execute(
                update(model)
                .where(model.id == numeric_slot_id, model.version_id == expected_version_id)
                .values(file_id=file_id, version_id=model.version_id + 1)
            )
            if result.rowcount:
                return True
        return False

