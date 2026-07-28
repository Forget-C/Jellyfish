"""固定媒体资源的统一生成任务入口。

路由是业务 Binder：仅由路径派生目标、模态、operation 与交付方式，避免
客户端同时维护请求体目标和 URL 目标两份事实来源。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.film.common import TaskCreated
from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    VideoGenerationOperationInput,
)
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.dependencies import get_db
from app.models.studio import ShotDetail, ShotFrameImage, ShotFrameType
from app.schemas.common import ApiResponse, created_response
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.tasks.execute_task import enqueue_task_execution

router = APIRouter()


def _require_image_request(body: GenerationSubmitRequest) -> None:
    """确保图片固定路由只接收图片 operation 与图片参考媒体。"""
    if not isinstance(body.operation_input, ImageGenerationOperationInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="operation_input_invalid")
    if body.media is not None and not isinstance(body.media, ImageMediaInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="media_role_invalid")


def _require_video_request(body: GenerationSubmitRequest) -> None:
    """确保视频固定路由只接收视频 operation 与保持分组语义的视频媒体。"""
    if not isinstance(body.operation_input, VideoGenerationOperationInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="operation_input_invalid")
    if body.media is not None and not isinstance(body.media, VideoMediaInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="media_role_invalid")


async def _submit_async_task(
    db: AsyncSession,
    *,
    modality: GenerationModality,
    operation: GenerationOperation,
    target: GenerationTarget,
    body: GenerationSubmitRequest,
) -> ApiResponse[TaskCreated]:
    """提交已由资源路径绑定的命令，并在事务提交后才投递 Worker。"""
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(
        db,
        GenerationCommand(
            modality=modality,
            operation=operation,
            delivery=GenerationDelivery.async_polling,
            target=target,
            request=body,
        ),
    )
    await db.commit()
    enqueue_task_execution(accepted.task_id)
    return created_response(TaskCreated(task_id=accepted.task_id))


async def _get_or_create_frame_slot(
    db: AsyncSession,
    *,
    shot_id: str,
    frame_type: ShotFrameType,
) -> ShotFrameImage:
    """为已存在镜头获取帧槽位，缺失时在提交事务内创建可 CAS 发布的占位槽位。"""
    if await db.get(ShotDetail, shot_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    statement = (
        select(ShotFrameImage)
        .where(ShotFrameImage.shot_detail_id == shot_id, ShotFrameImage.frame_type == frame_type)
        .limit(1)
    )
    slot = (await db.execute(statement)).scalars().first()
    if slot is not None:
        return slot
    slot = ShotFrameImage(
        shot_detail_id=shot_id,
        frame_type=frame_type,
        file_id=None,
        width=None,
        height=None,
        format="png",
    )
    db.add(slot)
    await db.flush()
    return slot


@router.post(
    "/shots/{shot_id}/frames/{frame_type}",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交镜头分镜帧图片任务",
)
async def submit_shot_frame_generation_task(
    shot_id: str,
    frame_type: ShotFrameType,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定镜头帧槽位后提交图片任务；最终提示词由客户端先经 render API 确认。"""
    _require_image_request(body)
    slot = await _get_or_create_frame_slot(db, shot_id=shot_id, frame_type=frame_type)
    return await _submit_async_task(
        db,
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        target=GenerationTarget(
            kind=GenerationTargetKind.shot_frame_slot,
            entity_id=shot_id,
            slot_id=str(slot.id),
        ),
        body=body,
    )


@router.post(
    "/shots/{shot_id}/video",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交镜头视频任务",
)
async def submit_shot_video_generation_task(
    shot_id: str,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定镜头后提交视频任务；视频帧与具名主体媒体的分组直接冻结到快照。"""
    _require_video_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.video,
        operation=GenerationOperation.video_generation,
        target=GenerationTarget(kind=GenerationTargetKind.shot_video, entity_id=shot_id),
        body=body,
    )


@router.post(
    "/actors/{actor_id}/slots/{slot_id}/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交演员图片任务",
)
async def submit_actor_image_generation_task(
    actor_id: str,
    slot_id: int,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定演员图片槽位，防止请求体伪造目标或改变图片执行语义。"""
    _require_image_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=actor_id, slot_id=str(slot_id)),
        body=body,
    )


@router.post(
    "/characters/{character_id}/slots/{slot_id}/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交角色图片任务",
)
async def submit_character_image_generation_task(
    character_id: str,
    slot_id: int,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定角色图片槽位，统一交由提交器冻结模型与媒体快照。"""
    _require_image_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=character_id, slot_id=str(slot_id)),
        body=body,
    )


@router.post(
    "/assets/{asset_type}/{asset_id}/slots/{slot_id}/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交资产图片任务",
)
async def submit_asset_image_generation_task(
    asset_type: Literal["prop", "scene", "costume"],
    asset_id: str,
    slot_id: int,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定道具、场景或服装图片槽位；资产类型仅用于受限路径匹配。"""
    _require_image_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=asset_id, slot_id=str(slot_id)),
        body=body,
    )


@router.post(
    "/labs/image/sessions/{session_id}/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交图片实验室任务",
)
async def submit_image_lab_generation_task(
    session_id: str,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定图片实验会话，确保其始终进入异步图片生成执行链。"""
    _require_image_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.image,
        operation=GenerationOperation.image_generation,
        target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
        body=body,
    )


@router.post(
    "/labs/video/sessions/{session_id}/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交视频实验室任务",
)
async def submit_video_lab_generation_task(
    session_id: str,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """绑定视频实验会话，确保其始终进入异步视频生成执行链。"""
    _require_video_request(body)
    return await _submit_async_task(
        db,
        modality=GenerationModality.video,
        operation=GenerationOperation.video_generation,
        target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
        body=body,
    )
