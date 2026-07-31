"""统一生成工作流处理器的基础契约。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from app.core.contracts.generation import GenerationOperation, GenerationTargetKind
from app.core.contracts.generation_delivery import GenerationDeliveryResult


@dataclass(frozen=True, slots=True)
class GenerationWorkflowKey:
    """唯一标识一种生成 operation 向特定业务 target 的终态工作流。"""

    operation: GenerationOperation
    target_kind: GenerationTargetKind


@dataclass(slots=True)
class GenerationWorkflowSubmissionContext:
    """承载提交期校验所需的最小上下文。

    ``data`` 可由提交器放入命令、快照或已验证目标；基础层不依赖 ORM，确保
    领域 Handler 可以独立定义自己的输入投影。
    """

    data: dict[str, Any]


@dataclass(slots=True)
class GenerationWorkflowExecutionContext:
    """承载 Worker 执行前校验所需的任务标识与运行期上下文。"""

    task_id: str
    data: dict[str, Any]


@dataclass(slots=True)
class GenerationWorkflowTerminalContext:
    """承载成功、失败或取消终态交付所需的任务标识与扩展数据。

    ``data`` 可以装载已归档 Artifact、Provider 结果、错误摘要或展示消息投影；
    具体内容由领域 Handler 定义，避免工作流基础层依赖具体生成模态和 ORM。
    """

    task_id: str
    data: dict[str, Any]


@runtime_checkable
class GenerationWorkflowHandler(Protocol):
    """定义提交、执行和终态交付均可被 Registry 解析的异步工作流协议。"""

    key: GenerationWorkflowKey

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:
        """在持久化任务前校验该工作流提交是否满足领域约束。"""

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:
        """在调用 Provider 前校验冻结任务是否仍可执行。"""

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """交付成功终态，并返回应写入 GenerationTask.result 的稳定投影。"""

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """交付失败终态，例如同步实验室展示消息的错误摘要。"""

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """交付取消终态，例如同步实验室展示消息的取消状态。"""


class AbstractGenerationWorkflowHandler(ABC):
    """为领域工作流提供提交、执行与终态交付的抽象异步实现基类。"""

    key: GenerationWorkflowKey

    @abstractmethod
    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:
        """校验提交期上下文。"""
        raise NotImplementedError

    @abstractmethod
    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:
        """校验执行期上下文。"""
        raise NotImplementedError

    @abstractmethod
    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """交付成功终态并返回任务结果投影。"""
        raise NotImplementedError

    @abstractmethod
    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """交付失败终态。"""
        raise NotImplementedError

    @abstractmethod
    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """交付取消终态。"""
        raise NotImplementedError
