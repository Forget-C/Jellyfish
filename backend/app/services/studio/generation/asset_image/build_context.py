from __future__ import annotations

from app.services.studio.generation.asset_image.build_base import AssetImageBaseDraft
from app.services.studio.generation.shared.types import GenerationContext


class AssetImageContext(GenerationContext):
    """资产图片生成的动态上下文。"""

    kind: str = "asset_image"
    entity_type: str
    entity_id: str
    relation_type: str
    relation_entity_id: str
    images: list[str]
    source: str


def build_asset_image_context(
    *,
    base: AssetImageBaseDraft,
    images: list[str] | None = None,
) -> AssetImageContext:
    """保留显式空参考集合，防止用户移除的图片再次成为默认输入。"""
    normalized = [str(item).strip() for item in (images or []) if str(item).strip()]
    final_images = normalized if images is not None else list(base.default_images)
    source = "request" if images is not None else "default"
    return AssetImageContext(
        entity_type=base.entity_type,
        entity_id=base.entity_id,
        relation_type=base.relation_type,
        relation_entity_id=base.relation_entity_id,
        images=final_images,
        source=source,
    )

