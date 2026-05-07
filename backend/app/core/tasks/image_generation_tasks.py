"""图片生成任务（Task）：对接 OpenAI Images API 与火山引擎（方舟） ImageGenerations。

供应商 HTTP 实现在 `app.core.integrations`；本模块保留 BaseTask 编排与 registry 分派。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from app.core.integrations.aliyun.dashscope_images import DashScopeImageApiAdapter
from app.core.integrations.openai.images import OpenAIImageApiAdapter
from app.core.integrations.volcengine.images import VolcengineImageApiAdapter
from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
    InputImageRef,
    ResponseFormat,
)
from app.core.contracts.provider import ProviderConfig
from app.core.tasks.registry import resolve_task_adapter
from app.core.task_manager.types import BaseTask

# 兼容：自本模块 re-export 类型，避免破坏 from app.core.tasks.image_generation_tasks import ...
__all__ = [
    "ImageGenerationInput",
    "ImageGenerationResult",
    "ImageItem",
    "InputImageRef",
    "ResponseFormat",
    "AbstractImageGenerationTask",
    "OpenAIImageGenerationTask",
    "VolcengineImageGenerationTask",
    "DashScopeImageGenerationTask",
    "ImageGenerationTask",
]


class AbstractImageGenerationTask(BaseTask, ABC):
    """图片生成抽象基类：子类实现 `_create_task` + `_poll_and_get_result`。"""

    def __init__(
        self,
        *,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> None:
        self._cfg = provider_config
        self._input = input_
        self._timeout_s = timeout_s
        self._provider_task_id: str | None = None
        self._result: ImageGenerationResult | None = None
        self._error: str = ""

    @abstractmethod
    async def _create_task(self) -> None:
        """发起供应商请求（或委托 adapter）。"""

    @abstractmethod
    async def _poll_and_get_result(self) -> ImageGenerationResult:
        """解析为统一结果。"""

    async def run(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any] | None:  # type: ignore[override]
        try:
            await self._create_task()
            self._result = await self._poll_and_get_result()
            if self._result is not None:
                self._provider_task_id = self._result.provider_task_id
        except Exception as exc:  # noqa: BLE001
            self._error = str(exc)
            self._result = None
        return None

    async def status(self) -> dict[str, Any]:  # type: ignore[override]
        return {
            "task": "image_generation",
            "provider": self._cfg.provider,
            "provider_task_id": self._provider_task_id,
            "done": await self.is_done(),
            "has_result": self._result is not None,
            "error": self._error,
            "status": self._result.status if self._result else None,
        }

    async def is_done(self) -> bool:  # type: ignore[override]
        return self._result is not None or bool(self._error)

    async def get_result(self) -> ImageGenerationResult | None:  # type: ignore[override]
        return self._result


class OpenAIImageGenerationTask(AbstractImageGenerationTask):
    """OpenAI Images：委托 `OpenAIImageApiAdapter`。"""

    def __init__(
        self,
        *,
        adapter: OpenAIImageApiAdapter | None = None,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> None:
        super().__init__(provider_config=provider_config, input_=input_, timeout_s=timeout_s)
        self._adapter = adapter or OpenAIImageApiAdapter()
        self._deferred: ImageGenerationResult | None = None

    async def _create_task(self) -> None:
        self._deferred = await self._adapter.generate(
            cfg=self._cfg,
            inp=self._input,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> ImageGenerationResult:
        assert self._deferred is not None
        return self._deferred


class VolcengineImageGenerationTask(AbstractImageGenerationTask):
    """火山 ImageGenerations：委托 `VolcengineImageApiAdapter`。"""

    def __init__(
        self,
        *,
        adapter: VolcengineImageApiAdapter | None = None,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> None:
        super().__init__(provider_config=provider_config, input_=input_, timeout_s=timeout_s)
        self._adapter = adapter or VolcengineImageApiAdapter()
        self._deferred: ImageGenerationResult | None = None

    async def _create_task(self) -> None:
        self._deferred = await self._adapter.generate(
            cfg=self._cfg,
            inp=self._input,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> ImageGenerationResult:
        assert self._deferred is not None
        return self._deferred


class DashScopeImageGenerationTask(AbstractImageGenerationTask):
    """阿里云百炼 DashScope 原生文生图：委托 `DashScopeImageApiAdapter`。"""

    def __init__(
        self,
        *,
        adapter: DashScopeImageApiAdapter | None = None,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 180.0,
    ) -> None:
        super().__init__(provider_config=provider_config, input_=input_, timeout_s=timeout_s)
        self._adapter = adapter or DashScopeImageApiAdapter()
        self._deferred: ImageGenerationResult | None = None

    async def _create_task(self) -> None:
        self._deferred = await self._adapter.generate(
            cfg=self._cfg,
            inp=self._input,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> ImageGenerationResult:
        assert self._deferred is not None
        return self._deferred


class ImageGenerationTask(BaseTask):
    """按 provider 分派到 OpenAI / 火山实现；对外构造函数与原先一致。"""

    def __init__(
        self,
        *,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> None:
        from app.bootstrap import bootstrap_all_registries

        bootstrap_all_registries()
        factory = resolve_task_adapter("image_generation", provider_config.provider)
        self._impl: AbstractImageGenerationTask = factory(
            provider_config=provider_config,
            input_=input_,
            timeout_s=timeout_s,
        )  # type: ignore[assignment]

    @staticmethod
    def _build_openai_impl(
        *,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> AbstractImageGenerationTask:
        return OpenAIImageGenerationTask(
            provider_config=provider_config,
            input_=input_,
            timeout_s=timeout_s,
        )

    @staticmethod
    def _build_volcengine_impl(
        *,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 60.0,
    ) -> AbstractImageGenerationTask:
        return VolcengineImageGenerationTask(
            provider_config=provider_config,
            input_=input_,
            timeout_s=timeout_s,
        )

    @staticmethod
    def _build_aliyun_bailian_impl(
        *,
        provider_config: ProviderConfig,
        input_: ImageGenerationInput,
        timeout_s: float = 180.0,
    ) -> AbstractImageGenerationTask:
        # 外部默认 60s 对 wanx 异步轮询过短，保证下限。
        effective = max(float(timeout_s), 180.0)
        return DashScopeImageGenerationTask(
            provider_config=provider_config,
            input_=input_,
            timeout_s=effective,
        )

    async def run(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any] | None:  # type: ignore[override]
        return await self._impl.run(*args, **kwargs)

    async def status(self) -> dict[str, Any]:  # type: ignore[override]
        return await self._impl.status()

    async def is_done(self) -> bool:  # type: ignore[override]
        return await self._impl.is_done()

    async def get_result(self) -> ImageGenerationResult | None:  # type: ignore[override]
        return await self._impl.get_result()
