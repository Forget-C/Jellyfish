"""Vidu 视频生成请求体与端点选择。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64
from app.core.integrations.openai.video_payload import to_image_data_url
from app.core.integrations.vidu.video_capabilities import validate_vidu_video_options


def build_create_video_request(input_: VideoGenerationInput) -> tuple[str, dict[str, Any]]:
    """根据参考帧组合选择 Vidu 文生、单图、首尾帧或多参考图端点。"""
    model = (input_.model or "").strip()
    if not model:
        raise ValueError("Vidu video generation requires model")
    validate_vidu_video_options(input_)
    references = _ordered_references(input_)
    body: dict[str, Any] = {"model": model, "prompt": (input_.prompt or "").strip(), "aspect_ratio": input_.ratio}
    if input_.seconds is not None:
        body["duration"] = int(input_.seconds)
    if input_.seed is not None:
        body["seed"] = int(input_.seed)

    if not references:
        return "/ent/v2/text2video", body
    if len(references) == 2 and _strip_optional_b64(input_.first_frame_base64) and _strip_optional_b64(input_.last_frame_base64) and not _strip_optional_b64(input_.key_frame_base64):
        body["images"] = references
        return "/ent/v2/start-end2video", body
    if len(references) == 1:
        body["images"] = references
        return "/ent/v2/img2video", body
    body["images"] = references
    return "/ent/v2/reference2video", body


def _ordered_references(input_: VideoGenerationInput) -> list[str]:
    """保持首帧、尾帧、关键帧的稳定顺序，并统一为 Vidu 要求的 data URL。"""
    refs: list[str] = []
    for raw in (input_.first_frame_base64, input_.last_frame_base64, input_.key_frame_base64):
        value = _strip_optional_b64(raw)
        if value:
            refs.append(to_image_data_url(value))
    return refs
