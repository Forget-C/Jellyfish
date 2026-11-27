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
    assert result.models[0].capability_profile.native_streaming is True
    assert result.models[0].capability_profile.tool_results is True
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


@pytest.mark.asyncio
async def test_catalog_preserves_explicit_provider_values_and_fills_gaps():
    async def handler(request):
        return httpx.Response(200, json={"data": [{"id": "custom-chat", "input_modalities": ["text", "image"],
            "max_output_tokens": 4096, "context_window": 8192, "features": {"tools": {"function_calling": False}}}]})
    catalog = await list_provider_models(
        ModelProviderConfig(provider="openai", api_key="test", base_url="https://gateway.test/v1"),
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    profile = catalog.models[0].capability_profile
    assert profile.image_inputs and profile.native_streaming
    assert not profile.tool_calling and not profile.video_inputs
    assert (profile.context_window, profile.max_output_tokens) == (8192, 4096)


@pytest.mark.asyncio
async def test_bailian_native_catalog_follows_pages_and_reads_features():
    async def handler(request):
        page = int(request.url.params["page_no"])
        assert request.url.path == "/api/v1/models"
        return httpx.Response(200, json={"output": {"total": 2, "models": [{
            "model": f"chat-{page}", "features": ["function-calling"] if page == 1 else [],
            "inference_metadata": {"request_modality": ["Text"], "response_modality": ["Text"]},
            "model_info": {"max_input_tokens": 1024}}]}})
    catalog = await list_provider_models(
        ModelProviderConfig(provider="aliyun_bailian", api_key="test",
                            base_url="https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
        client_factory=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert [row.capability_profile.tool_calling for row in catalog.models] == [True, False]
    assert catalog.models[1].capability_profile.max_input_tokens == 1024
