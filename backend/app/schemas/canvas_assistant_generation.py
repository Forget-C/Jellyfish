"""Public status of the exact generation versions authorized by one message."""

from typing import Literal

from pydantic import BaseModel, Field


class CanvasAssistantGenerationVersion(BaseModel):
    """One stable submission and the status of its canonical run."""

    version: int
    request_id: str
    run_id: str
    input_revision: int
    state: str
    error: str | None = None


class CanvasAssistantGenerationRead(BaseModel):
    """Generation proceeds independently of the composing assistant model."""

    card_id: str
    requested_count: int
    state: Literal['waiting_approval', 'queued', 'running', 'completed', 'failed', 'rejected']
    error: str | None = None
    versions: list[CanvasAssistantGenerationVersion] = Field(default_factory=list)
