"""Exchange and promotion of a browser-owned free canvas conversation."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.canvas_assistant import CanvasAssistantExchange, CanvasAssistantMessage
from app.schemas.generation_canvas import CanvasDocument, CanvasSave, CanvasSaved


class DraftAssistantConversation(BaseModel):
    """Browser transcript to attach to the first committed canvas revision."""

    turns: list[dict] = Field(default_factory=list, max_length=100, description='此前返回的有序 CanvasAssistantExchange 对象')
    model_id: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None = None

    @model_validator(mode='after')
    def require_ordered_turns(self):
        turns = self.validated_turns()
        ids = {turn.request_id for turn in turns}
        if len(ids) != len(turns) or any(
            turn.sequence != index or not turn.request_id or len(turn.request_id) > 64
            or not turn.model_id or len(turn.model_id) > 64 or len(turn.text) > 16000
            or len(turn.reply) > 64000 or len(turn.attachments or []) > 4
            for index, turn in enumerate(turns, 1)
        ):
            raise ValueError('Invalid draft assistant transcript')
        return self

    def validated_turns(self) -> list[CanvasAssistantExchange]:
        """Read the completed exchanges received by the browser."""
        return [CanvasAssistantExchange.model_validate(turn) for turn in self.turns]


class DraftAssistantMessage(CanvasAssistantMessage, DraftAssistantConversation):
    """Reply without storing a conversation or requiring a saved canvas."""


class DraftAssistantApproval(BaseModel):
    """An explicit selection of a card creation proposal during the first save."""

    source_id: str = Field(min_length=1, max_length=64)
    group_ids: list[str] = Field(min_length=1, max_length=8)


class CanvasDraftSave(CanvasSave):
    """Include the local conversation in the ordinary idempotent first save."""

    assistant: DraftAssistantConversation | None = Field(default=None, exclude_if=lambda value: value is None)
    start_assistant: bool = Field(default=False, exclude_if=lambda value: not value)
    assistant_approval: DraftAssistantApproval | None = Field(default=None, exclude_if=lambda value: value is None)


class CanvasDraftSaved(CanvasSaved):
    """Return the canonical document if approval added cards during promotion."""

    document: CanvasDocument | None = Field(default=None, exclude_if=lambda value: value is None)
