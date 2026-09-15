"""复用 studio 渲染链的统一 PromptRenderer 实现。"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.asset_prompts import AssetPromptOptions
from app.core.contracts.media import ImageMediaInput, MediaReference
from app.services.generation.prompts.types import (
    AssetImagePromptRenderInput,
    PromptRendererName,
    PromptRenderRequest,
    RenderedPromptSnapshot,
)
from app.services.studio.generation.asset_image.build_base import (
    build_actor_image_base_draft,
    build_asset_image_base_draft,
    build_character_image_base_draft,
)
from app.services.studio.generation.asset_image.build_context import build_asset_image_context
from app.services.studio.generation.asset_image.derive_preview import derive_asset_image_preview


def _image_media(file_ids: list[str]) -> ImageMediaInput:
    """将稳定 file_id 顺序投影为图片生成推荐媒体引用。"""
    return ImageMediaInput(
        references=[
            MediaReference(file_id=file_id, media_kind="image", ordinal=index)
            for index, file_id in enumerate(file_ids)
        ]
    )


def _render_id() -> str:
    """生成仅用于审计关联的渲染快照标识。"""
    return str(uuid4())


class AssetImagePromptRenderer:
    """将演员、角色和资产图片的现有模板逻辑包装为统一快照。"""

    name = PromptRendererName.asset_image

    async def render(self, db: AsyncSession, request: PromptRenderRequest) -> RenderedPromptSnapshot:
        """复用资产图片 base/context/preview 链并返回建议参考图片。"""
        render_input = request.input
        if not isinstance(render_input, AssetImagePromptRenderInput):
            raise ValueError("asset_image renderer requires asset_image input")

        options = AssetPromptOptions.model_validate(render_input.model_dump(exclude={"kind", "entity_type", "entity_id", "image_id"}))
        if render_input.entity_type == "actor":
            base = await build_actor_image_base_draft(
                db, actor_id=render_input.entity_id, image_id=render_input.image_id, options=options
            )
        elif render_input.entity_type == "character":
            base = await build_character_image_base_draft(
                db, character_id=render_input.entity_id, image_id=render_input.image_id, options=options
            )
        else:
            base = await build_asset_image_base_draft(
                db,
                options=options,
                asset_type=render_input.entity_type,
                asset_id=render_input.entity_id,
                image_id=render_input.image_id,
            )

        context = build_asset_image_context(base=base)
        preview = derive_asset_image_preview(base=base, context=context)
        return RenderedPromptSnapshot(
            render_id=_render_id(),
            renderer=self.name,
            execution_prompt=preview.prompt,
            variables_snapshot=base.merged_variables,
            template_id=base.template_id,
            template_version=base.template_version,
            recommended_media=_image_media(preview.images),
        )
