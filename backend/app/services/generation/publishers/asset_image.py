"""资产图片槽位的统一生成结果发布器。"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationTargetKind, ImageGenerationOperationInput, ResolvedGenerationSnapshot
from app.services.studio.entity_specs import entity_spec
from app.services.generation.publishers.base import GenerationResultPublisher


class AssetImagePublisher(GenerationResultPublisher):
    """以 CAS 将图片 Artifact 自动采用到五类资产图片槽位。"""

    target_kind = GenerationTargetKind.asset_image_slot

    async def publish_terminal(self, db, *, snapshot, artifacts) -> None:
        """候选模式只归档结果，用户在图片历史中明确采用后才修改槽位。"""
        if isinstance(snapshot.operation_input, ImageGenerationOperationInput) and snapshot.operation_input.save_as_candidate:
            self._require_target(snapshot)
            for artifact in artifacts:
                self._mark_skipped(artifact, "awaiting_user_adoption")
            return
        await super().publish_terminal(db, snapshot=snapshot, artifacts=artifacts)

    async def _publish_file(
        self,
        db: AsyncSession,
        *,
        snapshot: ResolvedGenerationSnapshot,
        file_id: str,
        expected_version_id: int,
    ) -> bool:
        """按目标类别更新指定槽位；不匹配表示版本或所属资产已变化。"""
        slot_id = snapshot.canonical_target.slot_id
        if slot_id is None:
            raise ValueError("asset image target requires slot_id")
        try:
            numeric_slot_id = int(slot_id)
        except ValueError as error:
            raise ValueError("asset image slot_id must be numeric") from error

        spec = entity_spec(snapshot.canonical_target.asset_type)
        await db.scalar(select(spec.model.id).where(spec.model.id == snapshot.canonical_target.entity_id).with_for_update())
        model = spec.image_model
        parent_field = getattr(model, spec.id_field)
        result = await db.execute(
            update(model)
            .where(model.id == numeric_slot_id, parent_field == snapshot.canonical_target.entity_id, model.version_id == expected_version_id, model.file_id.is_(None))
            .values(file_id=file_id, version_id=model.version_id + 1)
        )
        if result.rowcount:
            from app.services.studio.entity_images import maintain_primary_image, maintain_view_defaults
            image = await db.get(model, numeric_slot_id, populate_existing=True)
            await maintain_primary_image(db, spec, snapshot.canonical_target.entity_id, image)
            await maintain_view_defaults(db, spec, snapshot.canonical_target.entity_id, image)
        return bool(result.rowcount)
