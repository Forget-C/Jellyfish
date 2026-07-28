"""复用 studio 渲染链的统一 PromptRenderer 实现。"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.media import ImageMediaInput, MediaReference
from app.services.generation.prompts.types import (
    AssetImagePromptRenderInput,
    PromptRendererName,
    PromptRenderRequest,
    RenderedPromptSnapshot,
    ShotFramePromptRenderInput,
    ShotVideoPromptRenderInput,
)
from app.services.studio.generation.asset_image.build_base import (
    build_actor_image_base_draft,
    build_asset_image_base_draft,
    build_character_image_base_draft,
)
from app.services.studio.generation.asset_image.build_context import build_asset_image_context
from app.services.studio.generation.asset_image.derive_preview import derive_asset_image_preview
from app.services.studio.generation.frame.build_base import build_frame_base_draft
from app.services.studio.generation.frame.build_context import build_frame_context
from app.services.studio.generation.frame.derive_preview import derive_frame_preview
from app.services.studio.generation.video.build_base import build_video_base_draft
from app.services.studio.generation.video.build_context import build_video_context
from app.services.studio.generation.video.derive_preview import derive_video_preview


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

        if render_input.entity_type == "actor":
            base = await build_actor_image_base_draft(
                db, actor_id=render_input.entity_id, image_id=render_input.image_id
            )
        elif render_input.entity_type == "character":
            base = await build_character_image_base_draft(
                db, character_id=render_input.entity_id, image_id=render_input.image_id
            )
        else:
            base = await build_asset_image_base_draft(
                db,
                asset_type=render_input.entity_type,
                asset_id=render_input.entity_id,
                image_id=render_input.image_id,
            )

        context = build_asset_image_context(base=base, images=render_input.reference_file_ids)
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


class ShotFramePromptRenderer:
    """将分镜帧 guidance 与资源映射渲染为单一最终图片提示词。"""

    name = PromptRendererName.shot_frame

    async def render(self, db: AsyncSession, request: PromptRenderRequest) -> RenderedPromptSnapshot:
        """复用分镜帧 base/context/preview 链，保持图片映射顺序。"""
        del db
        render_input = request.input
        if not isinstance(render_input, ShotFramePromptRenderInput):
            raise ValueError("shot_frame renderer requires shot_frame input")

        base = build_frame_base_draft(
            shot_id=render_input.shot_id,
            frame_type=render_input.frame_type,
            prompt=render_input.prompt,
            director_command_summary=render_input.director_command_summary,
            continuity_guidance=render_input.continuity_guidance,
            frame_specific_guidance=render_input.frame_specific_guidance,
            composition_anchor=render_input.composition_anchor,
            screen_direction_guidance=render_input.screen_direction_guidance,
        )
        context = build_frame_context(
            shot_id=render_input.shot_id,
            frame_type=render_input.frame_type,
            items=render_input.images,
        )
        preview = derive_frame_preview(base=base, context=context)
        return RenderedPromptSnapshot(
            render_id=_render_id(),
            renderer=self.name,
            execution_prompt=preview.rendered_prompt,
            variables_snapshot={
                "shot_id": render_input.shot_id,
                "frame_type": preview.frame_type,
                "prompt": preview.base_prompt,
                "reference_mappings": [item.model_dump(mode="json") for item in preview.mappings],
                "selected_guidance": preview.selected_guidance,
                "dropped_guidance": preview.dropped_guidance,
            },
            recommended_media=_image_media(preview.images),
            base_prompt=preview.base_prompt,
            selected_guidance=preview.selected_guidance,
            dropped_guidance=preview.dropped_guidance,
            selected_guidance_details=[item.model_dump() for item in preview.selected_guidance_details],
            dropped_guidance_details=[item.model_dump() for item in preview.dropped_guidance_details],
            reference_mappings=[item.model_dump() for item in preview.mappings],
        )


class ShotVideoPromptRenderer:
    """将镜头视频模板、镜头上下文和参考帧渲染为统一快照。"""

    name = PromptRendererName.shot_video

    async def render(self, db: AsyncSession, request: PromptRenderRequest) -> RenderedPromptSnapshot:
        """复用镜头视频 base/context/preview 链，并保留模板变量审计信息。"""
        render_input = request.input
        if not isinstance(render_input, ShotVideoPromptRenderInput):
            raise ValueError("shot_video renderer requires shot_video input")

        base = build_video_base_draft(shot_id=render_input.shot_id, prompt=render_input.prompt)
        context = await build_video_context(
            db,
            shot_id=render_input.shot_id,
            reference_mode=render_input.reference_mode,
            images=render_input.image_file_ids,
            template_id=render_input.template_id,
        )
        preview = await derive_video_preview(db, base=base, context=context)
        return RenderedPromptSnapshot(
            render_id=_render_id(),
            renderer=self.name,
            execution_prompt=preview.rendered_prompt,
            variables_snapshot={
                "shot_id": preview.shot_id,
                "reference_mode": preview.reference_mode,
                "pack": preview.pack.model_dump(mode="json"),
            },
            template_id=preview.template_id,
            recommended_media=_image_media(preview.images),
            warnings=preview.warnings,
        )
