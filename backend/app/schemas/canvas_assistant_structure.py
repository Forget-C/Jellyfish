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


class AddCatalogCard(BaseModel):
    """Add an empty card of a currently supported catalog type."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_catalog_card'] = Field(json_schema_extra={'enum': ['add_catalog_card']})
    card_type: str = Field(min_length=1, max_length=64)


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


class VideoTextUse(BaseModel):
    """Insert a dynamic text reference at a selected segment or after existing text."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['use_video_text'] = Field(json_schema_extra={'enum': ['use_video_text']})
    source_card: str
    target_card: str
    before_segment_id: str | None = None
    replace_segment_id: str | None = None


class VideoCharacterUse(BaseModel):
    """Use a named character image as an explicit video subject."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['use_video_character'] = Field(json_schema_extra={'enum': ['use_video_character']})
    position: int = Field(default=0, ge=0)
    before_segment_id: str | None = None
    source_card: str
    target_card: str
    subject_name: str = Field(min_length=1, max_length=255)


class VideoInputTarget(BaseModel):
    """Freeze the source, generated identities and previewed media for approval."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['adopt_video_input'] = Field(json_schema_extra={'enum': ['adopt_video_input']})
    adds_edge: bool
    use: Annotated[VideoTextUse | VideoCharacterUse, Field(discriminator='kind')]
    identity: str
    file_id: str | None = None


class ConnectCards(BaseModel):
    """Connect two in-scope cards with compatible candidate ports."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['connect_cards'] = Field(json_schema_extra={'enum': ['connect_cards']})
    source_card: str
    source_port: str
    target_card: str
    target_port: str


class ConnectCardsTarget(ConnectCards):
    """Freeze the identity and endpoints of a candidate connection."""

    connection_id: str


ProposedStructure = Annotated[
    AddTextCard | AddModelCard | AddMovementCard | AddCatalogCard | AdoptFirstFrame | ReplaceFirstFrame
    | AdjustShotMovement | ConnectCards,
    Field(discriminator='kind')
]


class AddCanvasCardTarget(BaseModel):
    """Retain the proposed card identity and typed initial fields for approval."""

    model_config = ConfigDict(extra='forbid')
    kind: Literal['add_canvas_card'] = Field(json_schema_extra={'enum': ['add_canvas_card']})
    card: Annotated[AddTextCard | AddModelCard | AddMovementCard | AddCatalogCard, Field(discriminator='kind')]


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
