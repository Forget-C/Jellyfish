"""实验室生成任务的统一提交入口。

实验室对话记录和统一生成任务必须作为同一个事务写入：前端拿到任务 ID 时，
对应的用户输入和任务占位消息已经存在，Worker 也能够通过任务 ID 找到展示记录。
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.models.experiment_sessions import ExperimentSession
from app.schemas.common import ApiResponse, created_response
from app.schemas.studio.experiment_sessions import ExperimentMessageRead, ExperimentTaskCreated
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages

router = APIRouter()


def _require_operation_request(
    body: GenerationSubmitRequest,
    *,
    modality: GenerationModality,
) -> None:
    """确保固定实验室路径不能被请求体切换 operation 或媒体结构。"""

    expected_input = ImageGenerationOperationInput if modality is GenerationModality.image else VideoGenerationOperationInput
    expected_media = ImageMediaInput if modality is GenerationModality.image else VideoMediaInput
    if not isinstance(body.operation_input, expected_input):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="operation_input_invalid")
    if body.media is not None and not isinstance(body.media, expected_media):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="media_role_invalid")


async def _require_session(
    db: AsyncSession,
    *,
    session_id: str,
    lab_type: Literal["image", "video"],
) -> ExperimentSession:
    """读取并校验实验室类型，防止把图片任务写入视频历史或反之。"""

    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != lab_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
    return session


def _message_payload(body: GenerationSubmitRequest) -> dict[str, object]:
    """投影用户可见的安全提交快照，避免消息记录泄漏执行期凭据。"""

    return {
        "model_id": body.model_id,
        "render_id": body.render_id,
        "operation_input": body.operation_input.model_dump(mode="json"),
        "media": body.media.model_dump(mode="json") if body.media else None,
    }


async def _submit_lab_task(
    db: AsyncSession,
    *,
    session_id: str,
    modality: GenerationModality,
    body: GenerationSubmitRequest,
) -> ApiResponse[ExperimentTaskCreated]:
    """原子写入实验室消息和快照任务，并在提交成功后再投递 Worker。"""

    lab_type: Literal["image", "video"] = "image" if modality is GenerationModality.image else "video"
    session = await _require_session(db, session_id=session_id, lab_type=lab_type)
    payload = _message_payload(body)
    operation = GenerationOperation.image_generation if modality is GenerationModality.image else GenerationOperation.video_generation
    task_label = "图片" if modality is GenerationModality.image else "视频"
    user_message, task_message = await append_experiment_messages(
        db,
        session_id=session_id,
        drafts=[
            ExperimentMessageDraft(role="user", content=body.execution_prompt or "", payload=payload),
            ExperimentMessageDraft(
                role="task",
                content=f"{task_label}生成任务已提交，正在等待生成结果。",
                status="pending",
                payload=payload,
            ),
        ],
    )
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(
        db,
        GenerationCommand(
            modality=modality,
            operation=operation,
            delivery=GenerationDelivery.async_polling,
            target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
            request=body,
        ),
    )
    task_message.task_id = accepted.task_id
    session.updated_at = func.now()
    await db.commit()
    await db.refresh(user_message)
    await db.refresh(task_message)
    return created_response(
        ExperimentTaskCreated(
            task_id=accepted.task_id,
            messages=[
                ExperimentMessageRead.model_validate(user_message),
                ExperimentMessageRead.model_validate(task_message),
            ],
        )
    )


@router.post(
    "/image/sessions/{session_id}/tasks",
    response_model=ApiResponse[ExperimentTaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交图片实验室统一任务",
)
async def submit_image_lab_generation_task(
    session_id: str,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ExperimentTaskCreated]:
    """为图片实验会话创建权威消息和安全快照任务。"""

    _require_operation_request(body, modality=GenerationModality.image)
    return await _submit_lab_task(db, session_id=session_id, modality=GenerationModality.image, body=body)


@router.post(
    "/video/sessions/{session_id}/tasks",
    response_model=ApiResponse[ExperimentTaskCreated],
    status_code=status.HTTP_201_CREATED,
    summary="提交视频实验室统一任务",
)
async def submit_video_lab_generation_task(
    session_id: str,
    body: GenerationSubmitRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ExperimentTaskCreated]:
    """为视频实验会话创建权威消息和安全快照任务。"""

    _require_operation_request(body, modality=GenerationModality.video)
    return await _submit_lab_task(db, session_id=session_id, modality=GenerationModality.video, body=body)
