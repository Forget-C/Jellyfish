"""可灵视频模型的请求体构建与路径选择。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64
from app.core.integrations.kling.video_capabilities import validate_kling_video_options

_OMNI_MODEL = "kling-3.0"
_TURBO_MODEL = "kling-3.0-turbo"


def build_create_video_request(input_: VideoGenerationInput) -> tuple[str, dict[str, Any]]:
    """根据模型与参考帧构建可灵 3.0 视频创建请求。"""
    validate_kling_video_options(input_)
    model = (input_.model or "").strip().lower()
    if model not in {_OMNI_MODEL, _TURBO_MODEL}:
        raise ValueError("Kling video model must be kling-3.0 or kling-3.0-turbo")
    references = _frame_contents(input_)
    if references and model == _TURBO_MODEL:
        raise ValueError("Kling 3.0 Turbo only supports text-to-video")
    if references:
        path = "/image-to-video/kling-3.0"
        body: dict[str, Any] = {"contents": _text_content(input_) + references}
    else:
        path = f"/text-to-video/{model}"
        body = {"prompt": (input_.prompt or "").strip()}
    settings: dict[str, Any] = {"aspect_ratio": input_.ratio}
    if input_.seconds is not None:
        settings["duration"] = int(input_.seconds)
    body["settings"] = settings
    if input_.watermark is not None:
        body["options"] = {"watermark_info": {"enabled": input_.watermark}}
    return path, body


def _text_content(input_: VideoGenerationInput) -> list[dict[str, str]]:
    """将可选提示词映射为 Omni 图生视频的文本内容项。"""
    prompt = (input_.prompt or "").strip()
    return [{"type": "prompt", "text": prompt}] if prompt else []


def _frame_contents(input_: VideoGenerationInput) -> list[dict[str, Any]]:
    """按首帧、尾帧、关键帧稳定顺序生成可灵内容项。"""
    if input_.frame_references.key_frames:
        raise ValueError("Kling 3.0 Omni image-to-video does not support key_frame")
    contents: list[dict[str, Any]] = []
    for name, raw in (
        ("first_frame", input_.frame_references.first_frame),
        ("last_frame", input_.frame_references.last_frame),
    ):
        value = _strip_optional_b64(raw)
        if value:
            contents.append({"type": name, "url": _to_image_data_url(value)})
    return contents


def _to_image_data_url(value: str) -> str:
    """保留已有 data URL；纯 base64 默认标记为 PNG 数据。"""
    return value if value.startswith("data:") else f"data:image/png;base64,{value}"
