"""Typed single-card changes offered by the canvas assistant."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.canvas_assistant_generation import CanvasAssistantGenerationRead

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
    field: Literal['movement_type', 'movement_start', 'movement_trigger', 'movement_path', 'movement_speed', 'end_frame']


CanvasAssistantEditTarget = Annotated[VideoPromptSegmentEdit | MovementFieldEdit, Field(discriminator='kind')]


class CanvasAssistantProposal(BaseModel):
    """Preview of one typed change associated with its originating turn."""

    card_id: str
    card_name: str
    target: CanvasAssistantEditTarget
    before: str
    after: str
    state: Literal['pending', 'rejected', 'applied', 'superseded'] = 'pending'


class CanvasAssistantProposalDecision(BaseModel):
    """Decide on a stored proposal at the editor's current saved revision."""

    model_config = ConfigDict(extra='forbid')
    action: Literal['approve', 'reject']
    expected_revision: int = Field(ge=0)


class CanvasAssistantProposalResult(BaseModel):
    """Approval status and the canonical canvas after a successful save."""

    proposal: CanvasAssistantProposal
    receipt: CanvasSaved | None = None
    canvas: CanvasRead | None = None
    generation: CanvasAssistantGenerationRead | None = None


CanvasAssistantEditText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]
