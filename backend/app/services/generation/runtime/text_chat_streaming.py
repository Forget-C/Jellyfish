"""文本实验室的同步 SSE 运行与异步文本任务服务。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationDelivery,
    GenerationModality,
    GenerationOperation,
    GenerationSubmitRequest,
    GenerationTarget,
    GenerationTargetKind,
)
from app.core.contracts.streaming import (
    GenerationStreamEvent,
    StreamAcceptedData,
    StreamCompletedData,
    StreamDeltaData,
    StreamErrorData,
    StreamErrorDetail,
    StreamGenerationResult,
    StreamMessageData,
)
from app.core.contracts.text_generation import TextChatInput, TextChatMessage
from app.core.db import async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.runtime.text_streaming import TextStreamRunNotFoundError, TextStreamingRuntime
from app.services.generation.submission import GenerationAccepted, GenerationSubmitter
from app.services.llm.resolver import build_text_chat_model
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure

_runtime = TextStreamingRuntime()
_stream_inputs: dict[str, _TextStreamInput] = {}
_stream_inputs_lock = asyncio.Lock()


@dataclass(frozen=True, slots=True)
class _TextStreamInput:
    """单个同步 SSE run 的短生命周期输入，不持久化为 GenerationTask。"""

    session_id: str
    model_id: str
    content: str


def _as_message_data(message: ExperimentMessage) -> StreamMessageData:
    """将持久化实验消息投影为 SSE 使用的最小消息契约。"""
    return StreamMessageData(
        id=message.id,
        session_id=message.session_id,
        role="assistant" if message.role == "assistant" else "user",
        content=message.content,
        sequence=message.sequence,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


def _chunk_text(chunk: object) -> str:
    """归一化 LangChain 文本 chunk，忽略空增量。"""
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content or "")


async def create_text_stream_run(
    db: AsyncSession, *, session_id: str, model_id: str, content: str
) -> tuple[str, GenerationStreamEvent]:
    """持久化用户消息并创建内存 SSE run，不写入异步任务表。"""
    session = await _require_text_session(db, session_id=session_id)
    await build_text_chat_model(db, model_id=model_id, thinking=False)
    user_message = (
        await append_experiment_messages(
            db, session_id=session_id, drafts=[ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id})]
        )
    )[0]
    session.updated_at = func.now()
    await db.flush()
    await db.refresh(user_message)
    run_id = uuid4().hex
    async with _stream_inputs_lock:
        _stream_inputs[run_id] = _TextStreamInput(session_id=session_id, model_id=model_id, content=content)
    accepted = await _runtime.create_run(StreamAcceptedData(task_id=run_id, user_message=_as_message_data(user_message)))
    return run_id, accepted


def _text_chat_command(*, session_id: str, model_id: str, content: str, delivery: GenerationDelivery) -> GenerationCommand:
    """从固定文本实验室路径构建异步或 inline 文本命令。"""
    return GenerationCommand(
        modality=GenerationModality.text,
        operation=GenerationOperation.text_chat,
        delivery=delivery,
        target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
        request=GenerationSubmitRequest(
            model_id=model_id,
            operation_input=TextChatInput(messages=[TextChatMessage(role="user", content=content, sequence=1)]),
        ),
    )


async def create_text_async_task(
    db: AsyncSession, *, session_id: str, model_id: str, content: str
) -> tuple[GenerationAccepted, ExperimentMessage, ExperimentMessage]:
    """原子写入异步文本任务及其在实验室时间线中的两条消息。"""
    session = await _require_text_session(db, session_id=session_id)
    command = _text_chat_command(session_id=session_id, model_id=model_id, content=content, delivery=GenerationDelivery.async_polling)
    user_message, task_message = await append_experiment_messages(
        db,
        session_id=session_id,
        drafts=[
            ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id}),
            ExperimentMessageDraft(role="task", content="文本生成任务已提交，正在等待生成结果。", status="pending", payload={"modality": "text"}),
        ],
    )
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
    task_message.task_id = accepted.task_id
    session.updated_at = func.now()
    await db.flush()
    return accepted, user_message, task_message


async def execute_text_inline(
    db: AsyncSession, *, session_id: str, model_id: str, content: str
) -> tuple[ExperimentMessage, ExperimentMessage]:
    """执行同步 JSON 文本请求并持久化 canonical 用户和助手消息。"""
    await _require_text_session(db, session_id=session_id)
    command = _text_chat_command(session_id=session_id, model_id=model_id, content=content, delivery=GenerationDelivery.inline)
    snapshot = await GenerationEntityGate().validate(db, command)
    user_message = (await append_experiment_messages(db, session_id=session_id, drafts=[ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id})]))[0]
    text = await _invoke_text_snapshot(db, snapshot_payload=snapshot.model_dump(mode="json"))
    assistant_message = (await append_experiment_messages(db, session_id=session_id, drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": snapshot.model_id})]))[0]
    return user_message, assistant_message


async def _require_text_session(db: AsyncSession, *, session_id: str) -> ExperimentSession:
    """验证会话存在且属于文本实验室。"""
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != "text":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
    return session


def _as_langchain_messages(messages: list[dict[str, object]]) -> list[HumanMessage | AIMessage | SystemMessage]:
    """将任务快照中的文本消息转换为受限 LangChain 消息类型。"""
    result: list[HumanMessage | AIMessage | SystemMessage] = []
    for message in messages:
        content, role = str(message.get("content") or ""), str(message.get("role") or "")
        if role == "user":
            result.append(HumanMessage(content=content))
        elif role == "assistant":
            result.append(AIMessage(content=content))
        elif role == "system":
            result.append(SystemMessage(content=content))
        else:
            raise RuntimeError("text chat snapshot contains an unsupported role")
    if not result:
        raise RuntimeError("text chat snapshot contains no messages")
    return result


async def _invoke_text_snapshot(db: AsyncSession, *, snapshot_payload: dict[str, object]) -> str:
    """执行异步或 inline 文本任务的参数快照，并在运行时解析当前模型。"""
    operation_input = dict(snapshot_payload.get("operation_input") or {})
    if operation_input.get("kind") != "text_chat":
        raise RuntimeError("text chat snapshot operation is unavailable")
    model_id = str(snapshot_payload.get("model_id") or "")
    if not model_id:
        raise RuntimeError("text chat snapshot model is unavailable")
    model = await build_text_chat_model(db, model_id=model_id, thinking=False)
    response = await model.ainvoke(_as_langchain_messages(list(operation_input.get("messages") or [])))
    text = _chunk_text(response).strip()
    if not text:
        raise RuntimeError("text model returned an empty response")
    return text


async def run_text_chat_task(task_id: str, run_args: dict[str, object]) -> None:
    """执行异步文本 GenerationTask，并将可见结果投影回关联任务消息。"""
    del run_args
    async with async_session_maker() as db:
        try:
            store = SqlAlchemyTaskStore(db)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_progress(task_id, 10)
            await db.commit()
            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                return
            task = await db.get(GenerationTask, task_id)
            snapshot_payload = dict((task.payload or {}).get("snapshot") or {}) if task else {}
            text = await _invoke_text_snapshot(db, snapshot_payload=snapshot_payload)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                return
            link = await db.scalar(select(GenerationTaskLink).where(GenerationTaskLink.task_id == task_id))
            if link is None or link.relation_type != GenerationTargetKind.experiment_session.value:
                raise RuntimeError("text chat task target is unavailable")
            model_id = str(snapshot_payload.get("model_id") or "")
            assistant_message = (await append_experiment_messages(db, session_id=link.relation_entity_id, drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": model_id})]))[0]
            await store.set_result(task_id, {"text": text, "assistant_message_id": assistant_message.id, "model_id": model_id})
            task_message = await db.scalar(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))
            if task_message is not None:
                task_message.status, task_message.payload = "succeeded", {**task_message.payload, "assistant_message_id": assistant_message.id}
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            await db.commit()
            log_task_event("text_chat", task_id, "succeeded")
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            async with async_session_maker() as failed_db:
                failed_store = SqlAlchemyTaskStore(failed_db)
                await failed_store.set_error(task_id, str(exc))
                await failed_store.set_status(task_id, TaskStatus.failed)
                task_message = await failed_db.scalar(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))
                if task_message is not None:
                    task_message.status, task_message.payload = "failed", {**task_message.payload, "error": str(exc)}
                await failed_db.commit()
            log_task_failure("text_chat", task_id, str(exc))


async def stream_text_run(run_id: str) -> None:
    """运行同步 SSE 文本调用，完成后将助手回答写入 ExperimentMessage。"""
    try:
        stream_input = await _get_stream_input(run_id)
        async with async_session_maker() as db:
            model = await build_text_chat_model(db, model_id=stream_input.model_id, thinking=False)
        async for chunk in model.astream([HumanMessage(content=stream_input.content)]):
            if await _runtime.is_cancel_requested(run_id):
                await _cancel(run_id, "cancel_requested")
                return
            if text := _chunk_text(chunk):
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


async def subscribe_text_stream(task_id: str) -> AsyncIterator[GenerationStreamEvent]:
    """订阅同步 SSE run 的进程内事件序列。"""
    async for event in _runtime.subscribe(task_id):
        yield event


async def _complete_stream(run_id: str, stream_input: _TextStreamInput) -> None:
    """落库最终助手消息并发出 completed SSE 事件。"""
    events = await _runtime.replay(run_id)
    text = "".join(event.data.text_delta for event in events if isinstance(event.data, StreamDeltaData)).strip()
    if not text:
        await _fail_stream(run_id, "empty_response", "Text model returned an empty response")
        return
    async with async_session_maker() as db:
        assistant_message = (await append_experiment_messages(db, session_id=stream_input.session_id, drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": stream_input.model_id})]))[0]
        await db.commit()
        await db.refresh(assistant_message)
    await _runtime.complete(run_id, StreamCompletedData(task_id=run_id, assistant_message=_as_message_data(assistant_message), result=StreamGenerationResult(text=text, model_id=stream_input.model_id)))
    await _discard_stream_input(run_id)


async def _cancel(run_id: str, reason: str) -> None:
    """发出取消终态；同步文本运行不会创建或更新 GenerationTask。"""
    try:
        await _runtime.cancel(run_id, reason)
        await _discard_stream_input(run_id)
    except TextStreamRunNotFoundError:
        return


async def _fail_stream(run_id: str, code: str, message: str) -> None:
    """发出稳定错误终态；失败信息不伪装为异步任务。"""
    try:
        await _runtime.fail(run_id, StreamErrorData(task_id=run_id, error=StreamErrorDetail(code=code, message=message)))
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
    "create_text_async_task", "create_text_stream_run", "execute_text_inline", "reap_expired_text_stream_runs",
    "request_text_stream_cancel", "run_text_chat_task", "stream_text_run", "subscribe_text_stream",
]
