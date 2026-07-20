"""独立图片生成实验室接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.film.common import TaskCreated
from app.dependencies import get_db
from app.schemas.common import ApiResponse, created_response
from app.schemas.studio.image_lab import ImageLabGenerateRequest
from app.services.studio.image_task_references import resolve_reference_image_refs_by_file_ids
from app.services.studio.image_task_runner import create_image_task_and_link

router = APIRouter()


@router.post(
    "/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="创建独立图片实验任务",
)
async def create_image_lab_task(
    body: ImageLabGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """创建不绑定业务资产的图片任务，并把生成结果归档到全局资料库。"""
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="prompt is required for image generation")

    references = await resolve_reference_image_refs_by_file_ids(db, file_ids=body.images)
    task_id = await create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type="image_lab",
        relation_entity_id=uuid.uuid4().hex,
        prompt=prompt,
        images=references or None,
        target_ratio=body.target_ratio,
        resolution_profile=body.resolution_profile,
        purpose="generic",
        render_context={"reference_file_ids": body.images},
    )
    return created_response(TaskCreated(task_id=task_id))
