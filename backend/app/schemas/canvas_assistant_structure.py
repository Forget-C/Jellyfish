"""Typed operations for adding canvas cards and adopting a reference image."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class AddTextCard(BaseModel):
    """Create an independent content card with the proposed text."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_text_card'] = Field(json_schema_extra={'enum': ['add_text_card']})
    text: str = Field(max_length=16000)


class AddModelCard(BaseModel):
    """Create a model card with an optional initial plain-text prompt."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_model_card'] = Field(json_schema_extra={'enum': ['add_model_card']})
    modality: Literal['text', 'image', 'video']
    prompt: str = Field(default='', max_length=16000)


class AddMovementCard(BaseModel):
    """Create a storyboard movement design with an initial camera instruction."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_movement_card'] = Field(json_schema_extra={'enum': ['add_movement_card']})
    movement_speed: str = Field(default='', max_length=16000)


class AdoptFirstFrame(BaseModel):
    """Use an image attached to the current request for a scoped video card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['adopt_first_frame']
    card_id: str
    file_id: str


class ReplaceFirstFrame(AdoptFirstFrame):
    """Replace the current first frame when the user explicitly asks to change it."""

    kind: Literal['replace_first_frame'] = Field(json_schema_extra={'enum': ['replace_first_frame']})


MovementFieldName = Literal[
    'movement_type', 'movement_start', 'movement_trigger', 'movement_path', 'movement_speed', 'end_frame'
]


class AdjustShotMovement(BaseModel):
    """Find and edit the movement design actually adopted by a video card."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['adjust_shot_movement'] = Field(json_schema_extra={'enum': ['adjust_shot_movement']})
    card_id: str
    field: MovementFieldName
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]


ProposedStructure = Annotated[
    AddTextCard | AddModelCard | AddMovementCard | AdoptFirstFrame | ReplaceFirstFrame | AdjustShotMovement,
    Field(discriminator='kind')
]


class AddCanvasCardTarget(BaseModel):
    """Retain the proposed card identity and typed initial fields for approval."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_canvas_card'] = Field(json_schema_extra={'enum': ['add_canvas_card']})
    card: Annotated[AddTextCard | AddModelCard | AddMovementCard, Field(discriminator='kind')]


class AdoptFirstFrameTarget(BaseModel):
    """Freeze the attachment and relevant target state for atomic adoption."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['adopt_first_frame'] = Field(json_schema_extra={'enum': ['adopt_first_frame']})
    file_id: str
    file_name: str
    reference_card_id: str
    edge_id: str
    basis: str
    replaces_binding_id: str | None = None



class AdjustShotMovementTarget(BaseModel):
    """Approval basis and identities for an edit limited to one shot."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['adjust_shot_movement'] = Field(json_schema_extra={'enum': ['adjust_shot_movement']})
    movement_field: MovementFieldName
    movement_card_id: str
    binding_id: str
    connection_id: str
    basis: str
    other_consumer_ids: list[str]
    copy_card_id: str | None = None
