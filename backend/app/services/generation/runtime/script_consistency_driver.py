"""剧本一致性检查接入通用 Attempt 的纯执行与结果交付适配。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.core.db_sync import sync_session_maker
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult
from app.services.execution_attempt_runtime import DeliveryContext, DriverExecution, TaskExecutionCommand
from app.services.script_processing_worker import ConsistencyResultGenerator


ConsistencyResultFactory = Callable[[Session, dict[str, Any]], ScriptConsistencyCheckResult]


class ScriptConsistencyTaskExecutionDriver:
    """执行冻结的一致性检查输入，不写入 Task 或任何剧本领域对象。

    既有一致性 Agent 为同步调用；这里仅将它隔离到线程中，返回内存结果，终态
    Task 写入和任何未来的领域投影均由 AttemptTerminalCoordinator 负责。
    """

    task_kinds = frozenset({"script_consistency"})

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session] = sync_session_maker,
        result_factory: ConsistencyResultFactory | None = None,
    ) -> None:
        """绑定同步只读执行会话，并允许测试替换一致性计算。"""
        self._session_maker = session_maker
        self._result_factory = result_factory or self._generate_with_existing_agent

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """执行一次 Agent 检查，并将模型错误映射为可 fencing 的失败 callback。"""
        if command.task_kind not in self.task_kinds:
            raise ValueError(f"unsupported script task kind: {command.task_kind}")
        try:
            result = await asyncio.to_thread(self._execute_sync, command.snapshot)
        except Exception as error:  # noqa: BLE001 - Agent/Provider 异常统一由 Coordinator 收口。
            return DriverExecution(
                callback=ExecutionAttemptCallback(
                    attempt_id=command.lease.attempt_id,
                    lease_epoch=command.lease.lease_epoch,
                    kind=ExecutionAttemptCallbackKind.failed,
                    error_code="script_consistency_failed",
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

    def _execute_sync(self, snapshot: Mapping[str, Any]) -> ScriptConsistencyCheckResult:
        """从冻结快照读取输入，在独立同步会话中复用既有一致性 Agent。"""
        run_args = snapshot.get("run_args")
        if not isinstance(run_args, Mapping):
            raise ValueError("script consistency snapshot.run_args is required")
        script_text = run_args.get("script_text")
        if not isinstance(script_text, str) or not script_text.strip():
            raise ValueError("script consistency snapshot.run_args.script_text is required")
        with self._session_maker() as db:
            return self._result_factory(db, {"script_text": script_text})

    @staticmethod
    def _generate_with_existing_agent(db: Session, run_args: dict[str, Any]) -> ScriptConsistencyCheckResult:
        """复用旧 Worker 的纯生成器，避免复制 Provider/Agent 调用逻辑。"""
        return ConsistencyResultGenerator().generate(db, run_args)


class ScriptConsistencyDeliveryHandler:
    """将一致性结果规范化为 Task.result，不直接写入任何领域对象。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, Any]:
        """序列化 Agent 结果；真正的 Task 成功状态由通用 Coordinator 条件写入。"""
        result = context.output
        if isinstance(result, ScriptConsistencyCheckResult):
            return result.model_dump(mode="json")
        if isinstance(result, Mapping):
            return dict(result)
        raise TypeError("script consistency driver returned an unsupported result")

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定失败载荷，不附加一致性领域副作用。"""
        error = context.error or "script consistency task failed"
        return {"outcome": "failed", "error_code": "script_consistency_failed", "error": error}

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定取消载荷，不投影任何部分检查结果。"""
        return {"outcome": "cancelled", "reason": context.error or "任务已取消"}


__all__ = ["ScriptConsistencyDeliveryHandler", "ScriptConsistencyTaskExecutionDriver"]
