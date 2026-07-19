"""供应商模型目录发现测试。"""

from __future__ import annotations

import httpx
import pytest

from app.core.contracts.provider import ProviderConfig
from app.core.integrations.model_catalog import discover_provider_models


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """让目录发现 adapter 的 AsyncClient 使用 MockTransport。"""
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        return real_client(transport=transport, timeout=kwargs.get("timeout", 15.0))  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_openai_compatible_catalog_reads_models_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenAI 兼容供应商应在后端使用 Bearer 密钥读取 `/models`。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/models")
        assert request.headers.get("authorization") == "Bearer secret"
        return httpx.Response(200, json={"data": [{"id": "gpt-4o-mini"}, {"id": "gpt-image-1"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await discover_provider_models(
        cfg=ProviderConfig(provider="openai", api_key="secret", base_url="https://api.example/v1")
    )
    assert result.source == "provider_api"
    assert [(item.name, item.category.value) for item in result.models] == [
        ("gpt-4o-mini", "text"),
        ("gpt-image-1", "image"),
    ]


@pytest.mark.asyncio
async def test_vidu_catalog_uses_official_model_map_without_network() -> None:
    """Vidu 尚未提供模型列表 API 时，刷新应返回内置的官方模型目录。"""
    result = await discover_provider_models(cfg=ProviderConfig(provider="vidu", api_key="secret"))
    assert result.source == "provider_catalog"
    assert ("viduq2", "image") in {(item.name, item.category.value) for item in result.models}
    assert ("viduq3-turbo", "video") in {(item.name, item.category.value) for item in result.models}
