"""为模型目录操作选择适配器并绑定供应商配置。"""

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

import httpx

from app.core.contracts.model_catalog import ProviderModelCatalog
from app.core.contracts.model_provider import (
    ModelProvider,
    ModelProviderConfig,
    ModelProviderConfigurationError,
    TextModelProvider,
)
from app.core.integrations.model_catalog import (
    KLING_MODELS,
    VIDU_MODELS,
    BuiltinModelCatalog,
    OpenAICompatibleModelCatalog,
)
from app.core.integrations.openai.chat import OpenAICompatibleChat
from app.core.integrations.openai.responses import OpenAIResponses

_TEXT_ADAPTERS = {"openai": OpenAICompatibleChat, "aliyun_bailian": OpenAICompatibleChat}
_REMOTE_CATALOGS = {
    "openai": OpenAICompatibleModelCatalog,
    "volcengine": OpenAICompatibleModelCatalog,
    "aliyun_bailian": OpenAICompatibleModelCatalog,
}
_BUILTIN_CATALOGS = {"vidu": VIDU_MODELS, "kling": KLING_MODELS}


def has_remote_model_catalog(provider: str) -> bool:
    """返回操作注册表是否提供实时模型目录。"""
    return provider in _REMOTE_CATALOGS


def bind_text_provider(
    config: ModelProviderConfig,
    model: str,
    params: dict[str, Any],
    *,
    client_factory: Callable[[], AbstractAsyncContextManager[httpx.AsyncClient]],
) -> TextModelProvider:
    """为配置和模型解析当前支持的文本操作。"""
    adapter = _TEXT_ADAPTERS.get(config.provider)
    if adapter is None:
        raise ModelProviderConfigurationError(f"Unsupported provider chat: {config.provider!r}")
    if params.get("use_responses_api"):
        adapter = OpenAIResponses
    return adapter(config, model, params, client_factory)


async def list_provider_models(
    config: ModelProviderConfig,
    *,
    client_factory: Callable[[], httpx.AsyncClient],
) -> ProviderModelCatalog:
    """绑定目录适配器，并为实时查询管理 HTTP 客户端生命周期。"""
    if models := _BUILTIN_CATALOGS.get(config.provider):
        return await BuiltinModelCatalog(config.provider, models).list_models()
    if adapter := _REMOTE_CATALOGS.get(config.provider):
        async with client_factory() as client:
            provider: ModelProvider = adapter(config, client)
            return await provider.list_models()
    raise ModelProviderConfigurationError(f"Unsupported provider catalog: {config.provider!r}")
