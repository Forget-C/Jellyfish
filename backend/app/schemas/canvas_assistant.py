"""Public request and history contracts for the canvas assistant."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.canvas_assistant_edit import CanvasAssistantProposal


class CanvasAssistantDraftContext(BaseModel):
    """Current visible canvas document and the scope locked at send time."""

    draft: dict = Field(description='当前可见的画布文档，遵循 CanvasDocument 契约')
    revision: int = Field(ge=0)
    scope: Literal['selection', 'canvas']
    card_ids: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def check_selected_cards(self):
        if self.scope == 'selection' and not self.card_ids:
            raise ValueError('Select at least one card')
        return self


class CanvasAssistantReadContext(BaseModel):
    """Read-only snapshot limited to the requested targets and adopted sources."""

    revision: int
    scope: Literal['selection', 'canvas']
    target_card_ids: list[str]
    cards: list[dict]


class CanvasAssistantModelSelection(BaseModel):
    """A null selection follows the configured default text model."""

    model_id: str | None


class CanvasAssistantMessage(BaseModel):
    """Send a turn with a stable request identity for retries."""

    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]
    context: CanvasAssistantDraftContext | None = None
    revises: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')] | None = None


class CanvasAssistantExchange(BaseModel):
    """A completed turn in the order visible to the user."""

    model_config = ConfigDict(from_attributes=True)

    request_id: str
    text: str
    context: CanvasAssistantReadContext | None = None
    sequence: int
    model_id: str
    reply: str
    proposal: CanvasAssistantProposal | None = None
    revises: str | None = None


class CanvasAssistantHistory(BaseModel):
    """Persisted exchanges for the selected canvas."""

    turns: list[CanvasAssistantExchange]
    model_id: str | None = None
