"""图片 integrations：httpx MockTransport 单测（不发起真实网络请求）。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.integrations.openai.images import OpenAIImageApiAdapter
from app.core.integrations.vidu.images import ViduImageApiAdapter, build_create_image_body
from app.core.tasks.image_generation_tasks import ViduImageGenerationTask
from app.core.integrations.volcengine.images import (
    VolcengineImageApiAdapter,
    build_volcengine_image_generations_url,
)
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
    """火山图片生成必须使用 Ark v3 的独立 images/generations 端点。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v3/images/generations"
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
    cfg = ProviderConfig(
        provider="volcengine",
        api_key="ak-test",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
    )
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


def test_volcengine_image_url_discards_misconfigured_video_operation_path() -> None:
    """保存了视频操作路径的历史 Base URL 仍应请求正确的图片端点。"""
    assert (
        build_volcengine_image_generations_url(
            "https://ark.cn-beijing.volces.com/api/v3/contents/generations"
        )
        == "https://ark.cn-beijing.volces.com/api/v3/images/generations"
    )


@pytest.mark.asyncio
async def test_vidu_image_adapter_create_and_get(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vidu 图片任务须使用 Token 鉴权并通过 creation 接口读取结果。"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Token vidu-key"
        if request.method == "POST":
            assert request.url.path.endswith("/ent/v2/reference2image")
            body = json.loads(request.content.decode())
            assert body["model"] == "viduq2"
            assert body["images"] == []
            assert body["aspect_ratio"] == "16:9"
            assert body["resolution"] == "2K"
            return httpx.Response(200, json={"task_id": "vidu-image-1", "state": "created"})
        assert request.url.path.endswith("/ent/v2/tasks/vidu-image-1/creations")
        return httpx.Response(
            200,
            json={"state": "success", "creations": [{"url": "https://cdn.vidu.example/image.png"}]},
        )

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    cfg = ProviderConfig(provider="vidu", api_key="vidu-key")
    inp = ImageGenerationInput(
        prompt="a scene",
        model="viduq2",
        target_ratio="16:9",
        resolution_profile="high",
        purpose="video_reference",
    )
    adapter = ViduImageApiAdapter()
    task_id = await adapter.create_image(cfg=cfg, inp=inp, timeout_s=30.0)
    assert task_id == "vidu-image-1"
    creation = await adapter.get_creation(cfg=cfg, task_id=task_id, timeout_s=30.0)
    assert creation["creations"][0]["url"] == "https://cdn.vidu.example/image.png"


@pytest.mark.asyncio
async def test_vidu_image_adapter_exposes_provider_error_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vidu 的 HTTP 失败需带回状态码和响应摘要，供任务中心定位配置或参数问题。"""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": "invalid_token", "message": "token expired"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="HTTP 401.*invalid_token"):
        await ViduImageApiAdapter().create_image(
            cfg=ProviderConfig(provider="vidu", api_key="bad-key"),
            inp=ImageGenerationInput(prompt="a scene", model="viduq2"),
            timeout_s=30.0,
        )


def test_vidu_image_body_rejects_openai_file_id_reference() -> None:
    """Vidu 仅接收 URL 或 data URL，不应把 OpenAI file_id 误透传出去。"""
    inp = ImageGenerationInput(
        prompt="a scene",
        model="viduq2",
        images=[InputImageRef(file_id="file-openai-only")],
    )
    with pytest.raises(ValueError, match="require image_url"):
        build_create_image_body(inp)


@pytest.mark.asyncio
async def test_vidu_image_task_polls_creation_to_result() -> None:
    """Task 层应把 Vidu 的异步 creation 结果转换为统一图片结果。"""

    class _Adapter:
        async def create_image(self, **_: object) -> str:
            return "vidu-image-2"

        async def get_creation(self, **_: object) -> dict[str, object]:
            return {"state": "success", "creations": [{"url": "https://vidu.example/image.png"}]}

    task = ViduImageGenerationTask(
        adapter=_Adapter(),  # type: ignore[arg-type]
        provider_config=ProviderConfig(provider="vidu", api_key="key"),
        input_=ImageGenerationInput(prompt="a scene", model="viduq2"),
        poll_interval_s=0,
    )
    await task.run()
    result = await task.get_result()
    assert result is not None
    assert result.provider == "vidu"
    assert result.images[0].url == "https://vidu.example/image.png"


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
