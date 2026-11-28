"""Public status of the exact generation versions authorized by one message."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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


class CanvasAssistantGenerationInput(BaseModel):
    """Public compiled prompt, model settings and sources shown before generation."""

    text: str
    model: dict
    media: list[dict]


class CanvasAssistantGenerationDifference(BaseModel):
    """The frozen and current inputs reviewed before further versions are allowed."""

    before: CanvasAssistantGenerationInput | None = None
    after: CanvasAssistantGenerationInput
    revision: int
    basis_hash: str


class CanvasAssistantGenerationApproval(BaseModel):
    """Confirm the specific changed input displayed to the user."""

    model_config = ConfigDict(extra='forbid')
    decision_id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    revision: int = Field(ge=0)
    basis_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class CanvasAssistantGenerationRead(BaseModel):
    """Generation proceeds independently of the composing assistant model."""

    card_id: str
    requested_count: int
    state: Literal['waiting_approval', 'queued', 'running', 'completed', 'failed', 'rejected', 'stopped', 'reapproval_required']
    error: str | None = None
    versions: list[CanvasAssistantGenerationVersion] = Field(default_factory=list)
    review: CanvasAssistantGenerationReview | None = None
    changed_input: CanvasAssistantGenerationDifference | None = None
