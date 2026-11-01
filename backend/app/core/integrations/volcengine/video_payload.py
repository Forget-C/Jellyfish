"""火山方舟视频：content 与 ratio。"""

from __future__ import annotations

from typing import Any

from app.core.integrations.openai.video_payload import to_image_data_url
from app.core.integrations.video_capabilities import resolve_effective_ratio
from app.core.integrations.volcengine.video_capabilities import validate_volcengine_video_options
from app.core.integrations.video_adapter_usage import ordered_video_frames, resolve_video_adapter_usage
from app.core.contracts.video_generation import VideoGenerationInput


def build_content(input_: VideoGenerationInput) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    prompt = (input_.prompt or "").strip()
    if prompt:
        items.append({"type": "text", "text": prompt})

    usage = resolve_video_adapter_usage(provider="volcengine", model=input_.model)
    for role, value in ordered_video_frames(input_.frame_references, roles=usage.frame_roles):
        items.append({"type": "image_url", "role": role, "image_url": {"url": to_image_data_url(value)}})
    return items


def build_create_task_body(input_: VideoGenerationInput) -> dict[str, Any]:
    validate_volcengine_video_options(input_)
    content = build_content(input_)
    if not content:
        raise RuntimeError("Volcengine video requires non-empty content (prompt and/or reference frames)")

    effective_ratio = resolve_effective_ratio(input_)
    body: dict[str, Any] = {
        "content": content,
        "ratio": effective_ratio,
    }
    if input_.model:
        body["model"] = input_.model
    if input_.seconds is not None:
        body["duration"] = int(input_.seconds)
    if input_.seed is not None:
        body["seed"] = int(input_.seed)
    if input_.watermark is not None:
        body["watermark"] = bool(input_.watermark)
    return body
