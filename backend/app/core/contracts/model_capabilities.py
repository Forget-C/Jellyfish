"""Capability declarations for an individual provider and model configuration."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt, model_validator

ImageOperationMode = Literal["text_to_image", "reference_image", "edit"]
VideoOperationMode = Literal["text_to_video", "first_frame", "first_last_frames", "key_frames", "subject_reference"]


class ImageModeDeclaration(BaseModel):
    """某种图片操作的模型级参数限制，省略表示沿用适配器范围。"""

    model_config = ConfigDict(extra="forbid")

    supported: bool | None = None
    sizes: list[str] | None = None
    ratios: list[str] | None = None
    resolution_profiles: list[str] | None = None
    max_outputs: int | None = Field(None, ge=1, le=10)
    max_reference_images: int | None = Field(None, ge=0)
    seed: bool | None = None
    watermark: bool | None = None


class VideoDurationRange(BaseModel):
    """允许的整秒时长区间，包含上下限。"""

    model_config = ConfigDict(extra="forbid")
    min_seconds: PositiveInt
    max_seconds: PositiveInt

    @model_validator(mode="after")
    def validate_order(self) -> "VideoDurationRange":
        if self.max_seconds < self.min_seconds:
            raise ValueError("max_seconds must be at least min_seconds")
        return self


class VideoModeDeclaration(BaseModel):
    """按操作和分辨率保存视频参数与参考限制。"""

    model_config = ConfigDict(extra="forbid")
    supported: bool | None = None
    ratios: list[str] | None = None
    duration_by_resolution: dict[str, VideoDurationRange | list[PositiveInt]] = Field(default_factory=dict)
    reference_kinds: list[Literal["image", "video", "audio"]] | None = None
    max_references: int | None = Field(None, ge=0)
    combine_subjects_and_frames: bool | None = None
    audio_reference_input: bool | None = None
    native_audio_output: bool | None = None
    audio_switch: bool | None = None


class ModelCapabilityProfile(BaseModel):
    """Model declarations stored apart from the parameters sent to providers."""

    model_config = ConfigDict(extra="forbid")

    text_inputs: bool = True
    image_inputs: bool = False
    video_inputs: bool = False
    audio_inputs: bool = False
    text_outputs: bool = True
    tool_calling: bool = True
    image_outputs: bool = False
    video_outputs: bool = False
    audio_outputs: bool = False
    non_streaming: bool = True
    native_streaming: bool = True
    tool_results: bool = True
    parallel_tool_calls: bool = False
    streaming_tool_arguments: bool = False
    json_object: bool = False
    json_schema: bool = False
    direct_result: bool = True
    remote_task: bool = False
    remote_cancel: bool = False
    context_window: int | None = Field(None, gt=0, strict=True)
    max_input_tokens: int | None = Field(None, gt=0, strict=True)
    max_output_tokens: int | None = Field(None, gt=0, strict=True)
    image_modes: dict[ImageOperationMode, ImageModeDeclaration] = Field(default_factory=dict)
    video_modes: dict[VideoOperationMode, VideoModeDeclaration] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def read_legacy_declarations(cls, value):
        """Read saved tri-state declarations, letting missing values inherit defaults."""
        if not isinstance(value, dict):
            return value
        fields = dict(value)
        for key, item in value.items():
            if cls.__annotations__.get(key) is bool and isinstance(item, dict):
                declaration = item.get("declaration", "unknown")
                if declaration == "unknown":
                    fields.pop(key)
                elif declaration in ("supported", "unsupported"):
                    fields[key] = declaration == "supported"
        return fields


class EffectiveModelCapabilities(BaseModel):
    """Capabilities available through one operation's current integration."""

    text_inputs: bool = False
    image_inputs: bool = False
    video_inputs: bool = False
    audio_inputs: bool = False
    text_outputs: bool = False
    tool_calling: bool = False
    image_outputs: bool = False
    video_outputs: bool = False
    audio_outputs: bool = False
    non_streaming: bool = False
    native_streaming: bool = False
    tool_results: bool = False
    parallel_tool_calls: bool = False
    streaming_tool_arguments: bool = False
    json_object: bool = False
    json_schema: bool = False
    direct_result: bool = False
    remote_task: bool = False
    remote_cancel: bool = False
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    builtin_defaults: list[str] = Field(default_factory=list)


VerifiedModelCapability = Literal["tool_calling", "image_inputs", "video_inputs", "audio_inputs"]
VerificationReason = Literal[
    "verified", "tool_not_called", "tool_result_not_used", "expected_observation_missing",
    "provider_unavailable", "request_failed", "probe_unavailable",
]


class ModelCapabilityVerificationRequest(BaseModel):
    """One explicitly selected live capability check."""

    model_config = ConfigDict(extra="forbid")

    capability: VerifiedModelCapability


class ModelCapabilityVerificationRead(BaseModel):
    """Safe historical verification metadata without upstream credentials or content."""

    id: str
    provider_id: str
    provider_name: str
    model_name: str
    endpoint: str
    capability: VerifiedModelCapability
    outcome: Literal["passed", "failed"]
    reason: VerificationReason
    tested_at: datetime
    current: bool


ModelOperation = Literal["chat", "storyboard_inspection", "image_generation", "video_generation"]


class ModelOperationCapabilities(BaseModel):
    """指定连接、模型及操作可用的执行方式和参数范围。"""

    features: EffectiveModelCapabilities = Field(default_factory=EffectiveModelCapabilities)
    image_modes: dict[ImageOperationMode, ImageModeDeclaration] = Field(default_factory=dict)
    video_modes: dict[VideoOperationMode, VideoModeDeclaration] = Field(default_factory=dict)
