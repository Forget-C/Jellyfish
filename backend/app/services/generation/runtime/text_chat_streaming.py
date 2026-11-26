"""文本实验室的流式运行服务。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import aclosing
from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.streaming import (
    GenerationStreamEvent,
    StreamAcceptedData,
    StreamCancelledData,
    StreamCompletedData,
    StreamDeltaData,
    StreamErrorData,
    StreamErrorDetail,
    StreamGenerationResult,
    StreamMessageData,
    StreamEventType,
)
from app.core.contracts.model_provider import TextModelProvider
from app.core.db import async_session_maker
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.services.generation.runtime.text_streaming import TextStreamRunNotFoundError, TextStreamingRuntime
from app.services.llm.resolver import build_laboratory_chat
from app.services.studio.session_events import append_session_event
from app.schemas.studio.text_lab import TextLabRunRequest
from app.services.studio.experiment_interaction import (
    find_text_request, interaction_request_payload, text_stream_origin, text_stream_result,
)
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages, experiment_user_message

_runtime = TextStreamingRuntime()
_stream_inputs: dict[str, _TextStreamInput] = {}
_stream_inputs_lock = asyncio.Lock()


@dataclass(frozen=True, slots=True)
class _TextStreamInput:
    """单个同步 SSE run 的短生命周期输入，不持久化为 GenerationTask。"""

    session_id: str
    model_id: str
    content: str
    request_id: str | None = None
    user_message_id: str | None = None
    publish_events: bool = False


def _as_message_data(message: ExperimentMessage) -> StreamMessageData:
    """将持久化实验消息投影为 SSE 使用的最小消息契约。"""
    return StreamMessageData(
        id=message.id,
        session_id=message.session_id,
        role="assistant" if message.role == "assistant" else "user",
        content=message.content,
        payload={key: value for key, value in message.payload.items() if key != '_stream_partial'} if message.role == "user" else {},
        sequence=message.sequence,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


async def create_text_stream_run(
    db: AsyncSession, *, session_id: str, model_id: str, content: str, request_id: str | None = None,
    publish_events: bool = False,
) -> tuple[str, GenerationStreamEvent]:
    """持久化用户消息并创建内存 SSE run，不写入异步任务表。"""
    session = await _require_text_session(db, session_id=session_id)
    await build_laboratory_chat(db, model_id=model_id, streaming=True)
    run_id = uuid4().hex
    draft = experiment_user_message(prompt=content, model_id=model_id)
    if request_id:
        draft.payload.update(interaction_request_payload(request_id, TextLabRunRequest(model_id=model_id, content=content)))
        draft.payload['interaction_run_id'] = run_id
    user_message = (await append_experiment_messages(db, session_id=session_id, drafts=[draft]))[0]
    session.updated_at = func.now()
    await db.flush()
    await db.refresh(user_message)
    async with _stream_inputs_lock:
        _stream_inputs[run_id] = _TextStreamInput(session_id=session_id, model_id=model_id, content=content, request_id=request_id, user_message_id=user_message.id, publish_events=publish_events)
    accepted = await _runtime.create_run(StreamAcceptedData(task_id=run_id, user_message=_as_message_data(user_message)))
    if publish_events:
        await append_session_event(db, session_id, run_id, "turn.accepted", accepted.data.model_dump(mode="json"))
    return run_id, accepted


@dataclass(frozen=True, slots=True)
class TextInteractionAdmission:
    """The enrolled stream owns execution only on the first request."""

    task_id: str
    start: bool
    saved_events: tuple[GenerationStreamEvent, ...] | None = None


async def admit_text_interaction(db, session_id, body: TextLabRunRequest, request_id: str) -> TextInteractionAdmission:
    """Resume an existing text stream by identity without starting the model again."""
    await _lock_text_interaction(db, session_id)
    previous = await find_text_request(db, session_id, request_id, body)
    if previous is not None:
        task_id = previous.payload['interaction_run_id']
        try:
            await _runtime.state_of(task_id)
        except TextStreamRunNotFoundError as error:
            result = await text_stream_result(db, session_id, task_id)
            if result is None:
                deltas = previous.payload.get('_stream_partial', [])
                if not deltas:
                    raise HTTPException(409, 'TEXT_LAB_STREAM_RESULT_UNKNOWN') from error
                return TextInteractionAdmission(task_id, False, _recovered_text_events(previous, None, task_id, deltas))
            return TextInteractionAdmission(task_id, False, _recovered_text_events(previous, result, task_id))
        return TextInteractionAdmission(task_id, False)
    task_id, _ = await create_text_stream_run(
        db, session_id=session_id, model_id=body.model_id, content=body.content, request_id=request_id, publish_events=True,
    )
    return TextInteractionAdmission(task_id, True)


def _recovered_text_events(user, result, task_id, partial=None):
    events = [
        GenerationStreamEvent(event=StreamEventType.accepted, sequence=1, created_at=user.created_at,
                              data=StreamAcceptedData(task_id=task_id, user_message=_as_message_data(user))),
    ]
    stamp = result.updated_at if result else user.updated_at
    deltas = partial if result is None else result.payload.get('stream_deltas', [])
    for sequence, text in deltas:
        events.append(GenerationStreamEvent(event=StreamEventType.delta, sequence=sequence, created_at=stamp,
                                           data=StreamDeltaData(task_id=task_id, text_delta=text)))
    if result is None:
        kind = StreamEventType.error
        data = StreamErrorData(task_id=task_id, error=StreamErrorDetail(
            code='stream_result_unknown', message='文本流已恢复部分输出，最终状态仍待核实'))
    elif result.status == 'cancelled':
        kind = StreamEventType.cancelled
        data = StreamCancelledData(task_id=task_id, reason=result.payload.get('reason'))
    elif result.status == 'failed':
        kind = StreamEventType.error
        data = StreamErrorData(task_id=task_id, error=StreamErrorDetail.model_validate(result.payload['error']))
    else:
        kind = StreamEventType.completed
        data = StreamCompletedData(task_id=task_id, assistant_message=_as_message_data(result),
                                   result=StreamGenerationResult(text=result.content, model_id=result.payload['model_id']))
    events.append(GenerationStreamEvent(event=kind, sequence=events[-1].sequence + 1,
                                       created_at=stamp, data=data))
    return tuple(events)


async def _lock_text_interaction(db, session_id):
    # Use the same session row as message sequencing. A no-op update obtains
    # the write lock even on SQLite, whose SELECT FOR UPDATE is ignored.
    await db.execute(update(ExperimentSession).where(ExperimentSession.id == session_id).values(
        message_sequence=ExperimentSession.message_sequence, updated_at=ExperimentSession.updated_at,
    ))
    return await _require_text_session(db, session_id=session_id)


async def _require_text_session(db: AsyncSession, *, session_id: str) -> ExperimentSession:
    """验证会话存在且属于文本实验室。"""
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != "text":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
    return session


async def _stream_chat(
    model: TextModelProvider, content: str,
) -> AsyncGenerator[str, None]:
    async with aclosing(model.stream([{"role": "user", "content": content}])) as events:
        async for event in events:
            if event.kind == "error":
                raise RuntimeError(event.error or "Text model stream failed")
            if event.kind == "delta" and event.choice == 0 and event.text:
                yield event.text


async def stream_text_run(run_id: str) -> None:
    """运行同步 SSE 文本调用，完成后将助手回答写入 ExperimentMessage。"""
    try:
        stream_input = await _get_stream_input(run_id)
        async with async_session_maker() as db:
            model = await build_laboratory_chat(db, model_id=stream_input.model_id, streaming=True)
        deltas = []
        async with aclosing(_stream_chat(model, stream_input.content)) as chunks:
            async for text in chunks:
                if await _runtime.is_cancel_requested(run_id):
                    await _cancel(run_id, "cancel_requested")
                    return
                if stream_input.request_id:
                    deltas.append([len(deltas) + 2, text])
                    await _checkpoint_text(stream_input, deltas)
                await _runtime.emit_delta(run_id, StreamDeltaData(task_id=run_id, text_delta=text))
        if await _runtime.is_cancel_requested(run_id):
            await _cancel(run_id, "cancel_requested")
            return
        await _complete_stream(run_id, stream_input)
    except asyncio.CancelledError:
        await _cancel(run_id, "stream_interrupted")
        raise
    except TextStreamRunNotFoundError:
        return
    except Exception:  # Provider 原始异常不得泄漏给 SSE 客户端。
        await _fail_stream(run_id, "provider_failed", "Text model invocation failed")


async def request_text_stream_cancel(*, session_id: str, task_id: str, reason: str | None) -> bool:
    """请求取消属于指定实验室会话的内存 SSE run。"""
    stream_input = await _get_stream_input(task_id)
    if stream_input.session_id != session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="text_stream_run_not_found")
    return await _runtime.request_cancel(task_id, reason)


async def cancel_text_interaction(db, session_id: str, task_id: str, reason: str | None) -> str:
    """Return a verified terminal state or record an active user's stop request."""
    try:
        if await request_text_stream_cancel(session_id=session_id, task_id=task_id, reason=reason):
            return 'cancelled'
    except TextStreamRunNotFoundError:
        pass
    result = await text_stream_result(db, session_id, task_id)
    if result:
        return result.status
    if await text_stream_origin(db, session_id, task_id):
        return 'unknown'
    raise HTTPException(404, 'text_stream_run_not_found')


