"""剧本变体分析接入通用 Attempt 的纯执行与结果交付适配。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.core.db_sync import sync_session_maker
from app.schemas.skills.script_processing import VariantAnalysisResult
from app.services.execution_attempt_runtime import DeliveryContext, DriverExecution, TaskExecutionCommand
from app.services.script_processing_worker import VariantResultGenerator


VariantResultFactory = Callable[[Session, dict[str, Any]], VariantAnalysisResult]


class ScriptVariantTaskExecutionDriver:
    """执行冻结的变体分析输入，不写入 Task 或任何剧本领域对象。

    既有变体 Agent 为同步调用；Driver 仅将其放入独立线程并返回内存结果，确保
    Attempt 的 fencing 与最终 Task 写入始终由通用 Coordinator 统一处理。
    """

    task_kinds = frozenset({"script_variant"})

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session] = sync_session_maker,
        result_factory: VariantResultFactory | None = None,
    ) -> None:
        """绑定同步只读执行会话，并允许测试替换变体分析计算。"""
        self._session_maker = session_maker
        self._result_factory = result_factory or self._generate_with_existing_agent

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """执行一次冻结变体分析，并将 Agent 异常映射为 fenced callback。"""
        if command.task_kind not in self.task_kinds:
            raise ValueError(f"unsupported script task kind: {command.task_kind}")
        try:
            result = await asyncio.to_thread(self._execute_sync, command.snapshot)
        except Exception as error:  # noqa: BLE001 - Agent 异常交由 Coordinator 统一收口。
            return DriverExecution(
                callback=ExecutionAttemptCallback(
                    attempt_id=command.lease.attempt_id,
                    lease_epoch=command.lease.lease_epoch,
                    kind=ExecutionAttemptCallbackKind.failed,
                    error_code="script_variant_failed",
                    error=str(error),
                )
            )
        return DriverExecution(
            callback=ExecutionAttemptCallback(
                attempt_id=command.lease.attempt_id,
                lease_epoch=command.lease.lease_epoch,
                kind=ExecutionAttemptCallbackKind.succeeded,
            ),
            output=result,
        )

    def _execute_sync(self, snapshot: Mapping[str, Any]) -> VariantAnalysisResult:
        """从冻结快照读取变体分析输入，并在独立会话复用既有 Agent。"""
        run_args = snapshot.get("run_args")
        if not isinstance(run_args, Mapping):
            raise ValueError("script variant snapshot.run_args is required")
        merged_library = run_args.get("merged_library")
        all_shot_extractions = run_args.get("all_shot_extractions")
        script_division = run_args.get("script_division")
        if not isinstance(merged_library, Mapping):
            raise ValueError("script variant snapshot.run_args.merged_library is required")
        if not isinstance(all_shot_extractions, list):
            raise ValueError("script variant snapshot.run_args.all_shot_extractions is required")
        if script_division is not None and not isinstance(script_division, Mapping):
            raise ValueError("script variant snapshot.run_args.script_division must be an object")
        normalized_args = {
            "merged_library": dict(merged_library),
            "all_shot_extractions": all_shot_extractions,
            "script_division": dict(script_division or {}),
        }
        with self._session_maker() as db:
            return self._result_factory(db, normalized_args)

    @staticmethod
    def _generate_with_existing_agent(db: Session, run_args: dict[str, Any]) -> VariantAnalysisResult:
        """复用旧 Worker 的纯生成器，避免复制 Provider 与 Agent 调用逻辑。"""
        return VariantResultGenerator().generate(db, run_args)


class ScriptVariantDeliveryHandler:
    """将变体分析结果规范化为 Task.result，不直接写入任何领域对象。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, Any]:
        """序列化 Agent 结果；Task 成功状态仍由通用 Coordinator 条件写入。"""
        result = context.output
        if isinstance(result, VariantAnalysisResult):
            return result.model_dump(mode="json")
        if isinstance(result, Mapping):
            return dict(result)
        raise TypeError("script variant driver returned an unsupported result")

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定失败载荷，不附加变体领域副作用。"""
        error = context.error or "script variant task failed"
        return {"outcome": "failed", "error_code": "script_variant_failed", "error": error}

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定取消载荷，不投影任何部分分析结果。"""
        return {"outcome": "cancelled", "reason": context.error or "任务已取消"}


__all__ = ["ScriptVariantDeliveryHandler", "ScriptVariantTaskExecutionDriver"]
