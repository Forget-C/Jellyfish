"""xAI Videos API：请求体构造。

与 OpenAI 的 `/videos` 端点不同，xAI 的实际形状是：
- 创建：`POST /videos/generations`，body 为 `{model, prompt, image?: {url}, duration?}`
- 参考帧：`image.url` 接受 data URL（base64 内联）或可访问的远程 URL

关键帧优先级沿用 OpenAI 适配器的约定：key_frame > first_frame > last_frame。
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64

DEFAULT_XAI_VIDEO_MODEL = "grok-imagine-video-1.5"


def to_image_data_url(value: str) -> str:
    v = value.strip()
    if v.startswith("data:image/") or v.startswith("http://") or v.startswith("https://"):
        return v
    return f"data:image/png;base64,{v}"


def pick_input_reference(input_: VideoGenerationInput) -> str | None:
    """xAI 仅支持单一参考图；优先级：key > first > last。"""
    for raw in (
        _strip_optional_b64(input_.key_frame_base64),
        _strip_optional_b64(input_.first_frame_base64),
        _strip_optional_b64(input_.last_frame_base64),
    ):
        if raw:
            return to_image_data_url(raw)
    return None


def build_create_video_body(input_: VideoGenerationInput) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": input_.model or DEFAULT_XAI_VIDEO_MODEL,
        "prompt": input_.prompt or "",
    }
    if input_.seconds is not None:
        body["duration"] = int(input_.seconds)

    ref = pick_input_reference(input_)
    if ref:
        body["image"] = {"url": ref}

    return body
