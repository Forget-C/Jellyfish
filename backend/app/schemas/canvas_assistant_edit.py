"""Typed single-card changes offered by the canvas assistant."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead
from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, ConnectCards, VideoTextUse, VideoCharacterUse,
)
from app.schemas.generation_canvas import CanvasRead, CanvasSaved


from app.schemas.canvas_edit_intents import (
    CanvasEditTarget as CanvasAssistantEditTarget,
    CanvasFieldTarget as CanvasAssistantFieldTarget,
    CanvasRemovalTarget as CanvasAssistantRemovalTarget,
)


class CanvasAssistantChange(BaseModel):
    """Preview of one typed change associated with its originating turn."""

    card_id: str
    card_name: str
    target: CanvasAssistantEditTarget
    before: str
    after: str
    origin_reference: str | None = Field(default=None, exclude_if=lambda value: value is None)
    copy_of: str | None = Field(default=None, exclude_if=lambda value: value is None)
    impact_fingerprint: str | None = Field(default=None, exclude_if=lambda value: value is None)
ProposalState = Literal['pending', 'rejected', 'applied', 'superseded']


class CanvasAssistantIndependentReview(BaseModel):
    """Audit details from the independently prompted approval model."""

    status: Literal['approved', 'manual_required', 'unavailable', 'blocked']
    reviewer_model_id: str | None = None
    policy: Literal['canvas-approval-v1'] = 'canvas-approval-v1'
    reason: str


class CanvasAssistantApprovalAudit(BaseModel):
    """A decision associated with the message on which it was taken."""

    source_id: str
    mode: Literal['manual', 'automatic']
    action: Literal['approve', 'reject']
    outcome: Literal['approved', 'applied', 'rejected', 'partial', 'conflict', 'failed', 'blocked', 'manual_required']
    conflicts: list['CanvasAssistantEditConflict'] | None = Field(default=None, exclude_if=lambda value: value is None)
    review: CanvasAssistantIndependentReview | None = Field(default=None, exclude_if=lambda value: value is None)
    group_ids: list[str] | None = None
    decision_id: str | None = Field(default=None, exclude_if=lambda value: value is None)


class CanvasAssistantEditGroup(BaseModel):
    """One selectable group of changes which share an approval decision."""

    id: str
    title: str
    edits: list[CanvasAssistantChange]
    state: ProposalState = 'pending'


class CanvasAssistantProposal(CanvasAssistantChange):
    """A legacy single change or a set of independently selectable groups."""

    state: ProposalState = 'pending'
    groups: list[CanvasAssistantEditGroup] | None = None


class CanvasAssistantProposalDecision(BaseModel):
    """Decide on a stored proposal at the editor's current saved revision."""

    model_config = ConfigDict(extra='forbid')
    action: Literal['approve', 'reject']
    expected_revision: int = Field(ge=0)
    decision_id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')] | None = None
    group_ids: list[str] | None = Field(None, min_length=1, max_length=8)
    approval_mode: Literal['manual', 'automatic'] = 'manual'
    approve_layout: bool = False


class CanvasAssistantEditConflict(BaseModel):
    """Current field value which prevents a group from being applied."""

    group_id: str
    card_id: str
    target: CanvasAssistantEditTarget
    current: str | None


class CanvasAssistantProposalResult(BaseModel):
    """Approval status and the canonical canvas after a successful save."""

    proposal: CanvasAssistantProposal
    receipt: CanvasSaved | None = None
    canvas: CanvasRead | None = None
    conflicts: list[CanvasAssistantEditConflict] = Field(default_factory=list)
    generation: CanvasAssistantGenerationRead | None = None
    automatic_review: CanvasAssistantIndependentReview | None = None
    graph_resumed: bool = False
    replayed: bool = Field(default=False, exclude=True)


CanvasAssistantEditText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]


class ProposedFieldEdit(BaseModel):
    """Model request to preview one existing field."""

    model_config = ConfigDict(extra='forbid')
    card_id: str
    target: CanvasAssistantFieldTarget
    text: CanvasAssistantEditText


class ProposedEditGroup(BaseModel):
    """Model-supplied description of changes which must be applied together."""

    model_config = ConfigDict(extra='forbid')
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    edits: list[ProposedFieldEdit] = Field(min_length=1)


class ProposedBatchField(BaseModel):
    """Edit an existing scoped field as part of a batch."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['edit_field']
    change: ProposedFieldEdit


class ProposedBatchCard(AddCanvasCardTarget):
    """Name a new card within an approval group so subsequent changes can connect it."""
    kind: Literal['add_card']
    copy_of: str | None = Field(default=None, description='Existing source card ID. Use only for an explicitly requested additional copy.')
    reference: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]

    @model_validator(mode='before')
    @classmethod
    def unwrap_model_change(cls, value):
        """Accept the model's edit-style envelope while retaining strict card validation."""
        if isinstance(value, dict) and value.keys() == {'kind', 'change'}:
            fields = value['change']
            if isinstance(fields, dict) and fields.keys() == {'reference', 'card'}:
                return {'kind': value['kind'], **fields}
        return value


class ProposedBatchRemoval(BaseModel):
    """Remove a card or release an adopted source within the selected scope."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['remove']
    card_id: str
    target: CanvasAssistantRemovalTarget


class ProposedBatchConnection(ConnectCards):
    """Accept the same model envelope as other batch operations for checkpoint replay."""

    @model_validator(mode='before')
    @classmethod
    def unwrap_model_change(cls, value):
        if isinstance(value, dict) and value.keys() == {'kind', 'change'}:
            endpoints = value['change']
            if isinstance(endpoints, dict) and endpoints.keys() == cls.model_fields.keys() - {'kind'}:
                return {'kind': value['kind'], **endpoints}
        return value


class CanvasAssistantProposalIssue(BaseModel):
    """A preview failure scoped to an original, one-based group and operation."""

    message: str
    candidate_ids: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    group: int | None = None
    operation: int | None = None
    field: str | None = None
    source_card: str | None = None
    target_card: str | None = None


class ProposedCanvasBatchGroup(BaseModel):
    """One independently executable set of dependent changes."""
    model_config = ConfigDict(extra='forbid')
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    changes: list[Annotated[
        ProposedBatchField | ProposedBatchCard | ProposedBatchRemoval | ProposedBatchConnection | VideoTextUse | VideoCharacterUse, Field(discriminator='kind'),
    ]] = Field(min_length=1)


ProposedCanvasBatch = Annotated[list[ProposedCanvasBatchGroup], Field(min_length=1, max_length=8)]


class TextCanvasBatchResponse(BaseModel):
    """Structured output from a text model. It describes a preview only."""
    model_config = ConfigDict(extra='forbid')
    reply: CanvasAssistantEditText
    groups: ProposedCanvasBatch
