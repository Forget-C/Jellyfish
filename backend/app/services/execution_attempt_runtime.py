"""durable async Attempt 的通用控制面与交付协议。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptLease
from app.core.task_manager import SqlAlchemyTaskStore
from app.models.execution_attempt import ExecutionAttempt
from app.models.task import GenerationTask, GenerationTaskStatus


@dataclass(frozen=True, slots=True)
class TaskExecutionCommand:
    """Driver 的冻结输入，只携带 Attempt lease、任务类别与可序列化快照。"""

    lease: ExecutionAttemptLease
    task_kind: str
    snapshot: Mapping[str, Any]
    cancel_requested: bool
    idempotency_key: str | None = None


@dataclass(frozen=True, slots=True)
class DriverExecution:
    """Driver 的内存执行结果；领域投影必须由 Coordinator 后续完成。"""

    callback: ExecutionAttemptCallback
    output: object | None = None


@dataclass(slots=True)
class DeliveryContext:
    """已 fencing 的终态交付上下文，不向 Handler 暴露 lease 状态写权限。"""

    db: AsyncSession
    attempt: ExecutionAttempt
    task: GenerationTask
    command: TaskExecutionCommand
    output: object | None = None
    error: str | None = None


class TaskExecutionDriver(Protocol):
    """durable Worker 的纯执行协议，禁止直接写 Task、消息或业务对象。"""

    task_kinds: frozenset[str]

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """执行一次已领取 Attempt，并返回 fencing callback 与内存输出。"""


class DeliveryHandler(Protocol):
    """Operation-specific 终态投影协议，Task 终态仍由 Coordinator 条件写入。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, Any]:
        """投影成功领域结果，并返回稳定 Task.result。"""

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, Any]:
        """投影失败领域结果，并返回稳定 Task.result。"""

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, Any]:
        """投影取消领域结果，并返回稳定 Task.result。"""


class AttemptCallbackDisposition(str, Enum):
    """Attempt callback 对当前 fencing 状态的判定。"""

    accepted = "accepted"
    ignored_stale = "ignored_stale"
    ignored_duplicate = "ignored_duplicate"


class AttemptTerminalCoordinator:
    """收口 Attempt fencing、领域交付与 Task 终态；媒体归档由专用适配器负责。

    当前物理 Attempt 仍是 ``generation_runs``。它只处理通用控制面，不把媒体
    Artifact 或文本/脚本投影强行收敛为一种结果模型。
    """

    async def claim_terminalization(
        self,
        *,
        db: AsyncSession,
        callback: ExecutionAttemptCallback,
    ) -> ExecutionAttempt | None:
        """锁定当前 epoch 并切到 terminalizing，拒绝旧 owner 的迟到 callback。"""
        attempt = (
            await db.execute(
                select(ExecutionAttempt)
                .where(
                    ExecutionAttempt.id == callback.attempt_id,
                    ExecutionAttempt.lease_epoch == callback.lease_epoch,
                    ExecutionAttempt.status.in_(("claimed", "executing")),
                )
                .with_for_update()
            )
        ).scalars().first()
        if attempt is not None:
            attempt.status = "terminalizing"
            await db.flush()
        return attempt

    async def disposition(
        self,
        *,
        db: AsyncSession,
        callback: ExecutionAttemptCallback,
    ) -> AttemptCallbackDisposition:
        """判定 callback 是否可终态化，并保留 duplicate/stale 的诊断差异。"""
        if await self.claim_terminalization(db=db, callback=callback) is not None:
            return AttemptCallbackDisposition.accepted
        attempt = await db.get(ExecutionAttempt, callback.attempt_id)
        if attempt is not None and attempt.lease_epoch == callback.lease_epoch and attempt.status in {
            "terminalizing",
            "terminal",
        }:
            return AttemptCallbackDisposition.ignored_duplicate
        return AttemptCallbackDisposition.ignored_stale

    async def terminalize(
        self,
        *,
        db: AsyncSession,
        command: TaskExecutionCommand,
        execution: DriverExecution,
        handler: DeliveryHandler,
    ) -> AttemptCallbackDisposition:
        """在同一事务收口 Attempt、领域投影和 Task 终态。

        该方法不提交事务。调用方必须先领取 Attempt 并把 Task 置为 running；任何
        旧 epoch 或重复 callback 都会在调用 Handler 前返回，确保领域投影零副作用。
        """
        attempt = await self.claim_terminalization(db=db, callback=execution.callback)
        if attempt is None:
            return await self.disposition(db=db, callback=execution.callback)
        task = await db.get(GenerationTask, attempt.task_id)
        if task is None:
            raise RuntimeError(f"execution attempt task does not exist: {attempt.task_id}")
        if task.status != GenerationTaskStatus.running:
            raise RuntimeError(f"execution attempt task is not running: {attempt.task_id}")

        store = SqlAlchemyTaskStore(db)
        context = DeliveryContext(
            db=db,
            attempt=attempt,
            task=task,
            command=command,
            output=execution.output,
            error=execution.callback.error or execution.callback.error_code,
        )
        kind = execution.callback.kind.value
        if task.cancel_requested:
            kind = "cancelled"
            context.error = task.cancel_reason or "任务已取消"

        try:
            if kind == "succeeded":
                result = await handler.deliver_success(context)
                terminal = await store.complete_success(task.id, result)
            elif kind == "cancelled":
                result = await handler.deliver_cancelled(context)
                terminal = await store.mark_cancelled(task.id)
                if terminal is not None:
                    await store.set_result(task.id, result)
            else:
                result = await handler.deliver_failed(context)
                terminal = await store.complete_failure(task.id, result=result, error=context.error or "task execution failed")
        except Exception as error:  # noqa: BLE001
            context.error = f"terminal_delivery_failed: {error}"
            result = {"outcome": "failed", "error_code": "terminal_delivery_failed", "error": context.error}
            terminal = await store.complete_failure(task.id, result=result, error=context.error)

        if not terminal:
            raise RuntimeError(f"execution attempt task terminalization was rejected: {attempt.task_id}")
        attempt.status = "terminal"
        attempt.finished_at = datetime.now(UTC).replace(tzinfo=None)
        attempt.error = context.error
        attempt.callback_payload = {
            "attempt_id": execution.callback.attempt_id,
            "lease_epoch": execution.callback.lease_epoch,
            "kind": kind,
            "error_code": execution.callback.error_code,
            "error": context.error,
        }
        await db.flush()
        return AttemptCallbackDisposition.accepted


__all__ = [
    "AttemptCallbackDisposition",
    "AttemptTerminalCoordinator",
    "DeliveryContext",
    "DeliveryHandler",
    "DriverExecution",
    "TaskExecutionCommand",
    "TaskExecutionDriver",
]
