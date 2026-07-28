"""文本实验室流式执行、隐藏运行持久化与 canonical 消息发布。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, status
from langchain_core.messages import HumanMessage
from sqlalchemy import func, select, update
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
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.runtime.text_streaming import TextStreamRunNotFoundError, TextStreamingRuntime
from app.services.llm.resolver import build_text_chat_model
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages

_LEASE_SECONDS = 45
_runtime = TextStreamingRuntime()


def _as_message_data(message: ExperimentMessage) -> StreamMessageData:
    """将已提交实验消息转为 SSE 契约，确保 accepted/completed 只返回 canonical 记录。"""
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
    """归一化 LangChain chunk 的字符串或分段内容，忽略空增量。"""
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content or "")


async def create_text_stream_run(
    db: AsyncSession,
    *,
    session_id: str,
    model_id: str,
    content: str,
) -> tuple[str, GenerationStreamEvent]:
    """原子创建 text session 的 canonical 用户消息和 hidden streaming task。

    路由在调用本函数后立即提交事务，再开始 SSE 传输；因此浏览器收到
    accepted 时，消息、target link、快照和 lease 已经可被取消与审计逻辑读取。
    """
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != "text":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")

    command = GenerationCommand(
        modality=GenerationModality.text,
        operation=GenerationOperation.text_chat,
        delivery=GenerationDelivery.streaming,
        target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id=session_id),
        request=GenerationSubmitRequest(
            model_id=model_id,
            operation_input=TextChatInput(messages=[TextChatMessage(role="user", content=content, sequence=1)]),
        ),
    )
    snapshot = await GenerationEntityGate().validate(db, command)
    task_id = uuid4().hex
    user_message = (
        await append_experiment_messages(
            db,
            session_id=session_id,
            drafts=[ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id})],
        )
    )[0]
    now = datetime.now(UTC).replace(tzinfo=None)
    db.add(
        GenerationTask(
            id=task_id,
            mode=GenerationDeliveryMode.streaming,
            visibility=GenerationTaskVisibility.hidden,
            task_kind=GenerationOperation.text_chat.value,
            status=GenerationTaskStatus.streaming,
            progress=0,
            payload={
                "command": command.model_dump(mode="json"),
                "snapshot": snapshot.model_dump(mode="json", exclude={"credential_ref"}),
            },
            lease_owner=task_id,
            lease_epoch=1,
            lease_expires_at=now + timedelta(seconds=_LEASE_SECONDS),
            heartbeat_at=now,
            started_at=now,
        )
    )
    db.add(
        GenerationTaskLink(
            task_id=task_id,
            resource_type="text",
            relation_type=GenerationTargetKind.experiment_session.value,
            relation_entity_id=session_id,
        )
    )
    session.updated_at = func.now()
    await db.flush()
    await db.refresh(user_message)
    accepted = await _runtime.create_run(StreamAcceptedData(task_id=task_id, user_message=_as_message_data(user_message)))
    return task_id, accepted


async def stream_text_run(task_id: str) -> None:
    """使用独立短生命周期会话执行 Provider 流，并以同一终态服务完成消息发布。"""
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        if task is None:
            raise LookupError("text_stream_run_not_found")
        payload = dict(task.payload or {})
        snapshot = dict(payload.get("snapshot") or {})
        operation_input = dict(snapshot.get("operation_input") or {})
        messages = list(operation_input.get("messages") or [])
        model_id = str(snapshot.get("model_id") or "")
        if not model_id or not messages:
            await _fail(task_id, code="invalid_snapshot", message="Text stream snapshot is invalid")
            return
        model = await build_text_chat_model(db, model_id=model_id, thinking=False)

    try:
        async for chunk in model.astream([HumanMessage(content=str(messages[-1]["content"]))]):
            if await _cancel_requested(task_id):
                await _cancel(task_id, reason="cancel_requested")
                return
            text = _chunk_text(chunk)
            if text:
                await _runtime.emit_delta(task_id, StreamDeltaData(task_id=task_id, text_delta=text))
            await _renew_lease(task_id)
        if await _cancel_requested(task_id):
            await _cancel(task_id, reason="cancel_requested")
            return
        await _complete(
            task_id,
            model_id=model_id,
            model_revision_id=str(snapshot.get("model_revision_id") or "unknown"),
        )
    except TextStreamRunNotFoundError:
        return
    except Exception:  # Provider 原始异常不得泄漏到 SSE
        await _fail(task_id, code="provider_failed", message="Text model invocation failed")


async def request_text_stream_cancel(*, session_id: str, task_id: str, reason: str | None) -> bool:
    """仅允许指定文本会话取消其 hidden streaming task，并使执行循环尽快停止。"""
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        if task is None or task.visibility != GenerationTaskVisibility.hidden or task.mode != GenerationDeliveryMode.streaming:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="text_stream_run_not_found")
        link = await db.scalar(
            select(GenerationTaskLink.id).where(
                GenerationTaskLink.task_id == task_id,
                GenerationTaskLink.relation_type == GenerationTargetKind.experiment_session.value,
                GenerationTaskLink.relation_entity_id == session_id,
            )
        )
        if link is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="text_stream_run_not_found")
        if task.status != GenerationTaskStatus.streaming:
            return False
        task.cancel_requested = True
        task.cancel_reason = (reason or "").strip() or "user_cancelled"
        task.cancel_requested_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
    try:
        return await _runtime.request_cancel(task_id, reason)
    except TextStreamRunNotFoundError:
        return True


async def subscribe_text_stream(task_id: str) -> AsyncIterator[GenerationStreamEvent]:
    """订阅当前进程的已提交文本运行事件，供 SSE 传输层逐条编码。"""
    async for event in _runtime.subscribe(task_id):
        yield event


async def _cancel_requested(task_id: str) -> bool:
    """以独立事务检查持久化取消标记，并同步进程内运行时状态。"""
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        return task is None or bool(task.cancel_requested)


async def _renew_lease(task_id: str) -> None:
    """仅续租仍由本运行拥有的 streaming 记录，避免迟到 owner 覆盖终态。"""
    now = datetime.now(UTC).replace(tzinfo=None)
    async with async_session_maker() as db:
        await db.execute(
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.status == GenerationTaskStatus.streaming,
                GenerationTask.lease_owner == task_id,
                GenerationTask.lease_epoch == 1,
            )
            .values(heartbeat_at=now, lease_expires_at=now + timedelta(seconds=_LEASE_SECONDS))
        )
        await db.commit()


async def _complete(task_id: str, *, model_id: str, model_revision_id: str) -> None:
    """在单一终态事务发布 assistant 消息并更新 hidden task，成功结果只写一次。"""
    events = await _runtime.replay(task_id)
    text = "".join(event.data.text_delta for event in events if isinstance(event.data, StreamDeltaData)).strip()
    if not text:
        await _fail(task_id, code="empty_response", message="Text model returned an empty response")
        return
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        if task is None or task.status != GenerationTaskStatus.streaming or task.cancel_requested:
            await _cancel(task_id, reason="cancel_requested")
            return
        link = await db.scalar(select(GenerationTaskLink).where(GenerationTaskLink.task_id == task_id))
        if link is None:
            await _fail(task_id, code="target_missing", message="Text stream target is missing")
            return
        assistant_message = (
            await append_experiment_messages(
                db,
                session_id=link.relation_entity_id,
                drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": model_id}, task_id=task_id)],
            )
        )[0]
        now = datetime.now(UTC).replace(tzinfo=None)
        task.status = GenerationTaskStatus.succeeded
        task.progress = 100
        task.result = {"text": text, "model_id": model_id}
        task.finished_at = now
        await db.commit()
        await db.refresh(assistant_message)
    await _runtime.complete(
        task_id,
        StreamCompletedData(
            task_id=task_id,
            assistant_message=_as_message_data(assistant_message),
            result=StreamGenerationResult(text=text, model_id=model_id, model_revision_id=model_revision_id),
        ),
    )


async def _cancel(task_id: str, *, reason: str) -> None:
    """写入取消终态；取消不创建用户可见错误或 assistant 消息。"""
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        if task is not None and task.status == GenerationTaskStatus.streaming:
            now = datetime.now(UTC).replace(tzinfo=None)
            task.status = GenerationTaskStatus.cancelled
            task.cancel_requested = True
            task.cancel_reason = reason
            task.cancelled_at = now
            task.finished_at = now
            await db.commit()
    try:
        await _runtime.cancel(task_id, reason)
    except TextStreamRunNotFoundError:
        return


async def _fail(task_id: str, *, code: str, message: str) -> None:
    """写入失败终态；仅 hidden task 保存稳定错误信息，不创建 assistant 消息。"""
    async with async_session_maker() as db:
        task = await db.get(GenerationTask, task_id)
        if task is not None and task.status == GenerationTaskStatus.streaming:
            task.status = GenerationTaskStatus.failed
            task.error = code
            task.finished_at = datetime.now(UTC).replace(tzinfo=None)
            await db.commit()
    try:
        await _runtime.fail(task_id, StreamErrorData(task_id=task_id, error=StreamErrorDetail(code=code, message=message)))
    except TextStreamRunNotFoundError:
        return


__all__ = ["create_text_stream_run", "request_text_stream_cancel", "stream_text_run", "subscribe_text_stream"]
