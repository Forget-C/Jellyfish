"""文本实验室固定 SSE 入口与会话内取消接口。"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.streaming import GenerationStreamEvent, StreamEventType
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.text_lab import (
    TextLabCancelRequest,
    TextLabGenerateRequest,
    TextLabGenerateResponse,
    TextLabRunRequest,
    TextLabRunStatus,
)
from app.services.generation.runtime.text_chat_streaming import (
    create_text_stream_run,
    request_text_stream_cancel,
    stream_text_run,
    subscribe_text_stream,
)
from app.services.llm.resolver import build_text_chat_model

router = APIRouter()


def _encode_sse(event: GenerationStreamEvent) -> str:
    """将强类型事件编码为标准 SSE 帧，sequence 同时作为稳定 event id。"""
    return f"id: {event.sequence}\nevent: {event.event.value}\ndata: {event.model_dump_json()}\n\n"


def _to_langchain_messages(body: TextLabGenerateRequest) -> list[SystemMessage | HumanMessage | AIMessage]:
    """将过渡期同步请求转换为 LangChain 消息，供尚未切流的页面继续使用。"""
    return [
        SystemMessage(content=item.content) if item.role == "system"
        else AIMessage(content=item.content) if item.role == "assistant"
        else HumanMessage(content=item.content)
        for item in body.messages
    ]


@router.post("/generate", response_model=ApiResponse[TextLabGenerateResponse], summary="过渡期同步文本实验入口")
async def generate_text_lab_response(
    body: TextLabGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TextLabGenerateResponse]:
    """保留 D3 页面切流前的同步调用，避免阶段提交让既有实验室不可用。"""
    model = await build_text_chat_model(db, model_id=body.model_id, thinking=False)
    try:
        result = await model.ainvoke(_to_langchain_messages(body))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Text model invocation failed") from exc
    content = str(getattr(result, "content", "") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Text model returned an empty response")
    return success_response(TextLabGenerateResponse(model_id=body.model_id, content=content))


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
) -> StreamingResponse:
    """提交 canonical user message 后持续输出本轮文本增量与唯一终态事件。"""
    task_id, accepted = await create_text_stream_run(
        db,
        session_id=session_id,
        model_id=body.model_id,
        content=body.content,
    )
    await db.commit()
    execution = asyncio.create_task(stream_text_run(task_id))

    async def event_stream():
        """在连接断开时请求取消，已终态的运行则保持原有最终结果。"""
        terminal = False
        try:
            yield _encode_sse(accepted)
            async for event in subscribe_text_stream(task_id):
                if event.sequence != accepted.sequence:
                    yield _encode_sse(event)
                terminal = event.event in {StreamEventType.completed, StreamEventType.error, StreamEventType.cancelled}
                if await request.is_disconnected():
                    break
        finally:
            if not terminal:
                await request_text_stream_cancel(
                    session_id=session_id,
                    task_id=task_id,
                    reason="client_disconnected",
                )
            if not execution.done():
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
) -> ApiResponse[TextLabRunStatus]:
    """会话绑定取消入口不复用任务中心取消 API，避免 hidden run 越权展示。"""
    cancelled = await request_text_stream_cancel(session_id=session_id, task_id=task_id, reason=body.reason)
    return success_response(TextLabRunStatus(task_id=task_id, status="cancelled" if cancelled else "succeeded"))
