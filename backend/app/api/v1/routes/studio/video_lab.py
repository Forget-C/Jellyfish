"""独立视频生成实验室接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.film.common import TaskCreated, _CreateOnlyTask
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.dependencies import get_db
from app.models.task_links import GenerationTaskLink
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.schemas.common import ApiResponse, created_response
from app.schemas.studio.video_lab import VideoLabGenerateRequest
from app.services.film.generated_video import build_video_lab_run_args
from app.tasks.execute_task import enqueue_task_execution

router = APIRouter()


@router.post(
    "/tasks",
    response_model=ApiResponse[TaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="创建独立视频实验任务",
)
async def create_video_lab_task(
    body: VideoLabGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """创建不绑定镜头的视频任务，并把生成结果归档到全局资料库。"""
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="prompt is required for video generation")
    experiment_session = await db.get(ExperimentSession, body.session_id)
    if experiment_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment session not found")
    message_time = datetime.now(UTC)
    user_message = ExperimentMessage(id=uuid.uuid4().hex, session_id=body.session_id, role="user", content=prompt, payload={"model_id": body.model_id, "ratio": body.ratio, "first_frame_file_id": body.first_frame_file_id, "last_frame_file_id": body.last_frame_file_id, "key_frame_file_id": body.key_frame_file_id}, created_at=message_time)
    task_message = ExperimentMessage(id=uuid.uuid4().hex, session_id=body.session_id, role="task", content="视频生成任务已提交，正在等待生成结果。", status="pending", payload={"model_id": body.model_id, "ratio": body.ratio, "first_frame_file_id": body.first_frame_file_id, "last_frame_file_id": body.last_frame_file_id, "key_frame_file_id": body.key_frame_file_id}, created_at=message_time + timedelta(microseconds=1))
    db.add_all([user_message, task_message])

    run_args = await build_video_lab_run_args(
        db,
        model_id=body.model_id,
        prompt=prompt,
        ratio=body.ratio,
        first_frame_file_id=body.first_frame_file_id,
        last_frame_file_id=body.last_frame_file_id,
        key_frame_file_id=body.key_frame_file_id,
    )
    store = SqlAlchemyTaskStore(db)
    task_manager = TaskManager(store=store, strategies={})
    task_record = await task_manager.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="video_generation",
        run_args=run_args,
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="video",
            relation_type="video_lab",
            relation_entity_id=task_message.id,
        )
    )
    task_message.task_id = task_record.id
    experiment_session.updated_at = func.now()
    await db.commit()
    enqueue_task_execution(task_record.id)
    return created_response(TaskCreated(task_id=task_record.id))
