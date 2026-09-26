"""OpenAI Videos API：请求体与参考图映射。"""

from __future__ import annotations

from typing import Any

from app.core.integrations.openai.video_capabilities import validate_openai_video_options
from app.core.integrations.video_capabilities import derive_provider_size, resolve_effective_ratio
from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64


def to_image_data_url(value: str) -> str:
    v = value.strip()
    if v.startswith("data:image/"):
        return v
    return f"data:image/png;base64,{v}"


def to_audio_data_url(value: str, *, default_mime: str = "audio/mpeg") -> str:
    """把纯 base64 或 data URL 归一成 ``data:audio/...;base64,...``。

    与 ``to_image_data_url`` 同口径：已经是 data URL 的原样返回，纯 base64 补前缀。
    """
    text = (value or "").strip()
    if not text:
        return ""
    if text.startswith("data:"):
        return text
    return f"data:{default_mime};base64,{text}"

def pick_input_reference(input_: VideoGenerationInput) -> dict[str, str] | None:
    """OpenAI 仅支持单一 input_reference；优先级：key > first > last。"""
    for raw in (
        _strip_optional_b64(input_.key_frame_base64),
        _strip_optional_b64(input_.first_frame_base64),
        _strip_optional_b64(input_.last_frame_base64),
    ):
        if raw:
            return {"image_url": to_image_data_url(raw)}
    return None


def build_create_video_body(input_: VideoGenerationInput) -> dict[str, Any]:
    validate_openai_video_options(input_)
    body: dict[str, Any] = {"prompt": input_.prompt or ""}
    if input_.model:
        body["model"] = input_.model
    size = derive_provider_size(provider="openai", model=input_.model, ratio=input_.ratio)
    if size:
        body["size"] = size
    if input_.seconds is not None:
        body["seconds"] = str(int(input_.seconds))
    effective_ratio = resolve_effective_ratio(input_)
    if effective_ratio:
        body["ratio"] = effective_ratio
    if input_.seed is not None:
        body["seed"] = int(input_.seed)
    if input_.watermark is not None:
        body["watermark"] = bool(input_.watermark)

    ref = pick_input_reference(input_)
    if ref:
        body["input_reference"] = ref
    return body
