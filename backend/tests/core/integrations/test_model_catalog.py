"""供应商模型目录发现测试。"""

from __future__ import annotations

import httpx
import pytest

from app.core.contracts.model_provider import ModelProviderConfig
from app.core.integrations.model_provider_registry import list_provider_models


def _unexpected_http_client() -> httpx.AsyncClient:
    pytest.fail("The built-in catalog must not open an HTTP client")


@pytest.mark.asyncio
async def test_openai_compatible_catalog_reads_models_endpoint() -> None:
    """OpenAI 兼容供应商应在后端使用 Bearer 密钥读取 `/models`。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/models")
        assert request.headers.get("authorization") == "Bearer secret"
        return httpx.Response(200, json={"data": [{"id": "gpt-4o-mini"}, {"id": "gpt-image-1"}]})

    result = await list_provider_models(
        ModelProviderConfig(provider="openai", api_key="secret", base_url="https://api.example/v1"),
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    assert result.source == "provider_api"
    assert [(item.name, item.category.value) for item in result.models] == [
        ("gpt-4o-mini", "text"),
        ("gpt-image-1", "image"),
    ]


@pytest.mark.asyncio
async def test_vidu_catalog_uses_official_model_map_without_network() -> None:
    """Vidu 尚未提供模型列表 API 时，刷新应返回内置的官方模型目录。"""
    result = await list_provider_models(
        ModelProviderConfig(provider="vidu", api_key="secret"),
        client_factory=_unexpected_http_client,
    )
    assert result.source == "provider_catalog"
    assert ("viduq2", "image") in {(item.name, item.category.value) for item in result.models}
    assert ("viduq3-turbo", "video") in {(item.name, item.category.value) for item in result.models}


@pytest.mark.asyncio
async def test_kling_catalog_uses_static_model_map_without_network() -> None:
    """可灵仅暴露项目确认的静态模型目录，刷新时不请求 `/models`。"""
    result = await list_provider_models(
        ModelProviderConfig(provider="kling", api_key="secret"),
        client_factory=_unexpected_http_client,
    )
    assert result.source == "provider_catalog"
    assert {(item.name, item.category.value) for item in result.models} == {
        ("kling-3.0-turbo", "video"),
        ("kling-3.0", "video"),
        ("kling-v3", "image"),
    }
