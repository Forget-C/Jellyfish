"""固定媒体资源的统一生成任务入口。

路由是业务 Binder：仅由路径派生目标、模态、operation 与交付方式，避免
客户端同时维护请求体目标和 URL 目标两份事实来源。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.film.common import TaskCreated
from app.core.contracts.generation import GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation, GenerationSubmitRequest, GenerationTarget, GenerationTargetKind, ImageGenerationOperationInput
from app.core.contracts.media import ImageMediaInput
from app.dependencies import get_db
from app.schemas.common import ApiResponse, created_response
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter

router = APIRouter()


def _require_image_request(body: GenerationSubmitRequest) -> None:
    """确保图片固定路由只接收图片 operation 与图片参考媒体。"""
    if not isinstance(body.operation_input, ImageGenerationOperationInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="operation_input_invalid")
    if body.media is not None and not isinstance(body.media, ImageMediaInput):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="media_role_invalid")




async def _submit_async_task(
    db: AsyncSession,
    *,
    modality: GenerationModality,
    operation: GenerationOperation,
    target: GenerationTarget,
    body: GenerationSubmitRequest,
) -> ApiResponse[TaskCreated]:
    """提交已由资源路径绑定的命令，由 Outbox dispatcher 可靠投递 Worker。"""
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
    return created_response(TaskCreated(task_id=accepted.task_id))








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
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=actor_id, slot_id=str(slot_id), asset_type="actor"),
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
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=character_id, slot_id=str(slot_id), asset_type="character"),
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
        target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, entity_id=asset_id, slot_id=str(slot_id), asset_type=asset_type),
        body=body,
    )
