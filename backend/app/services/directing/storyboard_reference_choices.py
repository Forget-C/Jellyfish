"""Carry explicit reference choices across a compatible extracted graph."""

from app.core.contracts.generation_canvas import InputBinding, OutputIdentity
from app.schemas.generation_canvas import GenerationCanvasEdge, ModelCard, NamedImageReferenceCard


def expired_reference_uses(current, candidate, retained, cards):
    """Only detach a managed input whose original object no longer applies to that production card."""
    if not current.storyboard:
        return {}
    allowed = {(shot.shot_id, use.model_card_id, use.object_id) for shot in candidate.storyboard.shots for use in shot.reference_uses}
    defaults = {obj.object_id: obj.reference_card_id for obj in current.storyboard.objects}
    expired = {}
    for shot in current.storyboard.shots:
        for use in shot.reference_uses:
            if not use.active or use.model_card_id not in retained or (shot.shot_id, use.model_card_id, use.object_id) in allowed:
                continue
            model = cards.get(use.model_card_id)
            source = shot.reference_overrides.get(use.object_id, defaults.get(use.object_id))
            if isinstance(model, ModelCard):
                for binding in model.input_bindings:
                    if binding.id == use.binding_id and binding.source.card_id == source and binding.source.port_id == 'image':
                        expired.setdefault(model.id, {})[binding.id] = binding
    return expired


def carry_reference_choices(current, candidate, cards, kept, edges, order, production_ports, invalidated):
    """Keep shot overrides by identity and retain manual cancellations on kept models."""
    previous_shots = {shot.shot_id: shot for shot in current.storyboard.shots} if current.storyboard else {}
    defaults = {obj.object_id: obj.reference_card_id for obj in candidate.storyboard.objects}
    shots = []
    for shot in candidate.storyboard.shots:
        prior = previous_shots.get(shot.shot_id)
        allowed = {(use.object_id, use.model_card_id) for use in shot.reference_uses if use.model_card_id in cards}
        overrides = {object_id: card_id for object_id, card_id in (prior.reference_overrides.items() if prior else ())
                     if object_id in shot.object_ids and object_id in defaults and _reference(cards.get(card_id), object_id)}
        uses = [use for use in shot.reference_uses if use.model_card_id not in kept]
        if prior:
            uses.extend(use for use in prior.reference_uses if use.model_card_id in kept and (use.object_id, use.model_card_id) in allowed)
        actual = []
        for use in uses:
            default = defaults.get(use.object_id)
            card_id = overrides.get(use.object_id, default)
            reference = cards.get(card_id)
            valid = _reference(reference, use.object_id)
            if use.model_card_id in kept:
                if valid:
                    actual.append(use.model_copy(update={'active': False}) if (card_id, 'image') in invalidated else use)
                continue
            model = cards.get(use.model_card_id)
            port = {'model.image': 'image', 'model.video': 'subject_image'}.get(model.type) if isinstance(model, ModelCard) else None
            if not valid:
                if use.active:
                    _set_extracted_reference(current.id, model, use.binding_id, None, port, False, '', edges, order)
                continue
            active = bool(port and port in production_ports and reference.image_binding)
            if active != use.active or card_id != default:
                label = getattr(cards.get(default), 'name', '') or reference.name
                _set_extracted_reference(current.id, model, use.binding_id, reference, port, active, label, edges, order)
            actual.append(use.model_copy(update={'active': active}))
        shots.append(shot.model_copy(update={'reference_uses': actual, 'reference_overrides': overrides}))
    return shots


def _reference(card, object_id):
    return isinstance(card, NamedImageReferenceCard) and (
        card.name_binding.object_id if card.name_binding else card.object_id or card.id) == object_id


def _set_extracted_reference(canvas_id, model, binding_id, reference, port, active, label, edges, order):
    if not isinstance(model, ModelCard) or not port:
        return
    old = next((binding for binding in model.input_bindings if binding.id == binding_id), None)
    if old:
        edges[:] = [edge for edge in edges if edge.id != binding_id]
        model.input_bindings = [binding for binding in model.input_bindings if binding.id != binding_id]
    sequence = order.setdefault(model.id, {}).setdefault(port, [])
    if not active:
        order[model.id][port] = [edge_id for edge_id in sequence if edge_id != binding_id]
        return
    source = OutputIdentity(canvas_id=canvas_id, card_id=reference.id, port_id='image', position=0)
    model.input_bindings.append(InputBinding(id=binding_id, source=source, input_port=port, prompt_owned=False,
        subject_name=label if port == 'subject_image' else None))
    edges.append(GenerationCanvasEdge(id=binding_id, source_card=reference.id, source_port='image',
                                      target_card=model.id, target_port=port))
    if binding_id not in sequence:
        sequence.append(binding_id)