async def _complete_stream(run_id: str, stream_input: _TextStreamInput) -> None:
    """落库最终助手消息并发出 completed SSE 事件。"""
    events = await _runtime.replay(run_id)
    text = "".join(event.data.text_delta for event in events if isinstance(event.data, StreamDeltaData)).strip()
    if not text:
        await _fail_stream(run_id, "empty_response", "Text model returned an empty response")
        return
    assistant_message = await _persist_stream_message(run_id, stream_input, events, text, 'succeeded')
    await _runtime.complete(run_id, StreamCompletedData(task_id=run_id, assistant_message=_as_message_data(assistant_message), result=StreamGenerationResult(text=text, model_id=stream_input.model_id)))
    await _discard_stream_input(run_id)


async def _checkpoint_text(stream_input, deltas):
    """Save each indexed prefix before exposing it through SSE."""
    async with async_session_maker() as db:
        message = await db.get(ExperimentMessage, stream_input.user_message_id)
        if message is None:
            raise TextStreamRunNotFoundError('The originating message was removed')
        if stream_input.publish_events:
            await append_session_event(db, stream_input.session_id, message.payload["interaction_run_id"],
                                       "message.updated", {"text_delta": deltas[-1][1]})
        message.payload = {**message.payload, '_stream_partial': deltas}
        await db.commit()


