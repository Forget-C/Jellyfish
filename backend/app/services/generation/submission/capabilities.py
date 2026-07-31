"""统一生成 operation 与交付协议的显式能力矩阵。"""

from __future__ import annotations

from collections.abc import Mapping

from app.core.contracts.generation import GenerationDelivery, GenerationOperation, GenerationTargetKind


class UnsupportedGenerationDeliveryError(ValueError):
    """请求的 operation 不支持指定交付协议时抛出。"""


class GenerationCapabilityRegistry:
    """在任何持久化副作用前校验 operation × target × delivery 组合。"""

    def __init__(
        self,
        capabilities: Mapping[GenerationOperation, frozenset[GenerationDelivery]] | None = None,
        target_capabilities: Mapping[
            tuple[GenerationOperation, GenerationTargetKind], frozenset[GenerationDelivery]
        ] | None = None,
    ) -> None:
        """初始化旧交付矩阵与按目标收紧的执行矩阵。

        ``capabilities`` 保留给既有调用方和测试；未传 ``target_kind`` 时仍只做
        operation × delivery 校验。新提交链应传入目标，以拒绝无法终态交付的组合。
        """
        self._capabilities = dict(capabilities or _DEFAULT_CAPABILITIES)
        self._target_capabilities = dict(target_capabilities or _DEFAULT_TARGET_CAPABILITIES)

    def supports(
        self,
        *,
        operation: GenerationOperation,
        delivery: GenerationDelivery,
        target_kind: GenerationTargetKind | None = None,
    ) -> bool:
        """返回 operation 在可选可信目标下是否允许指定交付协议。"""
        if delivery not in self._capabilities.get(operation, frozenset()):
            return False
        if target_kind is None:
            return True
        return delivery in self._target_capabilities.get((operation, target_kind), frozenset())

    def require_supported(
        self,
        *,
        operation: GenerationOperation,
        delivery: GenerationDelivery,
        target_kind: GenerationTargetKind | None = None,
    ) -> None:
        """拒绝未声明组合，并兼容既有仅校验交付方式的调用。"""
        if delivery not in self._capabilities.get(operation, frozenset()):
            raise UnsupportedGenerationDeliveryError(
                f"delivery_unsupported: {operation.value} does not support {delivery.value}"
            )
        if target_kind is not None and not self.supports(
            operation=operation,
            delivery=delivery,
            target_kind=target_kind,
        ):
            raise UnsupportedGenerationDeliveryError(
                f"target_unsupported: {operation.value} does not support {target_kind.value}"
            )


_DEFAULT_CAPABILITIES: Mapping[GenerationOperation, frozenset[GenerationDelivery]] = {
    GenerationOperation.text_chat: frozenset({
        GenerationDelivery.inline,
        GenerationDelivery.streaming,
        GenerationDelivery.async_polling,
    }),
    GenerationOperation.text_agent: frozenset({GenerationDelivery.async_polling}),
    GenerationOperation.image_generation: frozenset({GenerationDelivery.async_polling}),
    GenerationOperation.video_generation: frozenset({GenerationDelivery.async_polling}),
}


_DEFAULT_TARGET_CAPABILITIES: Mapping[
    tuple[GenerationOperation, GenerationTargetKind], frozenset[GenerationDelivery]
] = {
    (GenerationOperation.text_chat, GenerationTargetKind.experiment_session): frozenset({
        GenerationDelivery.inline,
        GenerationDelivery.streaming,
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.text_agent, GenerationTargetKind.script_processing): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.text_agent, GenerationTargetKind.shot_detail): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.image_generation, GenerationTargetKind.experiment_session): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.image_generation, GenerationTargetKind.asset_image_slot): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.image_generation, GenerationTargetKind.shot_frame_slot): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.video_generation, GenerationTargetKind.experiment_session): frozenset({
        GenerationDelivery.async_polling,
    }),
    (GenerationOperation.video_generation, GenerationTargetKind.shot_video): frozenset({
        GenerationDelivery.async_polling,
    }),
}


generation_capability_registry = GenerationCapabilityRegistry()
