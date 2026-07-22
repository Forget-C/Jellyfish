"""火山方舟视频：content 与 ratio。"""

from __future__ import annotations

from typing import Any

from app.core.integrations.openai.video_payload import to_image_data_url
from app.core.integrations.video_capabilities import resolve_effective_ratio
from app.core.integrations.volcengine.video_capabilities import validate_volcengine_video_options
from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64


def build_content(input_: VideoGenerationInput) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    prompt = (input_.prompt or "").strip()
    if prompt:
        items.append({"type": "text", "text": prompt})

    ff = _strip_optional_b64(input_.frame_references.first_frame)
    if ff:
        items.append(
            {
                "type": "image_url",
                "role": "first_frame",
                "image_url": {"url": to_image_data_url(ff)},
            }
        )
    lf = _strip_optional_b64(input_.frame_references.last_frame)
    if lf:
        items.append(
            {
                "type": "image_url",
                "role": "last_frame",
                "image_url": {"url": to_image_data_url(lf)},
            }
        )
    for kf in (_strip_optional_b64(value) for value in input_.frame_references.key_frames):
        if not kf:
            continue
        items.append(
            {
                "type": "image_url",
                "role": "key_frame",
                "image_url": {"url": to_image_data_url(kf)},
            }
        )
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
