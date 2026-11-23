"""Public status of the exact generation versions authorized by one message."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.canvas_assistant_media import CanvasAssistantAttachment


class CanvasAssistantGenerationVersion(BaseModel):
    """One stable submission and the status of its canonical run."""

    version: int
    request_id: str
    run_id: str
    input_revision: int
    state: str
    error: str | None = None


class CanvasAssistantSkillUse(BaseModel):
    """Version of a product skill actually loaded to answer a message."""

    id: str
    name: str
    version: str


class CanvasAssistantReviewResult(BaseModel):
    """Feedback or an evidence limitation tied to one canonical run."""

    run_id: str
    version: int
    reply: str
    evidence: list[CanvasAssistantAttachment] = Field(default_factory=list)
    skills: list[CanvasAssistantSkillUse] = Field(default_factory=list)


class CanvasAssistantGenerationReview(BaseModel):
    """Lifecycle of the follow-up authorized by the originating user message."""

    state: Literal['waiting', 'reviewing', 'completed', 'stopped']
    results: list[CanvasAssistantReviewResult] = Field(default_factory=list)


class CanvasAssistantGenerationRead(BaseModel):
    """Generation proceeds independently of the composing assistant model."""

    card_id: str
    requested_count: int
    state: Literal['waiting_approval', 'queued', 'running', 'completed', 'failed', 'rejected', 'stopped']
    error: str | None = None
    versions: list[CanvasAssistantGenerationVersion] = Field(default_factory=list)
    review: CanvasAssistantGenerationReview | None = None
