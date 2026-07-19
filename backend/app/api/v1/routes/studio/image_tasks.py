from __future__ import annotations

"""资产与镜头相关的图片生成任务 API。

通过 TaskManager 调用 `ImageGenerationTask`，并使用 `GenerationTaskLink`
将任务与上层业务实体（演员形象/道具/场景/服装/角色/镜头分镜帧）建立关联。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.image_generation import ImageResolutionProfile, ImageTargetRatio
from app.dependencies import get_db
from app.models.studio import (
    ShotDetail,
    ShotFrameType,
    ShotFrameImage,
)
from app.schemas.common import ApiResponse, created_response, success_response
from app.schemas.studio.shots import RenderedShotFramePromptRead, ShotLinkedAssetItem
from app.api.v1.routes.film.common import TaskCreated
from app.services.studio.image_task_references import (
    resolve_reference_image_refs_by_file_ids as _resolve_reference_image_refs_by_file_ids_service,
)
from app.services.studio.generation.asset_image import (
    build_actor_image_base_draft as _build_actor_image_base_draft_service,
    build_actor_image_submission_payload as _build_actor_image_submission_payload_service,
    build_asset_image_base_draft as _build_asset_image_base_draft_service,
    build_asset_image_context as _build_asset_image_context_service,
    build_asset_image_submission_payload as _build_asset_image_submission_payload_service,
    build_character_image_base_draft as _build_character_image_base_draft_service,
    build_character_image_submission_payload as _build_character_image_submission_payload_service,
    derive_asset_image_preview as _derive_asset_image_preview_service,
)
from app.services.studio.generation.frame import (
    build_frame_base_draft as _build_frame_base_draft_service,
    build_frame_context as _build_frame_context_service,
    build_frame_submission_payload as _build_frame_submission_payload_service,
    derive_frame_preview as _derive_frame_preview_service,
)
from app.services.film.shot_frame_prompt_tasks import build_run_args as _build_shot_frame_prompt_run_args_service
from app.services.studio.generation.frame.derive_preview import (
    to_rendered_shot_frame_prompt_read as _to_rendered_shot_frame_prompt_read_service,
)
from app.services.studio.image_task_runner import create_image_task_and_link as _create_image_task_and_link_service


router = APIRouter()


class StudioImageTaskRequest(BaseModel):
    """Studio 专用图片任务请求体：可选模型 ID，不传则用默认图片模型；供应商由模型反查。

    image_id 表示具体的图片模型 ID，例如：
    - 演员图片：ActorImage.id
    - 场景图片：SceneImage.id
    - 道具图片：PropImage.id
    - 服装图片：CostumeImage.id
    - 角色图片：CharacterImage.id
    - 分镜帧图片：ShotFrameImage.id
    """

    model_id: str | None = Field(
        None,
        description="可选模型 ID（models.id）；不传则使用 ModelSettings.default_image_model_id；Provider 由模型关联反查",
    )
    image_id: int | None = Field(
        None,
        description="图片模型 ID，如 ActorImage.id / SceneImage.id / PropImage.id 等；必须与路径主体 ID 匹配",
    )
    prompt: str | None = Field(
        None,
        description="提示词（由前端传入）。创建任务接口必填；render-prompt 接口可不传",
    )
    images: list[str] = Field(
        default_factory=list,
        description="参考图 file_id 列表（可多张，顺序有效）。创建任务接口会基于 file_id 从数据中解析为参考图",
    )


class ShotFrameImageTaskRequest(BaseModel):
    """镜头分镜帧图片生成请求体：只根据 `shot_id + frame_type` 定位 ShotFrameImage。

    用于替代旧接口中通过 `image_id` 直接传入 ShotFrameImage.id 的方式。
    """

    model_id: str | None = Field(
        None,
        description="可选模型 ID（models.id）；不传则使用 ModelSettings.default_image_model_id；Provider 由模型关联反查",
    )
    frame_type: ShotFrameType = Field(..., description="first | last | key")
    prompt: str = Field(
        ...,
        description="提示词（由前端传入，创建任务接口必填）。",
        min_length=1,
    )
    images: list[ShotLinkedAssetItem] = Field(
        default_factory=list,
        description=(
            "参考资产条目列表（可多张，顺序有效）。后端会使用 item.file_id 作为参考图；"
            "无效条目会被跳过。"
        ),
    )
    target_ratio: ImageTargetRatio = Field(
        ...,
        description="目标视频画幅比例；关键帧将按该画幅生成，以提升后续视频参考稳定性",
    )
    resolution_profile: ImageResolutionProfile | None = Field(
        "standard",
        description="关键帧输出分辨率档位，默认 standard",
    )


class ShotFramePromptRenderRequest(BaseModel):
    """镜头分镜帧提示词渲染请求体。"""

    frame_type: ShotFrameType = Field(..., description="first | last | key")
    prompt: str = Field(
        ...,
        description="原始基础提示词。渲染接口要求显式传入，用于生成最终提示词。",
        min_length=1,
    )
    images: list[ShotLinkedAssetItem] = Field(
        default_factory=list,
        description="参考资产条目列表（可多张，顺序有效）。后端会使用 item.file_id 作为参考图；无效条目会被跳过。",
    )


class RenderedPromptResponse(BaseModel):
    prompt: str = Field(..., description="渲染后的提示词（已套用模板与变量替换）")
    images: list[str] = Field(
        default_factory=list,
        description="参考图 file_id 列表（自动选择；顺序有效）",
    )
    template_id: str | None = Field(None, description="本次渲染使用的模板 ID；未命中模板时为空")
    template_version: int | None = Field(None, description="本次渲染使用的模板版本号")
    merged_variables: dict[str, str] = Field(default_factory=dict, description="模板默认值、业务事实与图片覆盖合并后的变量")


async def _load_frame_render_guidance(
    *,
    db: AsyncSession,
    shot_id: str,
    frame_type: ShotFrameType,
) -> dict[str, str]:
    """读取最终图片提示词需要保留的高优先级镜头约束。"""
    try:
        run_args = await _build_shot_frame_prompt_run_args_service(
            db,
            shot_id=shot_id,
            frame_type=frame_type.value if hasattr(frame_type, "value") else str(frame_type),
        )
    except HTTPException:
        return {
            "director_command_summary": "",
            "continuity_guidance": "",
            "frame_specific_guidance": "",
            "composition_anchor": "",
            "screen_direction_guidance": "",
        }

    input_dict = dict(run_args.get("input") or {})
    return {
        "director_command_summary": str(input_dict.get("director_command_summary") or "").strip(),
        "continuity_guidance": str(input_dict.get("continuity_guidance") or "").strip(),
        "frame_specific_guidance": str(input_dict.get("frame_specific_guidance") or "").strip(),
        "composition_anchor": str(input_dict.get("composition_anchor") or "").strip(),
        "screen_direction_guidance": str(input_dict.get("screen_direction_guidance") or "").strip(),
    }



@router.post(
    "/actors/{actor_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="演员图片生成（任务版）",
)
async def create_actor_image_generation_task(
    actor_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为指定演员创建图片生成任务，并通过 `GenerationTaskLink` 关联。"""
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required for actor generation",
        )
    base = await _build_actor_image_base_draft_service(
        db,
        actor_id=actor_id,
        image_id=body.image_id,
    )
    submission = await _build_actor_image_submission_payload_service(
        db,
        actor_id=actor_id,
        image_id=body.image_id,
        prompt=prompt,
        images=body.images,
    )
    ref_images = await _resolve_reference_image_refs_by_file_ids_service(db, file_ids=submission.images)
    task_id = await _create_image_task_and_link_service(
        db=db,
        model_id=body.model_id,
        relation_type=submission.relation_type,
        relation_entity_id=submission.relation_entity_id,
        prompt=submission.prompt,
        images=ref_images if ref_images else None,
        render_context={
            "template_id": base.template_id,
            "template_version": base.template_version,
            "merged_variables": base.merged_variables,
            "template_rendered_prompt": base.prompt,
            "submitted_prompt": submission.prompt,
        },
    )
    return created_response(TaskCreated(task_id=task_id))


