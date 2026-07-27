"""统一生成 operation 与交付协议的显式能力矩阵。"""

from __future__ import annotations

from collections.abc import Mapping

from app.core.contracts.generation import GenerationDelivery, GenerationOperation


class UnsupportedGenerationDeliveryError(ValueError):
    """请求的 operation 不支持指定交付协议时抛出。"""


class GenerationCapabilityRegistry:
    """在任何持久化副作用前校验 operation × delivery 的固定组合。"""

    def __init__(
        self,
        capabilities: Mapping[GenerationOperation, frozenset[GenerationDelivery]] | None = None,
    ) -> None:
        """使用可替换矩阵初始化注册表，便于在单元测试中覆盖能力边界。"""
        self._capabilities = dict(capabilities or _DEFAULT_CAPABILITIES)

    def supports(self, *, operation: GenerationOperation, delivery: GenerationDelivery) -> bool:
        """返回固定 operation 是否允许目标 delivery。"""
        return delivery in self._capabilities.get(operation, frozenset())

    def require_supported(self, *, operation: GenerationOperation, delivery: GenerationDelivery) -> None:
        """拒绝未声明的交付组合，避免后续创建无法执行的任务。"""
        if not self.supports(operation=operation, delivery=delivery):
            raise UnsupportedGenerationDeliveryError(
                f"delivery_unsupported: {operation.value} does not support {delivery.value}"
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


generation_capability_registry = GenerationCapabilityRegistry()
