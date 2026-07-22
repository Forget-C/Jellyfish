from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator
from app.core.contracts.video_generation import VideoRatio

class VideoFrameReferenceFiles(BaseModel):
    """分镜生成的具名帧文件，保持帧语义而非无类型图片数组。"""

    first_frame_file_id: str | None = None
    last_frame_file_id: str | None = None
    key_frame_file_ids: list[str] = Field(default_factory=list)


class VideoGenerationTaskRequest(BaseModel):
    """视频生成任务请求。"""

    shot_id: str = Field(..., description="镜头 ID")
    reference_mode: Literal["first", "last", "key", "first_last", "first_last_key", "text_only"] = Field(...)
    # 文本模式必填；非文本模式可选作为补充描述
    prompt: str | None = Field(None, description="视频提示词（text_only 必填）")
    frame_references: VideoFrameReferenceFiles = Field(default_factory=VideoFrameReferenceFiles)

    ratio: VideoRatio = Field(..., description="视频画幅比例，如 16:9 / 9:16")
    # seconds 由 ShotDetail.duration 自动确定；请求体不再接收覆盖值。

    @model_validator(mode="after")
    def validate_frame_mode(self) -> "VideoGenerationTaskRequest":
        """在 API 边界校验模式与具名帧的组合，避免延迟到异步任务失败。"""
        frames = self.frame_references
        has_first = bool(frames.first_frame_file_id)
        has_last = bool(frames.last_frame_file_id)
        has_key = bool(frames.key_frame_file_ids)
        if self.reference_mode == "text_only":
            if has_first or has_last or has_key:
                raise ValueError("text_only mode must not include frame references")
            return self
        required = {
            "first": (has_first,),
            "last": (has_last,),
            "key": (has_key,),
            "first_last": (has_first, has_last),
            "first_last_key": (has_first, has_last, has_key),
        }[self.reference_mode]
        if not all(required):
            raise ValueError(f"frame_references do not satisfy reference_mode={self.reference_mode}")
        return self

    def ordered_frame_file_ids(self) -> list[str]:
        """按 reference_mode 输出旧业务服务所需的稳定帧顺序。"""
        frames = self.frame_references
        first = [frames.first_frame_file_id] if frames.first_frame_file_id else []
        last = [frames.last_frame_file_id] if frames.last_frame_file_id else []
        key = list(frames.key_frame_file_ids)
        mapping = {
            "text_only": [],
            "first": first,
            "last": last,
            "key": key,
            "first_last": first + last,
            "first_last_key": first + last + key,
        }
        return mapping[self.reference_mode]
