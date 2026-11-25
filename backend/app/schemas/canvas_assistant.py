"""Public request and history contracts for the canvas assistant."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.canvas_assistant_edit import CanvasAssistantApprovalAudit, CanvasAssistantProposal, CanvasAssistantProposalIssue
from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead, CanvasAssistantSkillUse
from app.schemas.canvas_assistant_media import CanvasAssistantAttachment
from app.schemas.canvas_assistant_subtasks import CanvasAssistantSubtask
from app.schemas.canvas_assistant_layout import CanvasAssistantLayout, CanvasAssistantPoint, CardId


from app.schemas.interaction import ChatToolCall, InteractionSnapshot


class CanvasAssistantDraftContext(BaseModel):
    """Current visible canvas document and the scope locked at send time."""

    draft: dict = Field(description='当前可见的画布文档，遵循 CanvasDocument 契约')
    revision: int = Field(ge=0)
    scope: Literal['selection', 'canvas', 'auto']
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


class CanvasAssistantGroupReference(BaseModel):
    """The named group and member identities captured by the clipboard."""

    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    card_ids: list[str] = Field(min_length=1, max_length=20)


class CanvasAssistantCardReference(BaseModel):
    """Explicit read-only reference to cards in another saved canvas."""

    model_config = ConfigDict(extra='forbid')
    canvas_id: str = Field(min_length=1, max_length=64)
    card_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(min_length=1, max_length=20)
    groups: list[CanvasAssistantGroupReference] = Field(default_factory=list, max_length=20, exclude_if=lambda value: not value)

    @model_validator(mode='after')
    def check_group_members(self):
        if any(set(group.card_ids) - set(self.card_ids) for group in self.groups):
            raise ValueError('Group references must contain only captured card identities')
        return self



class CanvasAssistantMessage(BaseModel):
    """Send a turn with a stable request identity for retries."""

    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]
    stream_reply: bool = Field(default=False, exclude_if=lambda value: not value)
    context: CanvasAssistantDraftContext | None = None
    submit_preview_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$', exclude_if=lambda value: value is None)
    revises: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')] | None = None
    revises_field: CanvasAssistantFieldRevision | None = None
    repairs: str | None = Field(default=None, min_length=1, max_length=64, exclude_if=lambda value: value is None)
    canvas_references: list[CanvasAssistantCardReference] = Field(default_factory=list, max_length=3)
    attachment_file_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(
        default_factory=list, max_length=4,
    )

    @model_validator(mode='after')
    def check_attachment_identity(self):
        other_edit = self.revises or self.repairs or self.canvas_references or self.attachment_file_ids
        if self.submit_preview_id and (self.context is None or other_edit):
            raise ValueError('Submitting a preview requires its displayed document and no other edits')
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


CanvasAssistantPhase = Literal['waiting_model', 'reasoning', 'generating_proposal', 'validating_proposal']


class CanvasAssistantProgress(BaseModel):
    """Evidence available while the leased turn is still running."""

    reply: str | None = Field(default=None, exclude_if=lambda value: value is None)
    streaming: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    error_code: str | None = Field(default=None, exclude_if=lambda value: value is None)
    tool_call: ChatToolCall | None = Field(default=None, exclude_if=lambda value: value is None)
    phase: CanvasAssistantPhase | None = None
    phase_started_at: dict[str, datetime] = Field(default_factory=dict)
    request_id: str
    scope: Literal['selection', 'canvas'] | None = None
    revision: int | None = None
    target_card_ids: list[str] = Field(default_factory=list)
    observed_card_ids: list[str] = Field(default_factory=list)
    model_id: str
    skills: list[CanvasAssistantSkillUse] = Field(default_factory=list)
    attachments: list[CanvasAssistantAttachment] = Field(default_factory=list)
    active_tasks: dict[str, str] = Field(default_factory=dict)
    subtasks: list[CanvasAssistantSubtask] = Field(default_factory=list)


class CanvasAssistantReadOnlyPreview(BaseModel):
    """The exact candidate displayed before the user sends it for approval."""

    id: str
    revision: int
    proposal: CanvasAssistantProposal


class CanvasAssistantExchange(BaseModel):
    """A completed turn in the order visible to the user."""

    model_config = ConfigDict(from_attributes=True)

    request_id: str
    text: str
    context: CanvasAssistantReadContext | None = None
    attachments: list[CanvasAssistantAttachment] | None = None
    canvas_references: list[CanvasAssistantCardReference] | None = None
    sequence: int
    model_id: str
    reply: str
    proposal: CanvasAssistantProposal | None = None
    preview: CanvasAssistantReadOnlyPreview | None = Field(default=None, exclude_if=lambda value: value is None)
    submitted_preview_id: str | None = Field(default=None, exclude_if=lambda value: value is None)
    proposal_issues: list[CanvasAssistantProposalIssue] | None = None
    revises: str | None = None
    revises_field: CanvasAssistantFieldRevision | None = None
    repairs: str | None = Field(default=None, min_length=1, max_length=64, exclude_if=lambda value: value is None)
    skills: list[CanvasAssistantSkillUse] | None = None
    subtasks: list[CanvasAssistantSubtask] | None = None
    automatic_approval: bool = False
    approval_audit: list[CanvasAssistantApprovalAudit] | None = None
    generation: CanvasAssistantGenerationRead | None = None
    stopped: bool = False
    progress: CanvasAssistantProgress | None = None
    error_code: str | None = Field(default=None, exclude_if=lambda value: value is None)
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


class CanvasAssistantHistory(InteractionSnapshot):
    """Persisted exchanges for the selected canvas."""

    capabilities: tuple[InteractionCapability, ...]
    turns: list[CanvasAssistantExchange]
    pending_request: CanvasAssistantPendingRequest | None = None
    pending_question: CanvasAssistantQuestion | None = None
    pending_progress: CanvasAssistantProgress | None = None
    pending_instructions: list[CanvasAssistantInstruction] = Field(default_factory=list)
    queue: list[CanvasAssistantQueueItem] = Field(default_factory=list)
    model_id: str | None = None
    approval_mode: Literal['manual', 'automatic'] = 'manual'


CanvasAssistantEventPayload = CanvasAssistantExchange | CanvasAssistantQueueItem
