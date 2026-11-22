"""Media evidence shared by assistant messages and follow-up reviews."""

from typing import Literal

from pydantic import BaseModel, Field


class CanvasAssistantAttachment(BaseModel):
    """A selected file and the evidence actually sent for this turn."""

    file_id: str
    name: str | None = None
    file_type: Literal['image', 'video'] | None = None
    observation: Literal['image', 'video_frame', 'video_sequence', 'video_with_audio', 'unavailable']
    at_ms: int | None = None
    start_ms: int | None = Field(default=None, exclude_if=lambda value: value is None)
    end_ms: int | None = Field(default=None, exclude_if=lambda value: value is None)
    audio_start_ms: int | None = Field(default=None, exclude_if=lambda value: value is None)
    audio_end_ms: int | None = Field(default=None, exclude_if=lambda value: value is None)
