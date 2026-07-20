"""独立图片生成实验室接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.film.common import TaskCreated
from app.dependencies import get_db
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
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

    experiment_session = await db.get(ExperimentSession, body.session_id)
    if experiment_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment session not found")
    user_message = ExperimentMessage(id=uuid.uuid4().hex, session_id=body.session_id, role="user", content=prompt, payload={"model_id": body.model_id, "reference_file_ids": body.images})
    task_message = ExperimentMessage(id=uuid.uuid4().hex, session_id=body.session_id, role="task", content="图片生成任务已提交，正在等待生成结果。", status="pending", payload={"model_id": body.model_id, "reference_file_ids": body.images})
    db.add_all([user_message, task_message])
    references = await resolve_reference_image_refs_by_file_ids(db, file_ids=body.images)
    task_id = await create_image_task_and_link(
        db=db,
        model_id=body.model_id,
        relation_type="image_lab",
        relation_entity_id=task_message.id,
        prompt=prompt,
        images=references or None,
        target_ratio=body.target_ratio,
        resolution_profile=body.resolution_profile,
        purpose="generic",
        render_context={"reference_file_ids": body.images},
        commit=False,
        enqueue=False,
    )
    task_message.task_id = task_id
    experiment_session.updated_at = func.now()
    await db.commit()
    from app.tasks.execute_task import enqueue_task_execution
    enqueue_task_execution(task_id)
    return created_response(TaskCreated(task_id=task_id))
