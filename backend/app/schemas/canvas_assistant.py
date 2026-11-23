"""Public request and history contracts for the canvas assistant."""

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.canvas_assistant_edit import CanvasAssistantApprovalAudit, CanvasAssistantProposal
from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead, CanvasAssistantSkillUse
from app.schemas.canvas_assistant_media import CanvasAssistantAttachment
from app.schemas.canvas_assistant_layout import CanvasAssistantLayout, CanvasAssistantPoint, CardId


class CanvasAssistantDraftContext(BaseModel):
    """Current visible canvas document and the scope locked at send time."""

    draft: dict = Field(description='当前可见的画布文档，遵循 CanvasDocument 契约')
    revision: int = Field(ge=0)
    scope: Literal['selection', 'canvas']
    card_ids: list[str] = Field(default_factory=list)
    layout_positions: dict[CardId, CanvasAssistantPoint] | None = Field(default=None, max_length=1000)

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
    observed_card_ids: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    layout_positions: dict[str, CanvasAssistantPoint] | None = Field(default=None, exclude_if=lambda value: value is None)


class CanvasAssistantModelSelection(BaseModel):
    """A null selection follows the configured default text model."""

    model_id: str | None


class CanvasAssistantApprovalSetting(BaseModel):
    """Control automatic approval on the current canvas."""

    approval_mode: Literal['manual', 'automatic']


class CanvasAssistantFieldRevision(BaseModel):
    """Point to an immutable change in an existing proposal group."""

    model_config = ConfigDict(extra='forbid')
    group_id: str = Field(min_length=1, max_length=64)
    change_index: int = Field(ge=0, le=7)


class CanvasAssistantMessage(BaseModel):
    """Send a turn with a stable request identity for retries."""

    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]
    context: CanvasAssistantDraftContext | None = None
    revises: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')] | None = None
    revises_field: CanvasAssistantFieldRevision | None = None
    attachment_file_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(
        default_factory=list, max_length=4,
    )

    @model_validator(mode='after')
    def check_attachment_identity(self):
        if self.revises_field is not None and self.revises is None:
            raise ValueError('A field revision must identify a source proposal')
        if len(set(self.attachment_file_ids)) != len(self.attachment_file_ids):
            raise ValueError('Assistant attachments must be distinct')
        return self


class CanvasAssistantQuestion(BaseModel):
    """One creative decision requested by a paused assistant turn."""

    id: str
    text: str
    options: list[str]


class CanvasAssistantQuestionAnswer(BaseModel):
    """An answer belongs to exactly one creative question within a turn."""

    model_config = ConfigDict(extra='forbid')
    question_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CanvasAssistantInstruction(BaseModel):
    """A user instruction directed to an already admitted canvas turn."""

    model_config = ConfigDict(extra='forbid')
    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CanvasAssistantExchange(BaseModel):
    """A completed turn in the order visible to the user."""

    model_config = ConfigDict(from_attributes=True)

    request_id: str
    text: str
    context: CanvasAssistantReadContext | None = None
    attachments: list[CanvasAssistantAttachment] | None = None
    sequence: int
    model_id: str
    reply: str
    proposal: CanvasAssistantProposal | None = None
    revises: str | None = None
    revises_field: CanvasAssistantFieldRevision | None = None
    skills: list[CanvasAssistantSkillUse] | None = None
    automatic_approval: bool = False
    approval_audit: list[CanvasAssistantApprovalAudit] | None = None
    generation: CanvasAssistantGenerationRead | None = None
    stopped: bool = False
    layout: CanvasAssistantLayout | None = None
    question: CanvasAssistantQuestion | None = None
    question_answers: list[CanvasAssistantQuestionAnswer] | None = None
    instructions: list[CanvasAssistantInstruction] | None = None


class CanvasAssistantPendingRequest(CanvasAssistantMessage):
    """Original immutable command available to retry after reconnecting."""


class CanvasAssistantQueuedText(BaseModel):
    """Replace the text of a waiting message while retaining its locked references."""

    model_config = ConfigDict(extra='forbid')
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]


class CanvasAssistantQueueItem(BaseModel):
    """A recoverable queue entry, distinct from its eventual conversation turn."""

    request_id: str
    turn_id: str | None = None
    state: Literal['queued', 'admitted', 'completed', 'removed']
    message: CanvasAssistantQueuedText


InteractionCapability = Literal['snapshot', 'send', 'events', 'stop', 'approval', 'question', 'queue', 'steer']


class CanvasAssistantHistory(BaseModel):
    """Persisted exchanges for the selected canvas."""

    session_id: str
    cursor: int
    capabilities: tuple[InteractionCapability, ...]
    turns: list[CanvasAssistantExchange]
    pending_request: CanvasAssistantPendingRequest | None = None
    pending_question: CanvasAssistantQuestion | None = None
    pending_instructions: list[CanvasAssistantInstruction] = Field(default_factory=list)
    queue: list[CanvasAssistantQueueItem] = Field(default_factory=list)
    model_id: str | None = None
    approval_mode: Literal['manual', 'automatic'] = 'manual'


Payload = TypeVar('Payload')


class InteractionEvent(BaseModel, Generic[Payload]):
    """A committed interaction update with resume and deduplication identities."""

    session_id: str
    turn_id: str | None
    cursor: int
    type: str
    payload: Payload


CanvasAssistantEventPayload = CanvasAssistantExchange | CanvasAssistantQueueItem
