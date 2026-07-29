"""固定业务资源的统一提示词渲染 API。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.studio import ShotFrameType
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.shots import ShotLinkedAssetItem
from app.services.generation.prompts import (
    AssetImagePromptRenderInput,
    PromptRendererName,
    PromptRenderRequest,
    RenderedPromptSnapshot,
    ShotFramePromptRenderInput,
    ShotVideoPromptRenderInput,
    prompt_renderer_registry,
)
from app.services.generation.prompts.frame_guidance import load_frame_render_guidance

router = APIRouter()


class AssetImagePromptRenderBody(BaseModel):
    """资产图片渲染允许编辑的槽位资源；目标仅由路径唯一确定。"""

    model_config = ConfigDict(extra="forbid")

    reference_file_ids: list[str] = Field(default_factory=list)


class ShotFramePromptRenderBody(BaseModel):
    """分镜帧渲染允许编辑的基础提示词与参考资产。"""

    model_config = ConfigDict(extra="forbid")

    prompt: str = ""
    images: list[ShotLinkedAssetItem] = Field(default_factory=list)


class ShotVideoPromptRenderBody(BaseModel):
    """镜头视频渲染允许编辑的提示词、模板与参考帧。"""

    model_config = ConfigDict(extra="forbid")

    reference_mode: Literal["first", "last", "key", "first_last", "first_last_key", "text_only"]
    prompt: str | None = None
    image_file_ids: list[str] = Field(default_factory=list)
    template_id: str | None = None


@router.post(
    "/assets/{asset_type}/{asset_id}/slots/{slot_id}/render",
    response_model=ApiResponse[RenderedPromptSnapshot],
    summary="渲染资产图片提示词",
)
async def render_asset_image_prompt(
    asset_type: Literal["actor", "character", "prop", "scene", "costume"],
    asset_id: str,
    slot_id: int,
    body: AssetImagePromptRenderBody,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptSnapshot]:
    """按固定资产槽位绑定 Renderer，避免请求体重复声明业务目标。"""
    snapshot = await prompt_renderer_registry.resolve(PromptRendererName.asset_image).render(
        db,
        PromptRenderRequest(
            input=AssetImagePromptRenderInput(
                entity_type=asset_type,
                entity_id=asset_id,
                image_id=slot_id,
                reference_file_ids=body.reference_file_ids,
            )
        ),
    )
    return success_response(snapshot)


@router.post(
    "/shots/{shot_id}/frames/{frame_type}/render",
    response_model=ApiResponse[RenderedPromptSnapshot],
    summary="渲染分镜帧提示词",
)
async def render_shot_frame_prompt(
    shot_id: str,
    frame_type: ShotFrameType,
    body: ShotFramePromptRenderBody,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptSnapshot]:
    """加载镜头固有 guidance 后渲染指定帧，帧类型只信任路径参数。"""
    guidance = await load_frame_render_guidance(db=db, shot_id=shot_id, frame_type=frame_type)
    snapshot = await prompt_renderer_registry.resolve(PromptRendererName.shot_frame).render(
        db,
        PromptRenderRequest(
            input=ShotFramePromptRenderInput(
                shot_id=shot_id,
                frame_type=frame_type,
                prompt=body.prompt,
                images=body.images,
                director_command_summary=guidance["director_command_summary"],
                continuity_guidance=guidance["continuity_guidance"],
                frame_specific_guidance=guidance["frame_specific_guidance"],
                composition_anchor=guidance["composition_anchor"],
                screen_direction_guidance=guidance["screen_direction_guidance"],
            )
        ),
    )
    return success_response(snapshot)


@router.post(
    "/shots/{shot_id}/video/render",
    response_model=ApiResponse[RenderedPromptSnapshot],
    summary="渲染镜头视频提示词",
)
async def render_shot_video_prompt(
    shot_id: str,
    body: ShotVideoPromptRenderBody,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptSnapshot]:
    """按固定镜头绑定视频 Renderer，允许用户调整模板和参考帧。"""
    snapshot = await prompt_renderer_registry.resolve(PromptRendererName.shot_video).render(
        db,
        PromptRenderRequest(
            input=ShotVideoPromptRenderInput(
                shot_id=shot_id,
                reference_mode=body.reference_mode,
                prompt=body.prompt,
                image_file_ids=body.image_file_ids,
                template_id=body.template_id,
            )
        ),
    )
    return success_response(snapshot)
