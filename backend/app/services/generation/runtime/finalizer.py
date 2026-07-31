"""统一生成任务的终态收口服务。

Finalizer 只协调 TaskStore 与 WorkflowHandler 的写入顺序；数据库事务由调用方
控制，因此调用方可将 Artifact、领域投影和任务终态原子提交。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_delivery import GenerationDeliveryResult, GenerationOutcome
from app.core.task_manager.stores import TaskStore
from app.models.generation_artifacts import GenerationArtifact
from app.models.task import GenerationTask, GenerationTaskStatus
from app.services.generation.workflows.base import GenerationWorkflowTerminalContext
from app.services.generation.workflows.defaults import generation_workflow_registry
from app.services.generation.workflows.registry import GenerationWorkflowRegistry


class TaskFinalizer:
    """按可信 workflow 收口任务成功、失败和取消终态。

    本服务不调用 ``commit`` 或 ``rollback``。Provider Worker 可以在同一事务内先
    归档 Artifact，再调用 Finalizer 完成领域交付与任务状态更新。
    """

    def __init__(self, *, workflow_registry: GenerationWorkflowRegistry = generation_workflow_registry) -> None:
        """注入 Registry，允许测试或后续迁移使用受控的领域 Handler。"""
        self._workflow_registry = workflow_registry

    async def finalize_success(
        self,
        *,
        db: AsyncSession,
        store: TaskStore,
        task_id: str,
        operation: GenerationOperation,
        snapshot: ResolvedGenerationSnapshot,
        artifacts: list[GenerationArtifact],
    ) -> GenerationDeliveryResult:
        """收口成功任务，并确保领域投影异常不会遗留运行中的任务。"""
        if not await _lock_active_task(db, task_id=task_id):
            await self.finalize_cancelled(
                db=db,
                store=store,
                task_id=task_id,
                operation=operation,
                snapshot=snapshot,
                reason="任务在领域交付前已取消",
            )
            return GenerationDeliveryResult(
                outcome=GenerationOutcome.cancelled,
                error_code="generation_cancelled",
                error_message="任务在领域交付前已取消",
            )
        handler = self._resolve_handler(operation=operation, snapshot=snapshot)
        try:
            result = await handler.deliver_success(
                self._terminal_context(
                    db=db,
                    task_id=task_id,
                    snapshot=snapshot,
                    artifacts=artifacts,
                )
            )
        except Exception as error:  # noqa: BLE001
            diagnostic = _terminal_projection_diagnostic(error)
            result = GenerationDeliveryResult(
                outcome=GenerationOutcome.failed,
                error_code="terminal_delivery_failed",
                error_message=diagnostic,
            )
            if not await store.complete_failure(task_id, result=result.model_dump(mode="json"), error=diagnostic):
                await self.finalize_cancelled(
                    db=db, store=store, task_id=task_id, operation=operation, snapshot=snapshot, reason="任务已取消"
                )
                return GenerationDeliveryResult(
                    outcome=GenerationOutcome.cancelled, error_code="generation_cancelled", error_message="任务已取消"
                )
            return result
        if await store.complete_success(task_id, result.model_dump(mode="json")):
            return result
        await self.finalize_cancelled(
            db=db,
            store=store,
            task_id=task_id,
            operation=operation,
            snapshot=snapshot,
            reason="任务在成功收口前已取消",
        )
        return GenerationDeliveryResult(
            outcome=GenerationOutcome.cancelled,
            error_code="generation_cancelled",
            error_message="任务在成功收口前已取消",
        )

    async def finalize_failure(
        self,
        *,
        db: AsyncSession,
        store: TaskStore,
        task_id: str,
        operation: GenerationOperation,
        snapshot: ResolvedGenerationSnapshot,
        error: str,
    ) -> None:
        """尽力投影失败信息；已请求取消时由取消终态优先收口。"""
        if await store.is_cancel_requested(task_id):
            await self.finalize_cancelled(
                db=db,
                store=store,
                task_id=task_id,
                operation=operation,
                snapshot=snapshot,
                reason="任务已取消",
            )
            return
        handler = self._resolve_handler(operation=operation, snapshot=snapshot)
        terminal_error = error
        try:
            await handler.deliver_failed(
                self._terminal_context(db=db, task_id=task_id, snapshot=snapshot, error=error)
            )
        except Exception as projection_error:  # noqa: BLE001
            terminal_error = f"{error}; {_terminal_projection_diagnostic(projection_error)}"
        result = GenerationDeliveryResult(
            outcome=GenerationOutcome.failed,
            error_code="generation_failed",
            error_message=terminal_error,
        )
        if not await store.complete_failure(task_id, result=result.model_dump(mode="json"), error=terminal_error):
            await self.finalize_cancelled(
                db=db, store=store, task_id=task_id, operation=operation, snapshot=snapshot, reason="任务已取消"
            )

    async def finalize_cancelled(
        self,
        *,
        db: AsyncSession,
        store: TaskStore,
        task_id: str,
        operation: GenerationOperation,
        snapshot: ResolvedGenerationSnapshot,
        reason: str | None = None,
    ) -> None:
        """尽力交付取消投影，并以 TaskStore 标准语义保证任务取消。"""
        handler = self._resolve_handler(operation=operation, snapshot=snapshot)
        terminal_error = reason or ""
        try:
            await handler.deliver_cancelled(
                self._terminal_context(db=db, task_id=task_id, snapshot=snapshot, error=terminal_error)
            )
        except Exception as projection_error:  # noqa: BLE001
            terminal_error = "; ".join(filter(None, [terminal_error, _terminal_projection_diagnostic(projection_error)]))
        if terminal_error:
            await store.set_error(task_id, terminal_error)
        await store.set_result(
            task_id,
            GenerationDeliveryResult(
                outcome=GenerationOutcome.cancelled,
                error_code="generation_cancelled",
                error_message=terminal_error or "任务已取消",
            ).model_dump(mode="json"),
        )
        await store.mark_cancelled(task_id)

    def _resolve_handler(self, *, operation: GenerationOperation, snapshot: ResolvedGenerationSnapshot):
        """仅按快照中的可信目标解析 Handler，禁止终态阶段重新猜测业务关系。"""
        return self._workflow_registry.resolve(
            operation=operation,
            target_kind=snapshot.canonical_target.kind,
        )

    @staticmethod
    def _terminal_context(
        *,
        db: AsyncSession,
        task_id: str,
        snapshot: ResolvedGenerationSnapshot,
        artifacts: list[GenerationArtifact] | None = None,
        error: str | None = None,
    ) -> GenerationWorkflowTerminalContext:
        """构造 Handler 所需的统一终态上下文，不引入额外持久化副作用。"""
        # 所有 WorkflowHandler 都可读取 Artifact 列表；失败/取消时传空列表，避免
        # 领域 Handler 为终态不同而重复判断上下文结构。
        data: dict[str, Any] = {"db": db, "snapshot": snapshot, "artifacts": artifacts or []}
        if error is not None:
            data["error"] = error
        return GenerationWorkflowTerminalContext(task_id=task_id, data=data)


def _terminal_projection_diagnostic(error: Exception) -> str:
    """构造可审计的领域投影失败摘要，不让它覆盖任务原始终态。"""

    return f"terminal_projection_failed: {error}"


async def _lock_active_task(db: AsyncSession, *, task_id: str) -> bool:
    """锁定任务行并确认仍可成功交付，串行化取消请求与领域写回。"""

    task = (
        await db.execute(
            select(GenerationTask)
            .where(GenerationTask.id == task_id)
            .with_for_update()
        )
    ).scalars().first()
    return task is not None and task.status == GenerationTaskStatus.running and not task.cancel_requested


__all__ = ["TaskFinalizer"]
