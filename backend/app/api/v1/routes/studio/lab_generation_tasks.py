"""实验室生成任务的统一提交入口。

实验室对话记录和统一生成任务必须作为同一个事务写入：前端拿到任务 ID 时，
对应的用户输入和任务占位消息已经存在，Worker 也能够通过任务 ID 找到展示记录。
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

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
from app.models.experiment_sessions import ExperimentSession, ExperimentSessionEvent
from app.services.chat.stream import session_event_stream
from app.services.studio.media_receipts import publish_media_fact
from app.schemas.common import ApiResponse, created_response, success_response
from app.schemas.interaction import InteractionRequestHeader
from app.services.studio.experiment_interaction import find_media_receipt, interaction_request_payload
from app.schemas.studio.experiment_sessions import ExperimentMessageRead, ExperimentTaskCreated
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationSubmitter
from app.services.studio.experiment_messages import (
    ExperimentMessageDraft,
    append_experiment_messages,
    experiment_user_message,
    read_experiment_messages,
    read_experiment_page,
    task_message_display_payload,
)

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
) -> ApiResponse[ExperimentTaskCreated]:
    """原子写入实验室消息和快照任务，并在提交成功后再投递 Worker。"""

    lab_type: Literal["image", "video"] = "image" if modality is GenerationModality.image else "video"
    session = await _require_session(db, session_id=session_id, lab_type=lab_type)
    if request_id:
        receipt = await find_media_receipt(db, session_id, request_id, body=body)
        if receipt:
            return created_response(receipt)
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
    await publish_media_fact(db, accepted.task_id, session_id)
    session.updated_at = func.now()
    await db.commit()
    await db.refresh(user_message)
    await db.refresh(task_message)
    return created_response(
        ExperimentTaskCreated(
            task_id=accepted.task_id,
            messages=await read_experiment_messages(db, [user_message, task_message]),
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
    idempotency_key: InteractionRequestHeader = None,
) -> ApiResponse[ExperimentTaskCreated]:
    """为图片实验会话创建权威消息和安全快照任务。"""

    _require_operation_request(body, modality=GenerationModality.image)
    return await _submit_lab_task(db, session_id=session_id, modality=GenerationModality.image, body=body, request_id=idempotency_key)


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
    idempotency_key: InteractionRequestHeader = None,
) -> ApiResponse[ExperimentTaskCreated]:
    """为视频实验会话创建权威消息和安全快照任务。"""

    _require_operation_request(body, modality=GenerationModality.video)
    return await _submit_lab_task(db, session_id=session_id, modality=GenerationModality.video, body=body, request_id=idempotency_key)


chat_router = APIRouter()


@chat_router.post('/media/{session_id}/turns', response_model=ApiResponse[ExperimentTaskCreated],
                  status_code=201, operation_id='chat_media_send')
async def send_media_turn(session_id: str, body: GenerationSubmitRequest, db: AsyncSession = Depends(get_db),
                          idempotency_key: InteractionRequestHeader = None):
    """Submit one direct trial; the bound session must match the operation and media."""
    modality = GenerationModality.image if isinstance(body.operation_input, ImageGenerationOperationInput) else GenerationModality.video
    _require_operation_request(body, modality=modality)
    return await _submit_lab_task(db, session_id=session_id, modality=modality, body=body, request_id=idempotency_key)


async def _media_session(db, session_id):
    session = await db.get(ExperimentSession, session_id)
    if session is None or session.lab_type not in ('image', 'video'):
        raise HTTPException(404, 'Media trial session not found')
    return session


@chat_router.get('/media/{session_id}', response_model=ApiResponse[list[ExperimentMessageRead]], operation_id='chat_media_snapshot')
async def media_snapshot(session_id: str, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
                         db: AsyncSession = Depends(get_db)):
    """Restore submitted parameters, references and current task receipts."""
    await _media_session(db, session_id)
    cursor = await db.scalar(select(func.max(ExperimentSessionEvent.cursor))
                             .where(ExperimentSessionEvent.session_id == session_id))
    return success_response(await read_experiment_page(db, session_id, page, page_size), meta={
        'session_id': session_id, 'cursor': cursor or 0, 'capabilities': ('snapshot', 'send', 'events', 'task_receipt'),
    })


@chat_router.get('/media/{session_id}/events', operation_id='chat_media_events',
                 responses={200: {'content': {'text/event-stream': {}}}})
async def media_events(session_id: str, after: Annotated[int, Query(ge=0)] = 0, follow: bool = True,
                       last_event_id: Annotated[int, Header(ge=0)] = 0,
                       db: AsyncSession = Depends(get_db, scope='function')):
    """Replay task facts committed after the client's cursor, then follow new events."""
    from app.services.studio.session_events import session_event_page
    await _media_session(db, session_id)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)

    async def page(cursor):
        async with sessions() as session:
            return await session_event_page(session, session_id, cursor)

    return await session_event_stream(page, max(after, last_event_id), follow=follow)
