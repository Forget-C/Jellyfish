"""Gemini (Veo) Videos API：请求体构造。

创建请求形状（已对真实 API 验证过）：
`POST /models/{model}:predictLongRunning`
```
{
  "instances": [{"prompt": "...", "image"?: {"bytesBase64Encoded": "...", "mimeType": "..."}}],
  "parameters": {"aspectRatio": "16:9", "resolution": "720p"}
}
```

关键帧优先级沿用其他 provider 的约定：key_frame > first_frame > last_frame。
`bytesBase64Encoded` 只要纯 base64，不带 data URL 前缀——若输入带前缀需先剥离。
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64

DEFAULT_GEMINI_VIDEO_MODEL = "veo-3.1-lite-generate-preview"
DEFAULT_GEMINI_VIDEO_RESOLUTION = "720p"


def _split_data_url(value: str) -> tuple[str, str]:
    """把 (可能带 data URL 前缀的) 值拆成 (mimeType, 纯 base64)。"""
    if value.startswith("data:"):
        header, _, encoded = value.partition(",")
        mime_type = header[5:].split(";")[0] or "image/jpeg"
        return mime_type, encoded
    return "image/jpeg", value


def pick_input_reference(input_: VideoGenerationInput) -> dict[str, str] | None:
    """Gemini 仅支持单一参考图；优先级：key > first > last。"""
    for raw in (
        _strip_optional_b64(input_.key_frame_base64),
        _strip_optional_b64(input_.first_frame_base64),
        _strip_optional_b64(input_.last_frame_base64),
    ):
        if raw:
            mime_type, encoded = _split_data_url(raw)
            return {"bytesBase64Encoded": encoded, "mimeType": mime_type}
    return None


def build_create_video_body(input_: VideoGenerationInput) -> dict[str, Any]:
    instance: dict[str, Any] = {"prompt": input_.prompt or ""}
    ref = pick_input_reference(input_)
    if ref:
        instance["image"] = ref

    parameters: dict[str, Any] = {"resolution": DEFAULT_GEMINI_VIDEO_RESOLUTION}
    if input_.ratio:
        parameters["aspectRatio"] = input_.ratio

    return {
        "instances": [instance],
        "parameters": parameters,
    }


def resolve_video_model(input_: VideoGenerationInput) -> str:
    return input_.model or DEFAULT_GEMINI_VIDEO_MODEL
