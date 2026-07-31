"""TaskFinalizer 的终态编排专项覆盖。"""

from __future__ import annotations

import pytest

from app.core.contracts.generation import (
    GenerationOperation,
    GenerationTarget,
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.task_manager.stores import InMemoryTaskStore
from app.core.task_manager.types import DeliveryMode, TaskStatus
from app.core.contracts.generation_delivery import GenerationDeliveryResult, GenerationOutcome
from app.services.generation.runtime.finalizer import TaskFinalizer
from app.services.generation.workflows.base import (
    GenerationWorkflowExecutionContext,
    GenerationWorkflowKey,
    GenerationWorkflowSubmissionContext,
    GenerationWorkflowTerminalContext,
)
from app.services.generation.workflows.registry import GenerationWorkflowRegistry


class RecordingHandler:
    """记录终态上下文的最小 WorkflowHandler 测试替身。"""

    key = GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.experiment_session)

    def __init__(self) -> None:
        """初始化各终态调用记录。"""
        self.calls: list[tuple[str, GenerationWorkflowTerminalContext]] = []

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:  # noqa: ARG002
        """Finalizer 测试不覆盖提交校验。"""

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:  # noqa: ARG002
        """Finalizer 测试不覆盖执行前校验。"""

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """返回稳定结果投影供 TaskStore 持久化。"""
        self.calls.append(("success", context))
        return GenerationDeliveryResult(outcome=GenerationOutcome.succeeded)

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """记录失败交付请求。"""
        self.calls.append(("failed", context))

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """记录取消交付请求。"""
        self.calls.append(("cancelled", context))


class _ActiveTaskResult:
    """模拟行锁查询结果，供 Finalizer 成功路径验证活动任务。"""

    def scalars(self) -> "_ActiveTaskResult":
        """保持 SQLAlchemy 标量查询的最小链式接口。"""
        return self

    def first(self):  # noqa: ANN201
        """返回仍在运行且未取消的最小任务行。"""
        return type("Task", (), {"status": TaskStatus.running, "cancel_requested": False})()


class _ActiveTaskDb:
    """提供成功终态行锁检查所需的最小异步数据库替身。"""

    async def execute(self, _statement: object) -> _ActiveTaskResult:
        """返回可成功领取的运行任务。"""
        return _ActiveTaskResult()


class RaisingHandler(RecordingHandler):
    """模拟领域展示投影不可用的 WorkflowHandler。"""

    def __init__(self, *, terminal: str) -> None:
        """指定需要在何种终态交付阶段抛出异常。"""
        super().__init__()
        self._terminal = terminal

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """在成功投影阶段按需模拟持久化失败。"""
        self.calls.append(("success", context))
        if self._terminal == "success":
            raise RuntimeError("message_projection_unavailable")
        return GenerationDeliveryResult(outcome=GenerationOutcome.succeeded)

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """在失败投影阶段按需模拟持久化失败。"""
        self.calls.append(("failed", context))
        if self._terminal == "failed":
            raise RuntimeError("message_projection_unavailable")

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """在取消投影阶段按需模拟持久化失败。"""
        self.calls.append(("cancelled", context))
        if self._terminal == "cancelled":
            raise RuntimeError("message_projection_unavailable")


def _snapshot() -> ResolvedGenerationSnapshot:
    """构造实验室图片任务的最小可信执行快照。"""
    return ResolvedGenerationSnapshot(
        model_id="model-1",
        canonical_target=GenerationTarget(kind=GenerationTargetKind.experiment_session, entity_id="session-1"),
        operation_input=ImageGenerationOperationInput(),
        execution_prompt="一只水母",
    )


async def _store() -> tuple[InMemoryTaskStore, str]:
    """创建可观察终态字段的内存任务记录。"""
    store = InMemoryTaskStore()
    task = await store.create(payload={}, mode=DeliveryMode.async_polling, task_kind="image_generation")
    await store.set_status(task.id, TaskStatus.running)
    return store, task.id


def _finalizer(handler: RecordingHandler) -> TaskFinalizer:
    """用单一受控工作流注册表构造 Finalizer。"""
    registry = GenerationWorkflowRegistry(supported_keys=[handler.key])
    registry.register(handler)  # type: ignore[arg-type]
    return TaskFinalizer(workflow_registry=registry)


