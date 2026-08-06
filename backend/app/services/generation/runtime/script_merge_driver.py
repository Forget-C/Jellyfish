"""剧本实体合并接入通用 Attempt 的纯执行与结果交付适配。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.core.db_sync import sync_session_maker
from app.schemas.skills.script_processing import EntityMergeResult
from app.services.execution_attempt_runtime import DeliveryContext, DriverExecution, TaskExecutionCommand
from app.services.script_processing_worker import MergeResultGenerator


MergeResultFactory = Callable[[Session, dict[str, Any]], EntityMergeResult]


class ScriptMergeTaskExecutionDriver:
    """执行冻结的实体合并输入，不写入 Task 或业务实体库。"""

    task_kinds = frozenset({"script_merge"})

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session] = sync_session_maker,
        result_factory: MergeResultFactory | None = None,
    ) -> None:
        """绑定同步 Agent 会话，并允许测试替换既有的纯生成器。"""
        self._session_maker = session_maker
        self._result_factory = result_factory or self._generate_with_existing_agent

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """在线程中调用只读 Agent，并把异常转换为可 fencing 的失败 callback。"""
        if command.task_kind not in self.task_kinds:
            raise ValueError(f"unsupported script task kind: {command.task_kind}")
        try:
            result = await asyncio.to_thread(self._execute_sync, command.snapshot)
        except Exception as error:  # noqa: BLE001 - 统一由 Coordinator 写入终态。
            return DriverExecution(
                callback=ExecutionAttemptCallback(
                    attempt_id=command.lease.attempt_id,
                    lease_epoch=command.lease.lease_epoch,
                    kind=ExecutionAttemptCallbackKind.failed,
                    error_code="script_merge_failed",
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

    def _execute_sync(self, snapshot: Mapping[str, Any]) -> EntityMergeResult:
        """验证冻结 run_args，并在独立同步会话中复用现有合并 Agent。"""
        run_args = snapshot.get("run_args")
        if not isinstance(run_args, Mapping):
            raise ValueError("script merge snapshot.run_args is required")
        all_shot_extractions = run_args.get("all_shot_extractions")
        if not isinstance(all_shot_extractions, list):
            raise ValueError("script merge snapshot.run_args.all_shot_extractions is required")
        normalized = {
            "all_shot_extractions": all_shot_extractions,
            "historical_library": _mapping_or_none(run_args.get("historical_library"), "historical_library"),
            "script_division": _mapping_or_none(run_args.get("script_division"), "script_division"),
            "previous_merge": _mapping_or_none(run_args.get("previous_merge"), "previous_merge"),
            "conflict_resolutions": _list_or_none(run_args.get("conflict_resolutions"), "conflict_resolutions"),
        }
        with self._session_maker() as db:
            return self._result_factory(db, normalized)

    @staticmethod
    def _generate_with_existing_agent(db: Session, run_args: dict[str, Any]) -> EntityMergeResult:
        """复用旧 Worker 的纯结果生成，避免复制 LLM/Provider 实现。"""
        return MergeResultGenerator().generate(db, run_args)


class ScriptMergeDeliveryHandler:
    """将合并分析结果写入 Task.result，不自动覆盖任何实体库。"""

    async def deliver_success(self, context: DeliveryContext) -> dict[str, Any]:
        """序列化内存结果；Task 成功状态由通用 Coordinator 条件写入。"""
        result = context.output
        if isinstance(result, EntityMergeResult):
            return result.model_dump(mode="json")
        if isinstance(result, Mapping):
            return dict(result)
        raise TypeError("script merge driver returned an unsupported result")

    async def deliver_failed(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定失败载荷，不触发部分合并写回。"""
        return {"outcome": "failed", "error_code": "script_merge_failed", "error": context.error or "script merge task failed"}

    async def deliver_cancelled(self, context: DeliveryContext) -> dict[str, Any]:
        """返回稳定取消载荷，保证取消无领域副作用。"""
        return {"outcome": "cancelled", "reason": context.error or "任务已取消"}


def _mapping_or_none(value: object, name: str) -> dict[str, Any] | None:
    """校验可选对象输入，禁止执行期将任意标量重新解释为领域数据。"""
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError(f"script merge snapshot.run_args.{name} must be an object")
    return dict(value)


def _list_or_none(value: object, name: str) -> list[Any] | None:
    """校验可选列表输入，保持提交时冻结的结构语义。"""
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError(f"script merge snapshot.run_args.{name} must be a list")
    return value


__all__ = ["ScriptMergeDeliveryHandler", "ScriptMergeTaskExecutionDriver"]
