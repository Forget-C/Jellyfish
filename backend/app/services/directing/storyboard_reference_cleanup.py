"""Preserve retained text and detach invalid workbench adoption before a common save."""

from app.core.contracts.generation_canvas import DesignFieldText, DesignFrameTarget
from app.schemas.generation_canvas import ModelCard, NamedImageReferenceCard, PromptInstruction, PromptReference, PromptText
from app.services.generation_canvas.catalog import CARD_TITLES
from app.services.generation_canvas.composition import frame_target_field
from app.services.generation_canvas.design_references import design_fields


def card_name(card):
    """Use the card's visible name or the catalog label without expanding its body."""
    return getattr(card, 'name', '').strip() or CARD_TITLES[card.type]


def clean_lost_references(card, before, after, canvas_id: str, expired=None, invalidated=None) -> set[str]:
    """Remove actual adoption and translate only body references to the old name."""
    lost = set()

    def removed(source):
        if source and source.canvas_id == canvas_id and source.card_id in before and (
                source.card_id not in after or invalidated and (source.card_id, source.port_id) in invalidated):
            lost.add(source.card_id)
            return True
        return False

    removed_bindings = {binding.id: binding.source for binding in getattr(card, 'input_bindings', ()) if removed(binding.source)}
    for key, binding in (expired or {}).items():
        removed_bindings[key] = binding.source
        lost.add(binding.source.card_id)
    if removed_bindings:
        card.input_bindings = [binding for binding in card.input_bindings if binding.id not in removed_bindings]
    if isinstance(card, ModelCard):
        segments = []
        for segment in card.prompt.segments:
            if isinstance(segment, PromptReference) and segment.binding_id in removed_bindings:
                source = removed_bindings[segment.binding_id]
                segments.append(PromptText(id=segment.id, kind='text', text=_plain_prompt_name(card_name(before[source.card_id]))))
            elif isinstance(segment, PromptInstruction):
                references = [ref for ref in segment.references if ref.binding_id not in removed_bindings]
                if len(references) == len(segment.references):
                    segments.append(segment)
                elif references:
                    segments.append(segment.model_copy(update={'references': references}))
            else:
                segments.append(segment)
        card.prompt.segments = segments
    if hasattr(card, 'design_media_uses'):
        card.design_media_uses = [item for item in card.design_media_uses if not removed(item.source)]
    if hasattr(card, 'frame_targets'):
        bindings = {binding.id: binding for binding in card.input_bindings}
        card.frame_targets = [target for target in card.frame_targets if target.binding_id in bindings and
                              _keep_model_frame(target, bindings[target.binding_id].source.card_id, before, after, lost)]
    if getattr(card, 'frame_target', None):
        target = card.frame_target
        if target.card_id in before and (target.card_id not in after or (
                frame_target_field(target, before)[0] and not frame_target_field(target, after)[0])):
            lost.add(target.card_id)
            card.frame_target = None
    if hasattr(card, 'examples'):
        card.examples = [item for item in card.examples if not removed(item.source)]
    if isinstance(card, NamedImageReferenceCard):
        if removed(card.name_binding):
            card.name_binding = None
        if card.image_binding and removed(card.image_binding.source):
            card.image_binding = None
    for _, field, _ in design_fields(card):
        if not field.document:
            continue
        field.document.segments = [
            DesignFieldText(id=segment.id, kind='text', text=card_name(before[segment.source.card_id]), literal=True)
            if segment.kind == 'reference' and removed(segment.source) else segment
            for segment in field.document.segments
        ]
    return lost


def _plain_prompt_name(name: str) -> str:
    # The prompt compiler unescapes these characters without recognizing a new token.
    return name.replace('@', r'\@').replace('/', r'\/')


def _keep_model_frame(target, source_id, before, after, lost):
    frame = DesignFrameTarget(card_id=source_id, state_id=target.state_id)
    if not frame_target_field(frame, before)[0] or frame_target_field(frame, after)[0]:
        return True
    lost.add(source_id)
    return False
