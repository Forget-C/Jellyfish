"""Typed canvas targets and edit intent shared by service callers."""

from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.canvas_assistant_structure import (
    AddCanvasCardTarget, AdoptFirstFrameTarget, AdjustShotMovementTarget, ConnectCardsTarget, MovementFieldName, VideoInputTarget,
)


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


class ReferenceNameEdit(BaseModel):
    """Set the manually entered name of a reference card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['reference_name']


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


CanvasFieldTarget = Annotated[
    VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | ReferenceNameEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit,
    Field(discriminator='kind'),
]
CanvasRemovalTarget = Annotated[DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit, Field(discriminator='kind')]
CanvasEditTarget = Annotated[
    VideoPromptSegmentEdit | ModelPromptSegmentEdit | CardTextEdit | ReferenceNameEdit | DesignTextFieldEdit | MovementFieldEdit | VideoDurationEdit
    | DeleteCardEdit | ReleaseBindingEdit | DisconnectCardsEdit | AddCanvasCardTarget | AdoptFirstFrameTarget
    | AdjustShotMovementTarget | ConnectCardsTarget | VideoInputTarget,
    Field(discriminator='kind'),
]


@dataclass(frozen=True, slots=True)
class CanvasEditIntent:
    """Change a typed target using the caller's observed value and source basis."""

    card_id: str
    target: CanvasEditTarget
    before: str
    after: str
    copy_of: str | None = None
    impact_fingerprint: str | None = None