@pytest.mark.asyncio
async def test_finalize_success_writes_result_progress_and_status_without_commit() -> None:
    """成功终态由 Handler 生成结果，并完整写入 TaskStore。"""
    handler = RecordingHandler()
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    result = await finalizer.finalize_success(
        db=_ActiveTaskDb(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        artifacts=[],
    )

    task = await store.get(task_id)
    assert result.outcome is GenerationOutcome.succeeded
    assert task is not None and task.result == result.model_dump(mode="json")
    assert task.progress == 100
    assert task.status is TaskStatus.succeeded
    assert handler.calls[0][0] == "success"


@pytest.mark.asyncio
async def test_finalize_failure_calls_handler_and_marks_task_failed() -> None:
    """失败终态同时保留任务错误与领域投影机会。"""
    handler = RecordingHandler()
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    await finalizer.finalize_failure(
        db=_ActiveTaskDb(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        error="provider_failed",
    )

    task = await store.get(task_id)
    assert task is not None and task.status is TaskStatus.failed and task.error == "provider_failed"
    assert handler.calls[0][0] == "failed"
    assert handler.calls[0][1].data["error"] == "provider_failed"


@pytest.mark.asyncio
async def test_finalize_cancelled_calls_handler_and_marks_task_cancelled() -> None:
    """取消终态保留原因并使用 TaskStore 的标准取消转换。"""
    handler = RecordingHandler()
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    await finalizer.finalize_cancelled(
        db=_ActiveTaskDb(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        reason="cancel_requested",
    )

    task = await store.get(task_id)
    assert task is not None and task.status is TaskStatus.cancelled and task.error == "cancel_requested"
    assert handler.calls[0][0] == "cancelled"


@pytest.mark.asyncio
async def test_finalize_failure_prefers_cancel_requested_terminal_state() -> None:
    """Provider 失败与用户取消竞争时，取消必须胜出且不得被失败覆盖。"""

    handler = RecordingHandler()
    finalizer = _finalizer(handler)
    store, task_id = await _store()
    await store.request_cancel(task_id, "用户取消")

    await finalizer.finalize_failure(
        db=object(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        error="provider_failed",
    )

    task = await store.get(task_id)
    assert task is not None and task.status is TaskStatus.cancelled
    assert handler.calls[0][0] == "cancelled"


@pytest.mark.asyncio
async def test_finalize_success_degrades_to_failed_when_delivery_raises() -> None:
    """成功展示投影失败不能让任务遗留在运行态。"""
    handler = RaisingHandler(terminal="success")
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    result = await finalizer.finalize_success(
        db=_ActiveTaskDb(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        artifacts=[],
    )

    task = await store.get(task_id)
    assert result.error_code == "terminal_delivery_failed"
    assert task is not None and task.status is TaskStatus.failed
    assert task.error is not None and "message_projection_unavailable" in task.error
    assert handler.calls[0][0] == "success"


@pytest.mark.asyncio
async def test_finalize_failure_marks_task_failed_when_delivery_raises() -> None:
    """失败展示投影失败时，原始 Provider 错误仍必须写入任务。"""
    handler = RaisingHandler(terminal="failed")
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    await finalizer.finalize_failure(
        db=object(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        error="provider_failed",
    )

    task = await store.get(task_id)
    assert task is not None and task.status is TaskStatus.failed
    assert task.error is not None and "provider_failed" in task.error
    assert "message_projection_unavailable" in task.error
    assert handler.calls[0][0] == "failed"


@pytest.mark.asyncio
async def test_finalize_cancelled_marks_task_cancelled_when_delivery_raises() -> None:
    """取消展示投影失败时，任务仍必须转换为标准取消状态。"""
    handler = RaisingHandler(terminal="cancelled")
    finalizer = _finalizer(handler)
    store, task_id = await _store()

    await finalizer.finalize_cancelled(
        db=object(),  # type: ignore[arg-type]
        store=store,
        task_id=task_id,
        operation=GenerationOperation.image_generation,
        snapshot=_snapshot(),
        reason="cancel_requested",
    )

    task = await store.get(task_id)
    assert task is not None and task.status is TaskStatus.cancelled
    assert task.error is not None and "cancel_requested" in task.error
    assert "message_projection_unavailable" in task.error
    assert handler.calls[0][0] == "cancelled"
