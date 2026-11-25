"""可灵视频模型的请求体构建与路径选择。"""

from __future__ import annotations

from typing import Any

from app.core.integrations.video_adapter_usage import KLING_FRAME_ROLES, ordered_video_frames
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.kling.video_capabilities import validate_kling_video_options


def build_create_video_request(input_: VideoGenerationInput, *, connection_test: bool = False) -> tuple[str, dict[str, Any]]:
    """根据模型与参考帧构建可灵 3.0 视频创建请求。"""
    model = (input_.model or "").strip()
    if connection_test:
        if not model or model in {".", ".."} or any(char in model for char in "/\\?#%"):
            raise ValueError("可灵视频模型名称不能包含路径或查询参数")
    else:
        validate_kling_video_options(input_)
        model = model.lower()
    references = _frame_contents(input_)
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
    """按首帧、尾帧顺序生成可灵内容项。"""
    contents: list[dict[str, Any]] = []
    for name, value in ordered_video_frames(input_.frame_references, roles=KLING_FRAME_ROLES):
        contents.append({"type": name, "url": _to_image_data_url(value)})
    return contents


def _to_image_data_url(value: str) -> str:
    """保留已有 data URL；纯 base64 默认标记为 PNG 数据。"""
    return value if value.startswith("data:") else f"data:image/png;base64,{value}"
