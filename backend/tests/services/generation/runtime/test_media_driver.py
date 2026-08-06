"""MediaTaskExecutionDriver 对既有图片/视频 Worker 的兼容适配测试。"""

from __future__ import annotations

import pytest

from app.core.contracts.execution_attempt import ExecutionAttemptLease
from app.core.contracts.generation import (
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.generation_run import GenerationWorkerCallback, GenerationWorkerCallbackKind
from app.services.execution_attempt_runtime import TaskExecutionCommand
from app.services.generation.runtime.media_driver import MediaDriverOutput, MediaTaskExecutionDriver
from app.services.generation.runtime.workers import GenerationWorkerExecution


@pytest.mark.asyncio
async def test_media_driver_reuses_existing_worker_command_contract() -> None:
    """通用 Driver 必须透传 lease、快照和 provider checkpoint 给既有媒体 Worker。"""
    async def worker(command):  # noqa: ANN001
        assert command.run_id == "attempt-1"
        assert command.provider_idempotency_key == "provider-key"
        return GenerationWorkerExecution(
            callback=GenerationWorkerCallback(
                run_id=command.run_id,
                lease_epoch=command.lease_epoch,
                kind=GenerationWorkerCallbackKind.succeeded,
                provider_task_id="provider-job-1",
            )
        )

    command = TaskExecutionCommand(
        lease=ExecutionAttemptLease(
            attempt_id="attempt-1",
            task_id="task-1",
            lease_epoch=1,
            lease_owner="worker-a",
            lease_ttl_seconds=30,
        ),
        task_kind="image_generation",
        snapshot=ResolvedGenerationSnapshot(
            model_id="model-1",
            canonical_target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id="session-1"),
            operation_input=ImageGenerationOperationInput(),
            execution_prompt="一只水母",
        ).model_dump(mode="json"),
        cancel_requested=False,
        idempotency_key="provider-key",
    )

    execution = await MediaTaskExecutionDriver(worker=worker).execute(command)

    assert execution.callback.attempt_id == "attempt-1"
    assert execution.callback.kind.value == "succeeded"
    assert isinstance(execution.output, MediaDriverOutput)