@router.post(
    "/actors/{actor_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="演员图片提示词渲染",
)
async def render_actor_image_prompt(
    actor_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    base = await _build_actor_image_base_draft_service(
        db,
        actor_id=actor_id,
        image_id=body.image_id,
    )
    context = _build_asset_image_context_service(base=base)
    derived = _derive_asset_image_preview_service(base=base, context=context)
    return success_response(
        RenderedPromptResponse(
            prompt=derived.prompt,
            images=derived.images,
            template_id=base.template_id,
            template_version=base.template_version,
            merged_variables=base.merged_variables,
        )
    )


@router.post(
    "/assets/{asset_type}/{asset_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="道具/场景/服装图片生成（任务版）",
)
async def create_asset_image_generation_task(
    asset_type: str,
    asset_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为道具/场景/服装创建图片生成任务。

    - asset_type: prop / scene / costume
    - path 参数 asset_id 为对应资产 ID
    - body.image_id 必须为该资产下对应图片表记录的 ID（PropImage/SceneImage/CostumeImage）
    """
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required for asset image generation",
        )
    submission = await _build_asset_image_submission_payload_service(
        db,
        asset_type=asset_type,
        asset_id=asset_id,
        image_id=body.image_id,
        prompt=prompt,
        images=body.images,
    )
    ref_images = await _resolve_reference_image_refs_by_file_ids_service(db, file_ids=submission.images)

    task_id = await _create_image_task_and_link_service(
        db=db,
        model_id=body.model_id,
        relation_type=submission.relation_type,
        relation_entity_id=submission.relation_entity_id,
        prompt=submission.prompt,
        images=ref_images if ref_images else None,
    )
    return created_response(TaskCreated(task_id=task_id))


@router.post(
    "/assets/{asset_type}/{asset_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="道具/场景/服装图片提示词渲染",
)
async def render_asset_image_prompt(
    asset_type: str,
    asset_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    base = await _build_asset_image_base_draft_service(
        db,
        asset_type=asset_type,
        asset_id=asset_id,
        image_id=body.image_id,
    )
    context = _build_asset_image_context_service(base=base)
    derived = _derive_asset_image_preview_service(base=base, context=context)
    return success_response(RenderedPromptResponse(prompt=derived.prompt, images=derived.images))


@router.post(
    "/characters/{character_id}/image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="角色图片生成（任务版）",
)
async def create_character_image_generation_task(
    character_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为角色创建图片生成任务（对应 CharacterImage 业务）。

    - path 参数 character_id 为 Character.id
    - body.image_id 必须为该角色下的 CharacterImage.id
    """
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required for character image generation",
        )
    submission = await _build_character_image_submission_payload_service(
        db,
        character_id=character_id,
        image_id=body.image_id,
        prompt=prompt,
        images=body.images,
    )
    ref_images = await _resolve_reference_image_refs_by_file_ids_service(db, file_ids=submission.images)
    task_id = await _create_image_task_and_link_service(
        db=db,
        model_id=body.model_id,
        relation_type=submission.relation_type,
        relation_entity_id=submission.relation_entity_id,
        prompt=submission.prompt,
        images=ref_images if ref_images else None,
    )
    return created_response(TaskCreated(task_id=task_id))


@router.post(
    "/characters/{character_id}/render-prompt",
    response_model=ApiResponse[RenderedPromptResponse],
    status_code=status.HTTP_200_OK,
    summary="角色图片提示词渲染",
)
async def render_character_image_prompt(
    character_id: str,
    body: StudioImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedPromptResponse]:
    base = await _build_character_image_base_draft_service(
        db,
        character_id=character_id,
        image_id=body.image_id,
    )
    context = _build_asset_image_context_service(base=base)
    derived = _derive_asset_image_preview_service(base=base, context=context)
    return success_response(RenderedPromptResponse(prompt=derived.prompt, images=derived.images))


@router.post(
    "/shot/{shot_id}/frame-image-tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="镜头分镜帧图片生成（任务版）",
)
async def create_shot_frame_image_generation_task(
    shot_id: str,
    body: ShotFrameImageTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """为镜头分镜帧图片生成任务（基于 `shot_id + frame_type` 自动定位数据）。"""
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required for shot frame generation",
        )
    shot_detail = await db.get(ShotDetail, shot_id)
    if shot_detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ShotDetail not found")
    render_guidance = await _load_frame_render_guidance(
        db=db,
        shot_id=shot_id,
        frame_type=body.frame_type,
    )
    base = _build_frame_base_draft_service(
        shot_id=shot_id,
        frame_type=body.frame_type,
        prompt=prompt,
        director_command_summary=render_guidance["director_command_summary"],
        continuity_guidance=render_guidance["continuity_guidance"],
        frame_specific_guidance=render_guidance["frame_specific_guidance"],
        composition_anchor=render_guidance["composition_anchor"],
        screen_direction_guidance=render_guidance["screen_direction_guidance"],
    )
    context = _build_frame_context_service(
        shot_id=shot_id,
        frame_type=body.frame_type,
        items=body.images,
    )
    submission = _build_frame_submission_payload_service(
        base=base,
        context=context,
    )
    ref_images = await _resolve_reference_image_refs_by_file_ids_service(db, file_ids=submission.images)

    # 通过 shot_id 与 frame_type 定位 ShotFrameImage，作为落库目标；若不存在则创建占位记录。
    shot_frame_image_stmt = (
        select(ShotFrameImage)
        .where(ShotFrameImage.shot_detail_id == shot_id, ShotFrameImage.frame_type == body.frame_type)
        .limit(1)
    )
    shot_frame_image = (await db.execute(shot_frame_image_stmt)).scalars().first()
    if shot_frame_image is None:
        # 缺少对应 frame_type 的 ShotFrameImage slot：创建占位记录（file_id 允许为空）。
        # 后续图片生成完成后会覆盖写回 file_id。
        shot_frame_image = ShotFrameImage(
            shot_detail_id=shot_id,
            frame_type=body.frame_type,
            file_id=None,
            width=None,
            height=None,
            format="png",
        )
        db.add(shot_frame_image)
        await db.flush()
        await db.refresh(shot_frame_image)
    else:
        # 已存在则补齐默认字段（不改写 file_id）。
        if not shot_frame_image.format:
            shot_frame_image.format = "png"

    submission_extra = dict(submission.extra or {})
    task_id = await _create_image_task_and_link_service(
        db=db,
        model_id=body.model_id,
        relation_type="shot_frame_image",
        relation_entity_id=str(shot_frame_image.id),
        prompt=submission.prompt,
        images=ref_images if ref_images else None,
        target_ratio=body.target_ratio,
        resolution_profile=body.resolution_profile,
        purpose="video_reference",
        render_context=submission_extra.get("render_context"),
    )
    return created_response(TaskCreated(task_id=task_id))


@router.post(
    "/shot/{shot_id}/frame-render-prompt",
    response_model=ApiResponse[RenderedShotFramePromptRead],
    status_code=status.HTTP_200_OK,
    summary="镜头分镜帧提示词渲染",
)
async def render_shot_frame_prompt(
    shot_id: str,
    body: ShotFramePromptRenderRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[RenderedShotFramePromptRead]:
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required for shot frame render",
        )
    render_guidance = await _load_frame_render_guidance(
        db=db,
        shot_id=shot_id,
        frame_type=body.frame_type,
    )
    base = _build_frame_base_draft_service(
        shot_id=shot_id,
        frame_type=body.frame_type,
        prompt=prompt,
        director_command_summary=render_guidance["director_command_summary"],
        continuity_guidance=render_guidance["continuity_guidance"],
        frame_specific_guidance=render_guidance["frame_specific_guidance"],
        composition_anchor=render_guidance["composition_anchor"],
        screen_direction_guidance=render_guidance["screen_direction_guidance"],
    )
    context = _build_frame_context_service(
        shot_id=shot_id,
        frame_type=body.frame_type,
        items=body.images,
    )
    rendered = _to_rendered_shot_frame_prompt_read_service(
        derived=_derive_frame_preview_service(
            base=base,
            context=context,
        )
    )
    return success_response(rendered)
