"""GenerationWorkflowRegistry 的场景矩阵与 Handler 解析测试。"""

from __future__ import annotations

import pytest

from app.core.contracts.generation import GenerationOperation, GenerationTargetKind
from app.services.generation.workflows import (
    DEFAULT_WORKFLOW_KEYS,
    GenerationWorkflowExecutionContext,
    GenerationWorkflowHandlerNotRegisteredError,
    GenerationWorkflowKey,
    GenerationWorkflowRegistry,
    GenerationWorkflowSubmissionContext,
    GenerationWorkflowTerminalContext,
    UnsupportedGenerationWorkflowError,
)


class _ImageSessionHandler:
    """为 Registry 测试提供最小的实验室图片异步 Handler。"""

    key = GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.experiment_session)

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:
        """记录提交上下文，证明测试替身满足提交期协议。"""

        context.data["submission_validated"] = True

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:
        """记录执行上下文，证明测试替身满足执行期协议。"""

        context.data["execution_validated"] = True

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> dict[str, str]:
        """回显任务 ID，证明测试替身满足成功终态协议。"""

        return {"task_id": context.task_id}

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """记录失败终态，证明测试替身满足失败交付协议。"""

        context.data["failed_delivered"] = True

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """记录取消终态，证明测试替身满足取消交付协议。"""

        context.data["cancelled_delivered"] = True


def test_default_matrix_declares_initial_image_and_video_workflows() -> None:
    """默认矩阵应先声明实验室与槽位的初始迁移场景，但不预装领域实现。"""

    registry = GenerationWorkflowRegistry()

    assert GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.experiment_session) in DEFAULT_WORKFLOW_KEYS
    assert registry.supports(operation=GenerationOperation.video_generation, target_kind=GenerationTargetKind.experiment_session)
    assert registry.supports(operation=GenerationOperation.video_generation, target_kind=GenerationTargetKind.shot_video)


def test_resolve_raises_explicit_error_when_supported_handler_is_not_registered() -> None:
    """允许场景未接入 Handler 时必须报明确错误，不能静默回退到错误 Publisher。"""

    registry = GenerationWorkflowRegistry()

    with pytest.raises(GenerationWorkflowHandlerNotRegisteredError, match="workflow_handler_not_registered"):
        registry.resolve(operation=GenerationOperation.image_generation, target_kind=GenerationTargetKind.experiment_session)


@pytest.mark.asyncio
async def test_registry_registers_and_resolves_handler_by_operation_and_target() -> None:
    """注册后应解析完整生命周期协议，并按键精确返回同一个 Handler 实例。"""

    registry = GenerationWorkflowRegistry()
    handler = _ImageSessionHandler()

    registry.register(handler)

    resolved = registry.resolve(operation=GenerationOperation.image_generation, target_kind=GenerationTargetKind.experiment_session)

    assert resolved is handler
    submission = GenerationWorkflowSubmissionContext(data={})
    execution = GenerationWorkflowExecutionContext(task_id="task-1", data={})
    terminal = GenerationWorkflowTerminalContext(task_id="task-1", data={})
    await resolved.validate_submission(submission)
    await resolved.validate_execution(execution)
    assert await resolved.deliver_success(terminal) == {"task_id": "task-1"}
    await resolved.deliver_failed(terminal)
    await resolved.deliver_cancelled(terminal)
    assert submission.data["submission_validated"] is True
    assert execution.data["execution_validated"] is True
    assert terminal.data["failed_delivered"] is True
    assert terminal.data["cancelled_delivered"] is True


def test_registry_rejects_workflow_outside_declared_matrix() -> None:
    """未声明的 operation/target 组合必须与未注册场景区分开来。"""

    registry = GenerationWorkflowRegistry()

    with pytest.raises(UnsupportedGenerationWorkflowError, match="workflow_unsupported"):
        registry.resolve(operation=GenerationOperation.video_generation, target_kind=GenerationTargetKind.asset_image_slot)
