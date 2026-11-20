"""固定业务资源的统一提示词渲染 API。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.asset_prompts import AssetPromptOptions
from app.models.studio import AssetViewAngle
from app.schemas.studio.assets import SceneCreate, PropCreate, CostumeCreate
from app.schemas.studio.cast import ActorCreate, CharacterCreate
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.generation.prompts import AssetImagePromptRenderInput, PromptRendererName, PromptRenderRequest, RenderedPromptSnapshot, prompt_renderer_registry

router = APIRouter()


class AssetImagePromptRenderBody(AssetPromptOptions):
    """资产图片渲染允许编辑的槽位资源；目标仅由路径唯一确定。"""

    model_config = ConfigDict(extra="forbid")


class DraftAssetPromptRenderBody(AssetPromptOptions):
    """仅预览本地对象草稿，不创建对象、图片或任务。"""

    asset_type: Literal["actor", "character", "prop", "scene", "costume"]
    resource: ActorCreate | CharacterCreate | SceneCreate | PropCreate | CostumeCreate
    view_angle: AssetViewAngle = AssetViewAngle.front
    image_id: int | None = Field(None, ge=1, description="局部修改预览所用的当前对象图片")


@router.post("/assets/draft/render", response_model=ApiResponse[RenderedPromptSnapshot], summary="预览未创建对象的图片提示词")
async def render_draft_asset_image_prompt(
    body: DraftAssetPromptRenderBody, db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptSnapshot]:
    from app.services.studio.generation.asset_image.draft_preview import render_draft_preview
    snapshot = await render_draft_preview(db, entity_type=body.asset_type,
        resource=body.resource.model_dump(exclude_unset=True), view_angle=body.view_angle, image_id=body.image_id,
        options=AssetPromptOptions.model_validate(body.model_dump(exclude={"asset_type", "resource", "view_angle", "image_id"})))
    return success_response(snapshot)


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
                **body.model_dump(),
            )
        ),
    )
    return success_response(snapshot)
