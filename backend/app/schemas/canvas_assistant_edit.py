"""Typed single-card changes offered by the canvas assistant."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead
from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, AdoptFirstFrameTarget, AdjustShotMovementTarget, MovementFieldName,
)
from app.schemas.generation_canvas import CanvasRead, CanvasSaved


class VideoPromptSegmentEdit(BaseModel):
    """Replace an existing plain-text video prompt segment."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['video_prompt_segment']
    segment_id: str = Field(min_length=1, max_length=128)


class MovementFieldEdit(BaseModel):
    """Edit the text of an existing camera movement field."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['movement_field']
    field: MovementFieldName


class DeleteCardEdit(BaseModel):
    """Remove one saved card and its incidental connections."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['delete_card']


class ReleaseBindingEdit(BaseModel):
    """Release one adopted input binding on the target card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['release_binding']
    binding_id: str = Field(min_length=1, max_length=128)


CanvasAssistantFieldTarget = Annotated[VideoPromptSegmentEdit | MovementFieldEdit, Field(discriminator='kind')]
CanvasAssistantRemovalTarget = Annotated[DeleteCardEdit | ReleaseBindingEdit, Field(discriminator='kind')]
CanvasAssistantEditTarget = Annotated[
    VideoPromptSegmentEdit | MovementFieldEdit | DeleteCardEdit | ReleaseBindingEdit | AddCanvasCardTarget | AdoptFirstFrameTarget
    | AdjustShotMovementTarget,
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


class CanvasAssistantApprovalAudit(BaseModel):
    """A decision associated with the message on which it was taken."""

    source_id: str
    mode: Literal['manual', 'automatic']
    action: Literal['approve', 'reject']
    outcome: Literal['applied', 'rejected', 'partial', 'conflict']
    group_ids: list[str] | None = None


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
    group_ids: list[str] | None = Field(None, min_length=1, max_length=8)
    approval_mode: Literal['manual', 'automatic'] = 'manual'


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
