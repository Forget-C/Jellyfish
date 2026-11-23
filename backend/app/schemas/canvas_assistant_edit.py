"""Typed single-card changes offered by the canvas assistant."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead
from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, AdoptFirstFrameTarget, AdjustShotMovementTarget, ConnectCards, ConnectCardsTarget, MovementFieldName,
)
from app.schemas.generation_canvas import CanvasRead, CanvasSaved


class VideoPromptSegmentEdit(BaseModel):
    """Replace an existing plain-text video prompt segment."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['video_prompt_segment']
    segment_id: str = Field(min_length=1, max_length=128)


class ModelPromptSegmentEdit(VideoPromptSegmentEdit):
    """Replace an existing plain-text prompt segment on any model card."""

    kind: Literal['model_prompt_segment']


class CardTextEdit(BaseModel):
    """Replace the plain-text body of a content card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['card_text']


class DesignTextFieldEdit(BaseModel):
    """Replace a plain-text parameter exposed in the design card catalog."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['design_text_field']
    field_name: str = Field(min_length=1, max_length=64)


class MovementFieldEdit(BaseModel):
    """Edit the text of an existing camera movement field."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['movement_field']
    field: MovementFieldName


class VideoDurationEdit(BaseModel):
    """Set the duration in seconds for one video model card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['video_duration'] = Field(json_schema_extra={'enum': ['video_duration']})


class DeleteCardEdit(BaseModel):
    """Remove one saved card and its incidental connections."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['delete_card']


class ReleaseBindingEdit(BaseModel):
    """Release one adopted input binding on the target card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['release_binding']
    binding_id: str = Field(min_length=1, max_length=128)


class DisconnectCardsEdit(BaseModel):
    """Remove a candidate edge while leaving adopted inputs intact."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['disconnect_cards']
    edge_id: str = Field(min_length=1, max_length=128)


CanvasAssistantFieldTarget = Annotated[
    VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit,
    Field(discriminator='kind'),
]
CanvasAssistantRemovalTarget = Annotated[DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit, Field(discriminator='kind')]
CanvasAssistantEditTarget = Annotated[
    VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit
    | DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit | AddCanvasCardTarget | AdoptFirstFrameTarget
    | AdjustShotMovementTarget | ConnectCardsTarget,
    Field(discriminator='kind'),
]


class CanvasAssistantChange(BaseModel):
    """Preview of one typed change associated with its originating turn."""

    card_id: str
    card_name: str
    target: CanvasAssistantEditTarget
    before: str
    after: str
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
    outcome: Literal['applied', 'rejected', 'partial', 'conflict', 'manual_required']
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
    edits: list[ProposedFieldEdit] = Field(min_length=1, max_length=8)


class ProposedBatchField(BaseModel):
    """Edit an existing scoped field as part of a batch."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['edit_field']
    change: ProposedFieldEdit


class ProposedBatchCard(AddCanvasCardTarget):
    """Name a new card within an approval group so subsequent changes can connect it."""
    kind: Literal['add_card']
    reference: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]


class ProposedBatchRemoval(BaseModel):
    """Remove a card or release an adopted source within the selected scope."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['remove']
    card_id: str
    target: CanvasAssistantRemovalTarget


class ProposedCanvasBatchGroup(BaseModel):
    """One independently executable set of dependent changes."""
    model_config = ConfigDict(extra='forbid')
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    changes: list[Annotated[
        ProposedBatchField | ProposedBatchCard | ProposedBatchRemoval | ConnectCards, Field(discriminator='kind'),
    ]] = Field(min_length=1, max_length=8)


ProposedCanvasBatch = Annotated[list[ProposedCanvasBatchGroup], Field(min_length=1, max_length=8)]


class TextCanvasBatchResponse(BaseModel):
    """Structured output from a text model. It describes a preview only."""
    model_config = ConfigDict(extra='forbid')
    reply: CanvasAssistantEditText
    groups: ProposedCanvasBatch
