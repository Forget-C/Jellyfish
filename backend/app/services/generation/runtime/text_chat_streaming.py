"""文本实验室流式执行、隐藏运行持久化与 canonical 消息发布。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
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
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.core.db import async_session_maker
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.task import GenerationDeliveryMode, GenerationTask, GenerationTaskStatus, GenerationTaskVisibility
from app.models.task_links import GenerationTaskLink
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission import GenerationAccepted, GenerationSubmitter
from app.services.generation.runtime.text_streaming import TextStreamRunNotFoundError, TextStreamingRuntime
from app.services.llm.resolver import build_text_chat_model
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure

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


def _text_chat_command(*, session_id: str, model_id: str, content: str, delivery: GenerationDelivery) -> GenerationCommand:
    """按固定文本实验室路径构造命令，调用方不能从请求体更换交付方式或目标。"""
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
    db: AsyncSession,
    *,
    session_id: str,
    model_id: str,
    content: str,
) -> tuple[GenerationAccepted, ExperimentMessage, ExperimentMessage]:
    """原子写入文本用户消息、任务消息和可由 Celery 消费的安全快照任务。"""
    session = await _require_text_session(db, session_id=session_id)
    command = _text_chat_command(
        session_id=session_id,
        model_id=model_id,
        content=content,
        delivery=GenerationDelivery.async_polling,
    )
    user_message, task_message = await append_experiment_messages(
        db,
        session_id=session_id,
        drafts=[
            ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id}),
            ExperimentMessageDraft(
                role="task",
                content="文本生成任务已提交，正在等待生成结果。",
                status="pending",
                payload={"model_id": model_id},
            ),
        ],
    )
    accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
    task_message.task_id = accepted.task_id
    session.updated_at = func.now()
    await db.flush()
    return accepted, user_message, task_message


async def execute_text_inline(
    db: AsyncSession,
    *,
    session_id: str,
    model_id: str,
    content: str,
) -> tuple[ExperimentMessage, ExperimentMessage]:
    """以固定 JSON 路径执行单轮文本并持久化 canonical user/assistant 消息。"""
    await _require_text_session(db, session_id=session_id)
    command = _text_chat_command(
        session_id=session_id,
        model_id=model_id,
        content=content,
        delivery=GenerationDelivery.inline,
    )
    snapshot = await GenerationEntityGate().validate(db, command)
    user_message = (
        await append_experiment_messages(
            db,
            session_id=session_id,
            drafts=[ExperimentMessageDraft(role="user", content=content, payload={"model_id": model_id})],
        )
    )[0]
    text = await _invoke_text_snapshot(db, snapshot_payload=snapshot.model_dump(mode="json", exclude={"credential_ref"}))
    assistant_message = (
        await append_experiment_messages(
            db,
            session_id=session_id,
            drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": snapshot.model_id})],
        )
    )[0]
    return user_message, assistant_message


async def _require_text_session(db: AsyncSession, *, session_id: str) -> ExperimentSession:
    """读取文本实验会话，防止跨实验室写入 canonical 消息。"""
    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    if session.lab_type != "text":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")
    return session


def _as_langchain_messages(messages: list[dict[str, object]]) -> list[HumanMessage | AIMessage | SystemMessage]:
    """将冻结聊天消息映射为 LangChain 消息，拒绝未知角色以保持执行语义封闭。"""
    result: list[HumanMessage | AIMessage | SystemMessage] = []
    for message in messages:
        content = str(message.get("content") or "")
        role = str(message.get("role") or "")
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
    """仅从无凭据快照读取文本输入，并在执行期按模型 ID 解析供应商凭据。"""
    operation_input = dict(snapshot_payload.get("operation_input") or {})
    if operation_input.get("kind") != "text_chat":
        raise RuntimeError("text chat snapshot operation is unavailable")
    messages = list(operation_input.get("messages") or [])
    model_id = str(snapshot_payload.get("model_id") or "")
    if not model_id:
        raise RuntimeError("text chat snapshot model is unavailable")
    model = await build_text_chat_model(db, model_id=model_id, thinking=False)
    response = await model.ainvoke(_as_langchain_messages(messages))
    text = _chunk_text(response).strip()
    if not text:
        raise RuntimeError("text model returned an empty response")
    return text


async def run_text_chat_task(task_id: str, run_args: dict[str, object]) -> None:
    """执行 async text_chat 任务，并把生成结果追加为 canonical assistant 消息。"""
    del run_args
    async with async_session_maker() as db:
        try:
            store = SqlAlchemyTaskStore(db)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_progress(task_id, 10)
            await db.commit()
            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                log_task_event("text_chat", task_id, "cancelled", stage="before_execute")
                return
            task = await db.get(GenerationTask, task_id)
            snapshot_payload = dict((task.payload or {}).get("snapshot") or {}) if task else {}
            text = await _invoke_text_snapshot(db, snapshot_payload=snapshot_payload)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=db):
                log_task_event("text_chat", task_id, "cancelled", stage="after_execute")
                return
            model_id = str(snapshot_payload.get("model_id") or "")
            link = await db.scalar(select(GenerationTaskLink).where(GenerationTaskLink.task_id == task_id))
            if link is None or link.relation_type != GenerationTargetKind.experiment_session.value:
                raise RuntimeError("text chat task target is unavailable")
            assistant_message = (
                await append_experiment_messages(
                    db,
                    session_id=link.relation_entity_id,
                    drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": model_id}, task_id=None)],
                )
            )[0]
            await store.set_result(task_id, {"text": text, "assistant_message_id": assistant_message.id, "model_id": model_id})
            task_message = await db.scalar(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))
            if task_message is not None:
                task_message.status = "succeeded"
                task_message.payload = {**task_message.payload, "assistant_message_id": assistant_message.id}
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
                    task_message.status = "failed"
                    task_message.payload = {**task_message.payload, "error": str(exc)}
                await failed_db.commit()
            log_task_failure("text_chat", task_id, str(exc))


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
    "create_text_async_task",
    "create_text_stream_run",
    "execute_text_inline",
    "reap_expired_text_stream_runs",
    "request_text_stream_cancel",
    "run_text_chat_task",
    "stream_text_run",
    "subscribe_text_stream",
]
