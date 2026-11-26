"""Submit a media trial with its authoritative acceptance event."""
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import (
    GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation, GenerationSubmitRequest,
    GenerationTarget, GenerationTargetKind, ImageGenerationOperationInput, VideoGenerationOperationInput,
)
from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.models.experiment_sessions import ExperimentSession
from app.schemas.studio.experiment_sessions import ExperimentTaskCreated
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.services.studio.experiment_interaction import find_media_receipt, interaction_request_payload, read_media_admission
from app.services.studio.experiment_messages import (
    ExperimentMessageDraft, append_experiment_messages, experiment_user_message,
    read_experiment_messages, task_message_display_payload,
)
from app.services.studio.media_receipts import publish_media_fact
from app.services.studio.session_events import session_event_page


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
    """锁定会话并校验类型，任务与消息提交期间不允许删除会话。"""

    session = await db.get(ExperimentSession, session_id, with_for_update=True)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != lab_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
    return session


async def _submit_lab_task(
    db: AsyncSession,
    *,
    session_id: str,
    modality: GenerationModality,
    body: GenerationSubmitRequest,
    request_id: str | None = None,
) -> ExperimentTaskCreated:
    """原子写入实验室消息和快照任务，并在提交成功后再投递 Worker。"""

    lab_type: Literal["image", "video"] = "image" if modality is GenerationModality.image else "video"
    session = await _require_session(db, session_id=session_id, lab_type=lab_type)
    if request_id:
        receipt = await find_media_receipt(db, session_id, request_id, body=body)
        if receipt:
            return receipt
    operation = GenerationOperation.image_generation if modality is GenerationModality.image else GenerationOperation.video_generation
    task_label = "图片" if modality is GenerationModality.image else "视频"
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
    user_message, task_message = await append_experiment_messages(
        db,
        session_id=session_id,
        drafts=[
            experiment_user_message(prompt=body.execution_prompt or "", model_id=accepted.model_id,
                                    media=body.media, operation_input=body.operation_input),
            ExperimentMessageDraft(
                role="task",
                task_id=accepted.task_id,
                content=f"{task_label}生成任务已提交，正在等待生成结果。",
                payload={**task_message_display_payload(modality=modality.value),
                         **interaction_request_payload(request_id, body)},
            ),
        ],
    )
    await db.flush()
    messages = await read_experiment_messages(db, [user_message, task_message], include_media_receipts=True)
    await publish_media_fact(db, accepted.task_id, session_id, messages=messages)
    session.updated_at = func.now()
    await db.commit()
    return ExperimentTaskCreated(task_id=accepted.task_id, messages=messages)


async def submit_media_trial(db, session_id, modality, body, idempotency_key):
    """Validate the request against the session's registered trial modality."""
    _require_operation_request(body, modality=modality)
    return await _submit_lab_task(db, session_id=session_id, modality=modality, body=body, request_id=idempotency_key)

async def media_event_page(db, session_id, after):
    """Replay media events, projecting messages for older acceptance records."""
    events = await session_event_page(db, session_id, after)
    for event in events:
        if event.type == 'task.accepted' and 'messages' not in event.payload:
            receipt = await read_media_admission(db, session_id, event.payload['task_id'])
            if receipt:
                event.payload = {**event.payload, 'messages': receipt.model_dump(mode='json')['messages']}
    return events