async def _persist_stream_message(run_id, stream_input, events, body, state, details=None):
    payload = {'model_id': stream_input.model_id}
    if stream_input.request_id:
        payload.update(details or {})
        payload.update(interaction_run_id=run_id, stream_deltas=[
            [event.sequence, event.data.text_delta] for event in events if isinstance(event.data, StreamDeltaData)
        ])
    async with async_session_maker() as db:
        if stream_input.request_id:
            await _lock_text_interaction(db, stream_input.session_id)
            if settled := await text_stream_result(db, stream_input.session_id, run_id):
                return settled
            if origin := await db.get(ExperimentMessage, stream_input.user_message_id):
                origin.payload = {key: value for key, value in origin.payload.items() if key != '_stream_partial'}
        message, = await append_experiment_messages(db, session_id=stream_input.session_id, drafts=[
            ExperimentMessageDraft(role='assistant', content=body, status=state, payload=payload),
        ])
        if stream_input.publish_events:
            await db.flush()
            await db.refresh(message)
            data = ({"assistant_message": _as_message_data(message).model_dump(mode="json")}
                    if state == "succeeded" else details or {})
            kind = {"succeeded": "turn.completed", "cancelled": "turn.stopped", "failed": "turn.failed"}[state]
            await append_session_event(db, stream_input.session_id, run_id, kind, data)
        await db.commit()
        await db.refresh(message)
    return message


async def _save_partial_stream(run_id, state, details):
    stream_input = await _get_stream_input(run_id)
    if stream_input.request_id:
        events = await _runtime.replay(run_id)
        body = ''.join(event.data.text_delta for event in events if isinstance(event.data, StreamDeltaData))
        return await _persist_stream_message(run_id, stream_input, events, body, state, details)
    return None


async def _cancel(run_id: str, reason: str) -> None:
    """Publish cancellation and keep already received text in the original interaction."""
    try:
        settled = await _save_partial_stream(run_id, 'cancelled', {'reason': reason})
        if settled is not None and settled.status == 'succeeded':
            await _runtime.complete(run_id, StreamCompletedData(
                task_id=run_id, assistant_message=_as_message_data(settled),
                result=StreamGenerationResult(text=settled.content, model_id=settled.payload['model_id']),
            ))
            await _discard_stream_input(run_id)
            return
        await _runtime.cancel(run_id, reason)
        await _discard_stream_input(run_id)
    except TextStreamRunNotFoundError:
        return


async def _fail_stream(run_id: str, code: str, message: str) -> None:
    """Publish one failed result with any text already delivered."""
    try:
        detail = StreamErrorDetail(code=code, message=message)
        await _save_partial_stream(run_id, 'failed', {'error': detail.model_dump(mode='json')})
        await _runtime.fail(run_id, StreamErrorData(task_id=run_id, error=detail))
        await _discard_stream_input(run_id)
    except TextStreamRunNotFoundError:
        return


async def _get_stream_input(run_id: str) -> _TextStreamInput:
    """读取同步 SSE run 输入；进程重启后不提供断线恢复。"""
    async with _stream_inputs_lock:
        stream_input = _stream_inputs.get(run_id)
    if stream_input is None:
        raise TextStreamRunNotFoundError(f"text stream run does not exist: {run_id}")
    return stream_input


async def _discard_stream_input(run_id: str) -> None:
    """在同步 SSE 终态后释放只用于执行的内存输入。"""
    async with _stream_inputs_lock:
        _stream_inputs.pop(run_id, None)


async def reap_expired_text_stream_runs(*, limit: int = 100) -> list[str]:
    """兼容既有 Beat 入口；同步 SSE run 没有持久化 lease 可回收。"""
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    return []


__all__ = [
    "create_text_stream_run", "reap_expired_text_stream_runs",
    "request_text_stream_cancel", "stream_text_run",
]
