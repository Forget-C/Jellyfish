"""固定媒体资源的统一生成任务入口。

路由是业务 Binder：仅由路径派生目标、模态、operation 与交付方式，避免
客户端同时维护请求体目标和 URL 目标两份事实来源。
"""

from __future__ import annotations

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
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(
        db,
        GenerationCommand(
            modality=GenerationModality.image,
            operation=GenerationOperation.image_generation,
            delivery=GenerationDelivery.async_polling,
            target=GenerationTarget(
                kind=GenerationTargetKind.shot_frame_slot,
                entity_id=shot_id,
                slot_id=str(slot.id),
            ),
            request=body,
        ),
    )
    await db.commit()
    enqueue_task_execution(accepted.task_id)
    return created_response(TaskCreated(task_id=accepted.task_id))


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
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(
        db,
        GenerationCommand(
            modality=GenerationModality.video,
            operation=GenerationOperation.video_generation,
            delivery=GenerationDelivery.async_polling,
            target=GenerationTarget(kind=GenerationTargetKind.shot_video, entity_id=shot_id),
            request=body,
        ),
    )
    await db.commit()
    enqueue_task_execution(accepted.task_id)
    return created_response(TaskCreated(task_id=accepted.task_id))
