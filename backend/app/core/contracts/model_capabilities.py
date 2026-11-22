"""Capability declarations for an individual provider and model configuration."""

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
