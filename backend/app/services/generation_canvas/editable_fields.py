"""Plain-text field operations used by canvas edit previews."""

from dataclasses import dataclass

from app.core.contracts.generation_canvas import DesignField
from app.schemas.canvas_edit_intents import (
    CanvasEditTarget, CardTextEdit, DesignTextFieldEdit, ModelPromptSegmentEdit, MovementFieldEdit, ReferenceNameEdit,
    VideoDurationEdit, VideoPromptSegmentEdit,
)
from app.schemas.generation_canvas import (
    CreativeBasisCard, ModelCard, MovementCard, NamedImageReferenceCard, ObjectDescriptionCard, PromptText,
    TextContentCard, VideoModelCard, VideoModelConfig,
)
from app.services.generation_canvas.catalog import design_fields
from app.services.generation_canvas.errors import diagnostic


EDITABLE_CONTENT_TYPES = (TextContentCard, CreativeBasisCard, ObjectDescriptionCard)


@dataclass
class _VideoDuration:
    config: VideoModelConfig

    @property
    def text(self) -> str:
        return str(self.config.seconds or '')

    @text.setter
    def text(self, value: str) -> None:
        self.config.seconds = int(value)


@dataclass
class _ReferenceName:
    card: NamedImageReferenceCard

    @property
    def text(self) -> str:
        return self.card.name

    @text.setter
    def text(self, value: str) -> None:
        self.card.name = value


def editable_text(card, target: CanvasEditTarget):
    """Find a plain-text field that can be edited without replacing its references."""
    if isinstance(target, VideoDurationEdit) and isinstance(card, VideoModelCard):
        return _VideoDuration(card.config)
    if isinstance(target, ReferenceNameEdit) and isinstance(card, NamedImageReferenceCard):
        if not (card.name_binding or card.scene_object_source):
            return _ReferenceName(card)
    if isinstance(target, CardTextEdit) and isinstance(card, EDITABLE_CONTENT_TYPES):
        return card
    if isinstance(target, MovementFieldEdit) and isinstance(card, MovementCard):
        field = getattr(card.fields, target.field)
        # A structured field can own references. This operation only edits plain text.
        if field.document is None:
            return field
    if isinstance(target, DesignTextFieldEdit) and card is not None:
        if any(definition.id == target.field_name for definition in design_fields(type(card))):
            field = getattr(getattr(card, 'fields', card), target.field_name, None)
            if isinstance(field, DesignField) and getattr(field, 'document', None) is None and not hasattr(field, 'size'):
                return field
    if isinstance(card, ModelCard) and (
        isinstance(target, ModelPromptSegmentEdit)
        or isinstance(card, VideoModelCard) and isinstance(target, VideoPromptSegmentEdit)
    ):
        return next((part for part in card.prompt.segments
                     if isinstance(part, PromptText) and part.id == target.segment_id), None)
    return None


def normalize_text(target: CanvasEditTarget, text: str) -> str:
    """Validate constraints that apply to both model and ordinary callers."""
    if isinstance(target, ReferenceNameEdit) and len(text) > 255:
        raise diagnostic('INVALID_EDIT_VALUE', 'Reference names must be at most 255 characters', {})
    if isinstance(target, VideoDurationEdit):
        try:
            seconds = int(text)
            if seconds > 0:
                return str(seconds)
        except ValueError:
            pass
        raise diagnostic('INVALID_EDIT_VALUE', 'Enter the duration as a positive number of seconds', {})
    return text


def apply_text(card, field, target: CanvasEditTarget, text: str) -> None:
    """Update editable text and record manual authorship where applicable."""
    field.text = normalize_text(target, text)
    if isinstance(field, DesignField):
        field.authorship = 'user'
        field.extraction_context = None
        field.extraction_reason = None
    elif isinstance(card, VideoModelCard) and card.generated_prompt and not isinstance(target, VideoDurationEdit):
        card.generated_prompt.edit_confirmed = True
