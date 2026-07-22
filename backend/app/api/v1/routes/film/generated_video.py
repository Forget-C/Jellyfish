from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.dependencies import get_db
from app.models.task_links import GenerationTaskLink
from app.schemas.studio.shots import ShotVideoPromptPackRead
from app.services.film.generated_video import build_run_args, preview_prompt_and_images
from app.services.studio.shot_status import mark_shot_generating
from app.tasks.execute_task import enqueue_task_execution
from app.schemas.common import ApiResponse, created_response, success_response

from .common import TaskCreated, _CreateOnlyTask
from .video_request import VideoGenerationTaskRequest

router = APIRouter()


class VideoPromptPreviewResponse(BaseModel):
    prompt: str = Field(..., description="最终用于视频生成的提示词")
    images: list[str] = Field(default_factory=list, description="关联参考图 file_id 列表")
    pack: ShotVideoPromptPackRead | None = Field(None, description="视频提示词预览上下文包")



@router.post(
    "/tasks/video/preview-prompt",
    response_model=ApiResponse[VideoPromptPreviewResponse],
    status_code=200,
    summary="视频提示词预览",
)
async def preview_video_generation_prompt(
    body: VideoGenerationTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[VideoPromptPreviewResponse]:
    """预览视频生成的提示词与自动关联参考图。"""
    prompt, images, pack = await preview_prompt_and_images(
        db,
        shot_id=body.shot_id,
        reference_mode=body.reference_mode,
        prompt=body.prompt,
        images=body.ordered_frame_file_ids(),
    )
    return success_response(VideoPromptPreviewResponse(prompt=prompt, images=images, pack=pack))


@router.post(
    "/tasks/video",
    response_model=ApiResponse[TaskCreated],
    status_code=201,
    summary="视频生成（任务版）",
)
async def create_video_generation_task(
    body: VideoGenerationTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """创建视频生成任务并后台执行，结果通过 /tasks/{task_id}/result 获取。"""

    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})
    run_args = await build_run_args(
        db,
        shot_id=body.shot_id,
        reference_mode=body.reference_mode,
        prompt=body.prompt,
        images=body.ordered_frame_file_ids(),
        ratio=body.ratio,
    )

    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="video_generation",
        run_args=run_args,
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="video",
            relation_type="video",
            relation_entity_id=body.shot_id,
        )
    )
    await mark_shot_generating(db, shot_id=body.shot_id)

    # 确保任务记录已提交，避免后台 runner 新 session 查询不到任务行而无法更新状态。
    await db.commit()

    enqueue_task_execution(task_record.id)
    return created_response(TaskCreated(task_id=task_record.id))
