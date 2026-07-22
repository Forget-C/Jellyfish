"""Vidu 视频生成请求体与端点选择。"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64
from app.core.integrations.openai.video_payload import to_image_data_url
from app.core.integrations.vidu.video_capabilities import validate_vidu_video_options


def build_create_video_request(input_: VideoGenerationInput) -> tuple[str, dict[str, Any]]:
    """按主体或帧参考语义选择 Vidu 视频端点，二者不混用。"""
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

    if input_.subject_references:
        for subject in input_.subject_references:
            _validate_subject_media(subject.images, media_kind="image")
            _validate_subject_media(subject.videos, media_kind="video")
        body["subjects"] = [
            {
                "name": subject.name,
                **({"images": subject.images} if subject.images else {}),
                **({"videos": subject.videos} if subject.videos else {}),
            }
            for subject in input_.subject_references
        ]
        return "/ent/v2/reference2video", body

    if not references:
        return "/ent/v2/text2video", body
    if len(references) == 2 and _strip_optional_b64(input_.frame_references.first_frame) and _strip_optional_b64(input_.frame_references.last_frame) and not input_.frame_references.key_frames:
        body["images"] = references
        return "/ent/v2/start-end2video", body
    if len(references) == 1:
        body["images"] = references
        return "/ent/v2/img2video", body
    body["images"] = references
    return "/ent/v2/reference2video", body


def _validate_subject_media(values: list[str], *, media_kind: str) -> None:
    """仅允许 Vidu 可访问 URL 或带正确 MIME 前缀的主体参考介质。"""
    for value in values:
        if value.startswith(f"data:{media_kind}/"):
            continue
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Vidu subject {media_kind} references require an http(s) URL or data:{media_kind} URL")


def _ordered_references(input_: VideoGenerationInput) -> list[str]:
    """保持首帧、尾帧、关键帧的稳定顺序，并统一为 Vidu 要求的 data URL。"""
    refs: list[str] = []
    for raw in (input_.frame_references.first_frame, input_.frame_references.last_frame, *input_.frame_references.key_frames):
        value = _strip_optional_b64(raw)
        if value:
            refs.append(to_image_data_url(value))
    return refs
