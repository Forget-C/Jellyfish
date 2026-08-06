"""将既有图片/视频 Worker 适配到通用 TaskExecutionDriver。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.core.contracts.execution_attempt import ExecutionAttemptCallback, ExecutionAttemptCallbackKind
from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.generation_run import GenerationWorkerCommand
from app.services.execution_attempt_runtime import DriverExecution, TaskExecutionCommand
from app.services.generation.runtime.workers import GenerationWorkerExecution, execute_worker_command


_OPERATION_BY_TASK_KIND = {
    "image_generation": GenerationOperation.image_generation,
    "video_generation": GenerationOperation.video_generation,
}


@dataclass(frozen=True, slots=True)
class MediaDriverOutput:
    """媒体 Driver 的内存输出，仍交由现有媒体 Coordinator 归档与交付。"""

    worker_execution: GenerationWorkerExecution


class MediaTaskExecutionDriver:
    """复用图片/视频生成基类与 Worker，不复制 Provider 标准能力。"""

    task_kinds = frozenset(_OPERATION_BY_TASK_KIND)

    def __init__(
        self,
        *,
        worker: Callable[[GenerationWorkerCommand], Awaitable[GenerationWorkerExecution]] = execute_worker_command,
    ) -> None:
        """注入既有媒体 Worker，便于在不改 Provider adapter 的前提下测试适配。"""
        self._worker = worker

    async def execute(self, command: TaskExecutionCommand) -> DriverExecution:
        """把通用 Attempt 命令转换为既有媒体命令并映射 callback。"""
        operation = _OPERATION_BY_TASK_KIND.get(command.task_kind)
        if operation is None:
            raise ValueError(f"unsupported media task kind: {command.task_kind}")
        snapshot = ResolvedGenerationSnapshot.model_validate(dict(command.snapshot))
        worker_execution = await self._worker(
            GenerationWorkerCommand(
                run_id=command.lease.attempt_id,
                task_id=command.lease.task_id,
                lease_epoch=command.lease.lease_epoch,
                lease_owner=command.lease.lease_owner,
                lease_ttl_seconds=command.lease.lease_ttl_seconds,
                provider_idempotency_key=command.idempotency_key,
                operation=operation,
                snapshot=snapshot,
                cancel_requested=command.cancel_requested,
            )
        )
        callback = worker_execution.callback
        return DriverExecution(
            callback=ExecutionAttemptCallback(
                attempt_id=callback.run_id,
                lease_epoch=callback.lease_epoch,
                kind=ExecutionAttemptCallbackKind(callback.kind.value),
                error_code=callback.error_code,
                error=callback.error,
            ),
            output=MediaDriverOutput(worker_execution=worker_execution),
        )
__all__ = ["MediaDriverOutput", "MediaTaskExecutionDriver"]
