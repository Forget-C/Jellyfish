"""统一生成工作流 Handler 的场景矩阵与注册表。"""

from __future__ import annotations

from collections.abc import Iterable

from app.core.contracts.generation import GenerationOperation, GenerationTargetKind
from app.services.generation.workflows.base import GenerationWorkflowHandler, GenerationWorkflowKey


class UnsupportedGenerationWorkflowError(ValueError):
    """请求的 operation 与 target 组合不在受支持工作流矩阵时抛出。"""


class GenerationWorkflowHandlerNotRegisteredError(LookupError):
    """组合已声明但尚未注册领域 Handler 时抛出，防止 Worker 静默猜测回退逻辑。"""


DEFAULT_WORKFLOW_KEYS = frozenset(
    {
        GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.experiment_session),
        GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.asset_image_slot),
        GenerationWorkflowKey(GenerationOperation.image_generation, GenerationTargetKind.shot_frame_slot),
        GenerationWorkflowKey(GenerationOperation.video_generation, GenerationTargetKind.experiment_session),
        GenerationWorkflowKey(GenerationOperation.video_generation, GenerationTargetKind.shot_video),
        GenerationWorkflowKey(GenerationOperation.text_chat, GenerationTargetKind.experiment_session),
        GenerationWorkflowKey(GenerationOperation.text_agent, GenerationTargetKind.script_processing),
        GenerationWorkflowKey(GenerationOperation.text_agent, GenerationTargetKind.shot_detail),
    }
)
"""阶段 A 固化的初始场景矩阵；领域 Handler 在后续阶段逐项接入。"""


class GenerationWorkflowRegistry:
    """按 operation 与 target kind 解析唯一 Handler，隔离 Worker 的领域分支。"""

    def __init__(self, *, supported_keys: Iterable[GenerationWorkflowKey] = DEFAULT_WORKFLOW_KEYS) -> None:
        """初始化允许矩阵；允许测试传入最小矩阵验证边界。"""

        self._supported_keys = frozenset(supported_keys)
        self._handlers: dict[GenerationWorkflowKey, GenerationWorkflowHandler] = {}

    def supports(self, *, operation: GenerationOperation, target_kind: GenerationTargetKind) -> bool:
        """判断 operation 与 target 是否属于当前允许的工作流场景。"""

        return GenerationWorkflowKey(operation=operation, target_kind=target_kind) in self._supported_keys

    def register(self, handler: GenerationWorkflowHandler) -> None:
        """注册一个已声明 key 的领域 Handler，拒绝不在矩阵内的实现。"""

        key = handler.key
        if key not in self._supported_keys:
            raise UnsupportedGenerationWorkflowError(_unsupported_message(key))
        self._handlers[key] = handler

    def resolve(
        self,
        *,
        operation: GenerationOperation,
        target_kind: GenerationTargetKind,
    ) -> GenerationWorkflowHandler:
        """解析组合对应的 Handler，并区分不支持与尚未实现两类配置错误。"""

        key = GenerationWorkflowKey(operation=operation, target_kind=target_kind)
        if key not in self._supported_keys:
            raise UnsupportedGenerationWorkflowError(_unsupported_message(key))
        try:
            return self._handlers[key]
        except KeyError as error:
            raise GenerationWorkflowHandlerNotRegisteredError(_unregistered_message(key)) from error


def _unsupported_message(key: GenerationWorkflowKey) -> str:
    """构造稳定的不支持组合错误信息，便于 API 与日志统一分类。"""

    return f"workflow_unsupported: {key.operation.value} -> {key.target_kind.value}"


def _unregistered_message(key: GenerationWorkflowKey) -> str:
    """构造稳定的未注册错误信息，提示调用方不能回落到隐式默认行为。"""

    return f"workflow_handler_not_registered: {key.operation.value} -> {key.target_kind.value}"
