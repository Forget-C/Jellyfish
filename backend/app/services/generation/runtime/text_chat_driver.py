"""后台文本聊天的通用 Attempt Driver 与实验室交付 Handler。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.core.contracts.generation import ResolvedGenerationSnapshot
from app.models.experiment_sessions import ExperimentMessage
from app.models.task_links import GenerationTaskLink
from app.services.execution_attempt_runtime import DeliveryContext, DriverExecution, TaskExecutionCommand
from app.services.generation.runtime.text_chat_streaming import _invoke_text_snapshot, _require_text_session
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages, project_task_message_terminal


class TextChatTaskExecutionDriver:
    """只执行冻结文本快照；不直接写 Task 或实验室消息。"""

    task_kinds = frozenset({"text_chat"})

    def __init__(self, db: AsyncSession) -> None:
        """绑定模型解析需要的数据库会话。"""
        self._db = db

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """调用模型一次，并将结果保留在内存输出供 Coordinator 交付。"""
        if command.task_kind != "text_chat":
            raise ValueError(f"unsupported text task kind: {command.task_kind}")
        try:
            text = await _invoke_text_snapshot(self._db, snapshot_payload=dict(command.snapshot))
        except Exception as error:  # noqa: BLE001 - Provider 错误统一映射为 Attempt callback。
            return DriverExecution(
                callback=ExecutionAttemptCallback(
                    attempt_id=command.lease.attempt_id,
                    lease_epoch=command.lease.lease_epoch,
                    kind=ExecutionAttemptCallbackKind.failed,
                    error_code="text_chat_provider_failed",
                    error=str(error),
                )
            )
        return DriverExecution(
            callback=ExecutionAttemptCallback(
                attempt_id=command.lease.attempt_id,
                lease_epoch=command.lease.lease_epoch,
                kind=ExecutionAttemptCallbackKind.succeeded,
            ),
            output=text,
        )


class TextChatDeliveryHandler:
    """将已 fencing 的文本 Attempt 终态投影到实验室时间线。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, Any]:
        """只在成功时追加一条助手消息，并完成对应 task 消息投影。"""
        session_id, model_id, task_message = await self._validated_delivery_inputs(context)
        text = context.output if isinstance(context.output, str) else ""
        if not text.strip():
            raise ValueError("text chat driver returned an empty response")
        assistant_message = (
            await append_experiment_messages(
                context.db,
                session_id=session_id,
                drafts=[ExperimentMessageDraft(role="assistant", content=text, payload={"model_id": model_id})],
            )
        )[0]
        result = {"text": text, "assistant_message_id": assistant_message.id, "model_id": model_id}
        project_task_message_terminal(task_message, status="succeeded", result=result, progress=100)
        return result

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, Any]:
        """投影稳定失败摘要，且绝不生成助手消息。"""
        _, _, task_message = await self._validated_delivery_inputs(context)
        error = context.error or "text chat task failed"
        result = {"outcome": "failed", "error_code": "text_chat_provider_failed", "error": error}
        project_task_message_terminal(task_message, status="failed", result=result, error=error)
        return result

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, Any]:
        """投影取消终态，且绝不把已取消响应伪装为助手消息。"""
        _, _, task_message = await self._validated_delivery_inputs(context)
        reason = context.error or "任务已取消"
        result = {"outcome": "cancelled", "reason": reason}
        project_task_message_terminal(task_message, status="cancelled", result=result, error=reason)
        return result

    @staticmethod
    async def _validated_delivery_inputs(context: DeliveryContext) -> tuple[str, str, ExperimentMessage]:
        """复核任务 target、文本会话与 task 消息归属，阻断跨会话投影。"""
        snapshot = ResolvedGenerationSnapshot.model_validate(dict(context.command.snapshot))
        session_id = snapshot.canonical_target.entity_id
        await _require_text_session(context.db, session_id=session_id)
        link = await context.db.scalar(select(GenerationTaskLink).where(GenerationTaskLink.task_id == context.task.id))
        if link is None or link.relation_type != "experiment_session" or link.relation_entity_id != session_id:
            raise ValueError("text chat task target is unavailable")
        task_message = await context.db.scalar(select(ExperimentMessage).where(ExperimentMessage.task_id == context.task.id))
        if task_message is None or task_message.session_id != session_id:
            raise ValueError("text chat task message is unavailable or belongs to another session")
        return session_id, snapshot.model_id, task_message


__all__ = ["TextChatDeliveryHandler", "TextChatTaskExecutionDriver"]
