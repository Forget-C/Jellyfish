"""APIMart 图片适配器：异步任务协议 + 参考图 image_urls。

全部不联网（httpx MockTransport / 直接断言请求体）。
回归点：这个适配器以前只是 OpenAI 的空壳，会拿 ``/images/edits`` + ``images[]`` 去打 APIMart
（它没有那个路由、参考图字段也叫 image_urls），关键帧一带参考图就必错。
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.apimart.images import (
    SUPPORTED_RATIOS,
    ApimartImageApiAdapter,
    ApimartImageError,
    build_submit_body,
    collect_image_urls,
    resolve_ratio,
    resolve_resolution,
)
from app.services.studio.llm_orchestration.dry_run import (
    CONFIRM_ENV,
    DRY_RUN_ENV,
    DryRunBlocked,
)


@pytest.fixture(autouse=True)
def _allow_real_calls(monkeypatch):
    """默认把守卫放开；需要断言拦截的用例自行打开（不联网，只断言"没发出请求"）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")


def _input(**overrides) -> ImageGenerationInput:
    payload = {
        "prompt": "韩虹站在舞台中央",
        "model": "gpt-image-2",
        "target_ratio": "16:9",
        "resolution_profile": "standard",
        "purpose": "video_reference",
    }
    payload.update(overrides)
    return ImageGenerationInput.model_validate(payload)


def _cfg() -> ProviderConfig:
    return ProviderConfig(provider="apimart", api_key="test-key", base_url="https://api.apimart.ai/v1")


def test_ratio_and_resolution_mapping():
    assert resolve_ratio(_input()) == "16:9"
    assert resolve_ratio(_input(target_ratio=None, size="3:4")) == "3:4"
    assert resolve_ratio(_input(target_ratio=None, size=None)) == "1:1"
    with pytest.raises(ValueError) as exc:
        resolve_ratio(_input(target_ratio="21:9"))
    assert "21:9" in str(exc.value)

    assert resolve_resolution(_input()) == "2k"
    assert resolve_resolution(_input(resolution_profile="high")) == "4k"


def test_submit_body_uses_image_urls_not_openai_images():
    inp = _input(
        images=[
            {"image_url": "https://oss.example.com/a.png"},
            {"image_url": "https://oss.example.com/b.png"},
            {"image_url": "https://oss.example.com/a.png"},  # 去重
        ]
    )
    body = build_submit_body(inp)

    assert body["size"] == "16:9"
    assert body["resolution"] == "2k"
    assert body["model"] == "gpt-image-2"
    assert body["image_urls"] == ["https://oss.example.com/a.png", "https://oss.example.com/b.png"]
    # 关键：不能出现 OpenAI 的 images[] 字段（APIMart 不认）
    assert "images" not in body
    assert SUPPORTED_RATIOS == ("1:1", "3:4", "16:9")


def test_collect_image_urls_prefers_single_over_grid():
    payload = {
        "code": 200,
        "data": {
            "status": "completed",
            "images": [
                {"url": "https://cdn.example.com/a-grid-thumbnail.png"},
                {"url": "https://cdn.example.com/final.png"},
            ],
        },
    }
    assert collect_image_urls(payload) == ["https://cdn.example.com/final.png", "https://cdn.example.com/a-grid-thumbnail.png"]


@pytest.mark.asyncio
async def test_generate_submits_then_polls_and_returns_public_url():
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        calls.append((request.method, str(request.url), body))
        if request.method == "POST":
            assert body["image_urls"] == ["https://oss.example.com/ref.png"]
            assert "images" not in body
            return httpx.Response(200, json={"code": 200, "data": {"task_id": "task_x", "status": "submitted"}})
        return httpx.Response(
            200,
            json={
                "code": 200,
                "data": {"status": "completed", "images": [{"url": "https://cdn.example.com/keyframe.png"}]},
            },
        )

    adapter = ApimartImageApiAdapter(transport=httpx.MockTransport(handler))
    result = await adapter.generate(
        cfg=_cfg(),
        inp=_input(images=[{"image_url": "https://oss.example.com/ref.png"}]),
        timeout_s=30,
    )

    assert result.provider == "apimart"
    assert result.provider_task_id == "task_x"
    assert result.status == "completed"
    assert result.images[0].url == "https://cdn.example.com/keyframe.png"
    assert any("image_urls" in note and "1 张" in note for note in result.provider_notes)
    assert calls[0][1] == "https://api.apimart.ai/v1/images/generations"
    assert calls[1][1].startswith("https://api.apimart.ai/v1/tasks/task_x")


@pytest.mark.asyncio
async def test_generate_raises_on_failed_status_with_task_id():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"code": 200, "data": {"task_id": "task_bad"}})
        return httpx.Response(200, json={"code": 200, "data": {"status": "failed", "error": "content policy"}})

    adapter = ApimartImageApiAdapter(transport=httpx.MockTransport(handler))
    with pytest.raises(ApimartImageError) as exc:
        await adapter.generate(cfg=_cfg(), inp=_input(), timeout_s=30)

    assert "task_bad" in str(exc.value)
    assert "failed" in str(exc.value)


@pytest.mark.asyncio
async def test_generate_flags_data_url_references_as_unverified():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"code": 200, "data": {"task_id": "task_d"}})
        return httpx.Response(200, json={"code": 200, "data": {"status": "done", "url": "https://cdn.example.com/x.png"}})

    adapter = ApimartImageApiAdapter(transport=httpx.MockTransport(handler))
    result = await adapter.generate(
        cfg=_cfg(),
        inp=_input(images=[{"image_url": "data:image/png;base64,AAAA"}]),
        timeout_s=30,
    )
    assert any("data URL" in note for note in result.provider_notes)


@pytest.mark.asyncio
async def test_generate_is_blocked_by_dry_run_guard(monkeypatch):
    monkeypatch.setenv(DRY_RUN_ENV, "1")
    monkeypatch.delenv(CONFIRM_ENV, raising=False)

    def handler(_request: httpx.Request) -> httpx.Response:  # pragma: no cover - 不应被调用
        raise AssertionError("DRY_RUN 下不允许发出任何请求")

    adapter = ApimartImageApiAdapter(transport=httpx.MockTransport(handler))
    with pytest.raises(DryRunBlocked):
        await adapter.generate(cfg=_cfg(), inp=_input(), timeout_s=30)
