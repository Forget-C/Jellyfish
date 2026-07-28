"""文本实验室流式执行、隐藏运行持久化与 canonical 消息发布。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, status
from langchain_core.messages import HumanMessage
from sqlalchemy import case, func, or_, select, update
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


@dataclass(frozen=True, slots=True)
class _StreamLease:
    """标识一次持久化流式执行的 fencing owner 与 epoch。"""

    owner: str
    epoch: int


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
            # accepted 已提交但尚未开始执行时不预占 owner；真正执行者通过
            # compare-and-swap 认领 lease，避免重复调度者共用固定 epoch。
            lease_owner=None,
            lease_epoch=0,
            lease_expires_at=now,
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
    lease = await _claim_lease(task_id)
    if lease is None:
        return
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
            await _fail(task_id, lease=lease, code="invalid_snapshot", message="Text stream snapshot is invalid")
            return
        model = await build_text_chat_model(db, model_id=model_id, thinking=False)

    try:
        async for chunk in model.astream([HumanMessage(content=str(messages[-1]["content"]))]):
            if await _cancel_requested(task_id, lease):
                await _cancel(task_id, lease=lease, reason="cancel_requested")
                return
            if not await _renew_lease(task_id, lease):
                return
            text = _chunk_text(chunk)
            if text:
                await _runtime.emit_delta(task_id, StreamDeltaData(task_id=task_id, text_delta=text))
        if await _cancel_requested(task_id, lease):
            await _cancel(task_id, lease=lease, reason="cancel_requested")
            return
        await _complete(
            task_id,
            lease=lease,
            model_id=model_id,
            model_revision_id=str(snapshot.get("model_revision_id") or "unknown"),
        )
    except asyncio.CancelledError:
        # 服务关闭或请求协程被取消时，不能留下无法收敛的 hidden task。
        await _cancel(task_id, lease=lease, reason="stream_interrupted")
        raise
    except TextStreamRunNotFoundError:
        return
    except Exception:  # Provider 原始异常不得泄漏到 SSE
        await _fail(task_id, lease=lease, code="provider_failed", message="Text model invocation failed")


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


async def _cancel_requested(task_id: str, lease: _StreamLease) -> bool:
    """检查取消或 lease 丢失；旧 owner 必须立即停止产生任何可见结果。"""
    async with async_session_maker() as db:
        task = await db.scalar(
            select(GenerationTask).where(
                GenerationTask.id == task_id,
                GenerationTask.status == GenerationTaskStatus.streaming,
                GenerationTask.lease_owner == lease.owner,
                GenerationTask.lease_epoch == lease.epoch,
            )
        )
        return task is None or bool(task.cancel_requested)


async def _claim_lease(task_id: str) -> _StreamLease | None:
    """原子认领未持有或已过期的 hidden text lease，并递增 fencing epoch。"""
    now = datetime.now(UTC).replace(tzinfo=None)
    owner = uuid4().hex
    async with async_session_maker() as db:
        result = await db.execute(
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.status == GenerationTaskStatus.streaming,
                GenerationTask.visibility == GenerationTaskVisibility.hidden,
                GenerationTask.mode == GenerationDeliveryMode.streaming,
                or_(GenerationTask.lease_owner.is_(None), GenerationTask.lease_expires_at <= now),
            )
            .values(
                lease_owner=owner,
                lease_epoch=GenerationTask.lease_epoch + 1,
                heartbeat_at=now,
                lease_expires_at=now + timedelta(seconds=_LEASE_SECONDS),
            )
        )
        if result.rowcount != 1:
            await db.rollback()
            return None
        epoch = await db.scalar(
            select(GenerationTask.lease_epoch).where(GenerationTask.id == task_id, GenerationTask.lease_owner == owner)
        )
        await db.commit()
    return _StreamLease(owner=owner, epoch=int(epoch))


async def _renew_lease(task_id: str, lease: _StreamLease) -> bool:
    """仅续租仍由本运行拥有的 streaming 记录，避免迟到 owner 覆盖终态。"""
    now = datetime.now(UTC).replace(tzinfo=None)
    async with async_session_maker() as db:
        result = await db.execute(
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.status == GenerationTaskStatus.streaming,
                GenerationTask.lease_owner == lease.owner,
                GenerationTask.lease_epoch == lease.epoch,
            )
            .values(heartbeat_at=now, lease_expires_at=now + timedelta(seconds=_LEASE_SECONDS))
        )
        await db.commit()
        return result.rowcount == 1


async def _complete(task_id: str, *, lease: _StreamLease, model_id: str, model_revision_id: str) -> None:
    """在单一终态事务发布 assistant 消息并更新 hidden task，成功结果只写一次。"""
    events = await _runtime.replay(task_id)
    text = "".join(event.data.text_delta for event in events if isinstance(event.data, StreamDeltaData)).strip()
    if not text:
        await _fail(task_id, lease=lease, code="empty_response", message="Text model returned an empty response")
        return
    async with async_session_maker() as db:
        link = await db.scalar(select(GenerationTaskLink).where(GenerationTaskLink.task_id == task_id))
        if link is None:
            await db.rollback()
            await _fail(task_id, lease=lease, code="target_missing", message="Text stream target is missing")
            return
        now = datetime.now(UTC).replace(tzinfo=None)
        result = await db.execute(
            update(GenerationTask)
            .where(
                GenerationTask.id == task_id,
                GenerationTask.status == GenerationTaskStatus.streaming,
                GenerationTask.cancel_requested.is_(False),
                GenerationTask.lease_owner == lease.owner,
                GenerationTask.lease_epoch == lease.epoch,
            )
            .values(status=GenerationTaskStatus.succeeded, progress=100, result={"text": text, "model_id": model_id}, finished_at=now)
        )
        if result.rowcount != 1:
            await db.rollback()
            return
        assistant_message = (
            await append_experiment_messages(
                db,
                session_id=link.relation_entity_id,
                drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": model_id}, task_id=task_id)],
            )
        )[0]
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


async def _cancel(task_id: str, *, lease: _StreamLease, reason: str) -> None:
    """写入取消终态；取消不创建用户可见错误或 assistant 消息。"""
    async with async_session_maker() as db:
        now = datetime.now(UTC).replace(tzinfo=None)
        result = await db.execute(
            update(GenerationTask)
            .where(GenerationTask.id == task_id, GenerationTask.status == GenerationTaskStatus.streaming,
                   GenerationTask.lease_owner == lease.owner, GenerationTask.lease_epoch == lease.epoch)
            .values(status=GenerationTaskStatus.cancelled, cancel_requested=True, cancel_reason=reason,
                    cancelled_at=now, finished_at=now)
        )
        await db.commit()
    if result.rowcount != 1:
        return
    try:
        await _runtime.cancel(task_id, reason)
    except TextStreamRunNotFoundError:
        return


async def _fail(task_id: str, *, lease: _StreamLease, code: str, message: str) -> None:
    """写入失败终态；仅 hidden task 保存稳定错误信息，不创建 assistant 消息。"""
    async with async_session_maker() as db:
        result = await db.execute(
            update(GenerationTask)
            .where(GenerationTask.id == task_id, GenerationTask.status == GenerationTaskStatus.streaming,
                   GenerationTask.lease_owner == lease.owner, GenerationTask.lease_epoch == lease.epoch)
            .values(status=GenerationTaskStatus.failed, error=code, finished_at=datetime.now(UTC).replace(tzinfo=None))
        )
        await db.commit()
    if result.rowcount != 1:
        return
    try:
        await _runtime.fail(task_id, StreamErrorData(task_id=task_id, error=StreamErrorDetail(code=code, message=message)))
    except TextStreamRunNotFoundError:
        return


async def reap_expired_text_stream_runs(*, limit: int = 100) -> list[str]:
    """回收 lease 已过期的 hidden text run，并用递增 epoch 隔离迟到执行者。

    该函数可由周期性 worker 调用；每条记录的条件更新同时核验过期时间，因而
    多个 reaper 并发时最多一个会取得终态写入权。
    """
    if limit < 1:
        raise ValueError("limit must be greater than zero")
    now = datetime.now(UTC).replace(tzinfo=None)
    async with async_session_maker() as db:
        task_ids = list(
            await db.scalars(
                select(GenerationTask.id)
                .where(
                    GenerationTask.status == GenerationTaskStatus.streaming,
                    GenerationTask.visibility == GenerationTaskVisibility.hidden,
                    GenerationTask.mode == GenerationDeliveryMode.streaming,
                    GenerationTask.task_kind == GenerationOperation.text_chat.value,
                    GenerationTask.lease_expires_at.is_not(None),
                    GenerationTask.lease_expires_at <= now,
                )
                .limit(limit)
            )
        )
        reaped: list[tuple[str, bool]] = []
        for task_id in task_ids:
            result = await db.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.id == task_id,
                    GenerationTask.status == GenerationTaskStatus.streaming,
                    GenerationTask.lease_expires_at.is_not(None),
                    GenerationTask.lease_expires_at <= now,
                )
                .values(
                    status=case(
                        (GenerationTask.cancel_requested.is_(True), GenerationTaskStatus.cancelled),
                        else_=GenerationTaskStatus.failed,
                    ),
                    error=case((GenerationTask.cancel_requested.is_(True), ""), else_="stream_lease_expired"),
                    cancel_reason=case(
                        (GenerationTask.cancel_requested.is_(True), GenerationTask.cancel_reason),
                        else_="stream_lease_expired",
                    ),
                    cancelled_at=case((GenerationTask.cancel_requested.is_(True), now), else_=GenerationTask.cancelled_at),
                    finished_at=now,
                    lease_owner=None,
                    lease_epoch=GenerationTask.lease_epoch + 1,
                    lease_expires_at=now,
                )
            )
            if result.rowcount == 1:
                reaped.append((task_id, bool(await db.scalar(select(GenerationTask.cancel_requested).where(GenerationTask.id == task_id)))))
        await db.commit()
    for task_id, was_cancelled in reaped:
        try:
            if was_cancelled:
                await _runtime.cancel(task_id, "cancel_requested")
            else:
                await _runtime.fail(
                    task_id,
                    StreamErrorData(
                        task_id=task_id,
                        error=StreamErrorDetail(code="stream_lease_expired", message="Text stream lease expired"),
                    ),
                )
        except TextStreamRunNotFoundError:
            continue
    return [task_id for task_id, _ in reaped]


__all__ = [
    "create_text_stream_run",
    "reap_expired_text_stream_runs",
    "request_text_stream_cancel",
    "stream_text_run",
    "subscribe_text_stream",
]
