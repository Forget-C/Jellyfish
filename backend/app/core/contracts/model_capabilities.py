"""Capability declarations for an individual provider and model configuration."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CapabilityDeclaration(BaseModel):
    """A model's declared support, independent of the current operation's adapter."""

    model_config = ConfigDict(extra="forbid")

    declaration: Literal["supported", "unsupported", "unknown"] = "unknown"
    source: str | None = Field(None, max_length=255)


class ModelCapabilityProfile(BaseModel):
    """Model declarations stored apart from the parameters sent to providers."""

    model_config = ConfigDict(extra="forbid")

    text_inputs: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    image_inputs: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    video_inputs: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    audio_inputs: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    text_outputs: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    tool_calling: CapabilityDeclaration = Field(default_factory=CapabilityDeclaration)
    max_input_tokens: int | None = Field(None, gt=0, strict=True)


class EffectiveModelCapabilities(BaseModel):
    """Capabilities available through one operation's current integration."""

    text_inputs: bool = False
    image_inputs: bool = False
    video_inputs: bool = False
    audio_inputs: bool = False
    text_outputs: bool = False
    tool_calling: bool = False
    max_input_tokens: int | None = None


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
