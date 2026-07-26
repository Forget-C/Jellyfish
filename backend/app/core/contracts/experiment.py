"""实验室历史输入快照的跨层契约。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.core.contracts.image_generation import ImageResolutionProfile, ImageTargetRatio
from app.core.contracts.video_generation import VideoRatio


class ExperimentTemplateSnapshot(BaseModel):
    """记录模板来源，供历史输入回填时恢复编辑态。"""

    id: str
    values: dict[str, str] = Field(default_factory=dict)


class ExperimentImageInputSnapshot(BaseModel):
    """图片实验室需要回填的参考图和生成规格。"""

    reference_file_ids: list[str] = Field(default_factory=list)
    target_ratio: ImageTargetRatio | None = None
    resolution_profile: ImageResolutionProfile | None = None


class ExperimentFrameReferences(BaseModel):
    """视频实验室的具名帧引用，避免将首尾帧误恢复到关键帧槽位。"""

    first_frame_file_id: str | None = None
    last_frame_file_id: str | None = None
    key_frame_file_ids: list[str] = Field(default_factory=list)


class ExperimentSubjectReference(BaseModel):
    """视频实验室命名主体及其图片、视频参考。"""

    name: str
    image_file_ids: list[str] = Field(default_factory=list)
    video_file_ids: list[str] = Field(default_factory=list)


class ExperimentVideoInputSnapshot(BaseModel):
    """视频实验室需要回填的画幅、帧和主体参考。"""

    ratio: VideoRatio
    frame_references: ExperimentFrameReferences = Field(default_factory=ExperimentFrameReferences)
    subject_references: list[ExperimentSubjectReference] = Field(default_factory=list)


class ExperimentInputSnapshot(BaseModel):
    """持久化在实验室用户消息 payload 中的版本化可重试输入。"""

    version: Literal[1] = 1
    model_id: str
    prompt: str
    template: ExperimentTemplateSnapshot | None = None
    image: ExperimentImageInputSnapshot | None = None
    video: ExperimentVideoInputSnapshot | None = None
