"""图片 integrations：httpx MockTransport 单测（不发起真实网络请求）。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.integrations.openai.images import OpenAIImageApiAdapter
from app.core.tasks.image_generation_tasks import OpenAIImageGenerationTask
from app.core.integrations.volcengine.images import VolcengineImageApiAdapter
from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.image_capabilities import (
    ImageModelCapability,
    clear_image_model_capability_overrides,
    register_image_model_capability,
)


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """让各 adapter 内 `import httpx` 后使用的 AsyncClient 走 MockTransport。"""

    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        timeout = kwargs.get("timeout", 60.0)
        return real_client(transport=transport, timeout=timeout)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_openai_image_adapter_generations(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.content.decode()
        assert request.headers.get("authorization", "").startswith("Bearer ")
        return httpx.Response(
            200,
            json={"data": [{"url": "https://cdn.example.com/1.png"}], "status": "succeeded"},
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="openai", api_key="sk-test", base_url="https://api.openai.com/v1")
    inp = ImageGenerationInput(prompt="hello", n=1, watermark=False)
    result = await OpenAIImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)
    assert captured["path"].endswith("/images/generations")
    body = json.loads(captured["body"])
    assert body["prompt"] == "hello"
    assert body["watermark"] is False
    assert result.provider == "openai"
    assert result.images[0].url == "https://cdn.example.com/1.png"


@pytest.mark.asyncio
async def test_openai_image_adapter_edits_when_references(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        assert request.url.path.endswith("/images/edits")
        return httpx.Response(200, json={"data": [{"b64_json": "abc"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="openai", api_key="sk-test")
    inp = ImageGenerationInput(
        prompt="edit me",
        n=1,
        watermark=True,
        images=[InputImageRef(image_url="https://example.com/ref.png")],
    )
    result = await OpenAIImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)
    body = json.loads(captured["body"])
    assert body["watermark"] is True
    assert result.images[0].b64_json == "abc"


@pytest.mark.asyncio
async def test_openai_image_adapter_resolves_video_reference_size(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/ref.png"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    clear_image_model_capability_overrides(provider="openai")
    register_image_model_capability(
        provider="openai",
        model_prefix="gpt-image-video-ref",
        capability=ImageModelCapability(
            supported_ratios={"16:9"},
            ratio_size_profiles={"16:9": {"standard": "1792x1024"}},
        ),
    )
    cfg = ProviderConfig(provider="openai", api_key="sk-test", base_url="https://api.openai.com/v1")
    inp = ImageGenerationInput(
        prompt="video ref",
        model="gpt-image-video-ref-1",
        target_ratio="16:9",
        resolution_profile="standard",
        purpose="video_reference",
    )
    try:
        await OpenAIImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)
        body = json.loads(captured["body"])
        assert body["size"] == "1792x1024"
    finally:
        clear_image_model_capability_overrides(provider="openai")


@pytest.mark.asyncio
async def test_volcengine_image_adapter_generations(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/images/generations")
        payload = json.loads(request.content.decode())
        assert payload["prompt"] == "火山"
        assert payload["n"] == 1
        assert payload["watermark"] is True
        assert payload["size"] == "1600x2848"
        return httpx.Response(
            200,
            json={
                "data": [{"image_url": "https://volc.example/v.mp4"}],
                "id": "task-xyz",
                "status": "succeeded",
            },
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="volcengine", api_key="ak-test")
    inp = ImageGenerationInput(
        prompt="火山",
        n=1,
        seed=42,
        watermark=True,
        target_ratio="9:16",
        resolution_profile="standard",
        purpose="video_reference",
    )
    result = await VolcengineImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)
    assert result.provider == "volcengine"
    assert result.provider_task_id == "task-xyz"
    assert result.images[0].url == "https://volc.example/v.mp4"


@pytest.mark.asyncio
async def test_openai_image_adapter_rejects_unsupported_watermark(monkeypatch: pytest.MonkeyPatch) -> None:
    """当能力配置不支持 watermark 时，adapter 在发请求前直接拒绝。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"request should not be sent, got path={request.url.path}")

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    clear_image_model_capability_overrides(provider="openai")
    register_image_model_capability(
        provider="openai",
        model_prefix="gpt-image-no-wm",
        capability=ImageModelCapability(supports_watermark=False),
    )
    cfg = ProviderConfig(provider="openai", api_key="sk-test", base_url="https://api.openai.com/v1")
    inp = ImageGenerationInput(prompt="hello", model="gpt-image-no-wm-1", n=1, watermark=True)
    try:
        with pytest.raises(ValueError) as exc_info:
            await OpenAIImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=30.0)
        assert "watermark is not supported" in str(exc_info.value)
    finally:
        clear_image_model_capability_overrides(provider="openai")


@pytest.mark.asyncio
async def test_openai_image_task_reports_blank_exception_class_name() -> None:
    """Blank provider exceptions still surface a useful error instead of collapsing to no result."""

    class _BlankErrorAdapter:
        async def generate(self, **_kwargs):  # noqa: ANN001, ANN003
            raise RuntimeError()

    task = OpenAIImageGenerationTask(
        adapter=_BlankErrorAdapter(),  # type: ignore[arg-type]
        provider_config=ProviderConfig(provider="openai", api_key="sk-test"),
        input_=ImageGenerationInput(prompt="hello", n=1),  # type: ignore[call-arg]
    )

    await task.run()
    status = await task.status()

    assert status["has_result"] is False
    assert status["error"] == "RuntimeError"
