"""文本实验室固定 SSE 入口与会话内取消接口。"""

from __future__ import annotations

from app.services.studio.experiment_messages import read_experiment_messages

import asyncio

from fastapi import APIRouter, Depends, Header, Request
from typing import Annotated
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.streaming import GenerationStreamEvent, StreamEventType
from app.dependencies import get_db
from app.schemas.common import ApiResponse, created_response, success_response
from app.schemas.interaction import InteractionRequestHeader
from app.schemas.studio.experiment_sessions import ExperimentMessageRead, ExperimentTaskCreated
from app.schemas.studio.text_lab import (
    TextLabCancelRequest,
    TextLabRunRequest,
    TextLabRunStatus,
)
from app.services.generation.runtime.text_chat_streaming import (
    create_text_async_task,
    admit_text_interaction,
    cancel_text_interaction,
    execute_text_inline,
    request_text_stream_cancel,
    stream_text_run,
    subscribe_text_stream,
)

router = APIRouter()


def _encode_sse(event: GenerationStreamEvent) -> str:
    """将强类型事件编码为标准 SSE 帧，sequence 同时作为稳定 event id。"""
    return f"id: {event.sequence}\nevent: {event.event.value}\ndata: {event.model_dump_json()}\n\n"


@router.post(
    "/sessions/{session_id}/execute",
    response_model=ApiResponse[list[ExperimentMessageRead]],
    summary="以固定 JSON 协议执行文本实验会话",
)
async def execute_text_lab_response(
    session_id: str,
    body: TextLabRunRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[ExperimentMessageRead]]:
    """执行单轮文本并返回已落库的 canonical user/assistant 消息。"""
    user_message, assistant_message = await execute_text_inline(
        db,
        session_id=session_id,
        model_id=body.model_id,
        content=body.content,
    )
    await db.commit()
    await db.refresh(user_message)
    await db.refresh(assistant_message)
    return success_response([
        ExperimentMessageRead.model_validate(user_message),
        ExperimentMessageRead.model_validate(assistant_message),
    ])


@router.post(
    "/sessions/{session_id}/tasks",
    response_model=ApiResponse[ExperimentTaskCreated],
    status_code=201,
    summary="提交文本实验室统一异步任务",
)
async def submit_text_lab_task(
    session_id: str,
    body: TextLabRunRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ExperimentTaskCreated]:
    """创建文本消息与数据库排队任务，提交后由 Worker 领取。"""
    accepted, user_message, task_message = await create_text_async_task(
        db,
        session_id=session_id,
        model_id=body.model_id,
        content=body.content,
    )
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
    "/sessions/{session_id}/stream",
    response_class=StreamingResponse,
    summary="以固定 SSE 协议执行文本实验会话",
)
async def stream_text_lab_response(
    session_id: str,
    body: TextLabRunRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    idempotency_key: InteractionRequestHeader = None,
    last_event_id: Annotated[int, Header(alias='Last-Event-ID', ge=0)] = 0,
) -> StreamingResponse:
    """提交 canonical user message 后持续输出本轮文本增量与唯一终态事件。"""
    admission = await admit_text_interaction(db, session_id, body, idempotency_key)
    task_id = admission.task_id
    await db.commit()
    execution = asyncio.create_task(stream_text_run(task_id)) if admission.start else None

    async def event_stream():
        """Replay known events without cancelling or starting a second execution."""
        if admission.saved_events is not None:
            for event in admission.saved_events:
                if event.sequence > last_event_id:
                    yield _encode_sse(event)
            return
        terminal = False
        try:
            async for event in subscribe_text_stream(task_id, after=last_event_id):
                yield _encode_sse(event)
                terminal = event.event in {StreamEventType.completed, StreamEventType.error, StreamEventType.cancelled}
                if await request.is_disconnected():
                    break
        finally:
            if execution is not None and not execution.done() and not terminal:
                await request_text_stream_cancel(session_id=session_id, task_id=task_id, reason="client_disconnected")
                execution.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/sessions/{session_id}/runs/{task_id}/cancel",
    response_model=ApiResponse[TextLabRunStatus],
    summary="取消当前文本实验会话的隐藏流式运行",
)
async def cancel_text_lab_stream(
    session_id: str,
    task_id: str,
    body: TextLabCancelRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TextLabRunStatus]:
    """会话绑定取消入口不复用任务中心取消 API，避免 hidden run 越权展示。"""
    outcome = await cancel_text_interaction(db, session_id, task_id, body.reason)
    return success_response(TextLabRunStatus(task_id=task_id, status=outcome))
