"""Camera, lighting and focus publish complete designs without scope projection."""
from app.core.contracts.generation_canvas import DesignTextPayload, NarrativeReferencePayload, ObjectReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.guidance import adopted_acceptance, acceptance_lines
from app.services.generation_canvas.formatting import design_field_line
from app.services.generation_canvas.photography import REGIONS


def publish_static_design(canvas_id, card, adopted_inputs):
    """Publish active own fields and adopted relationships, never ancestor media."""
    labels = REGIONS[card.type.split('.')[1]]
    lines = [design_field_line(labels[key], value, source=False)
             for key, value in card.fields if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    objects = {item.payload.object_id: item.payload for item in adopted_inputs if item.available and isinstance(item.payload, ObjectReferencePayload)}
    roles = {'effect_object': '作用对象', 'attention_object': '关注对象', 'focus_object': '焦点对象'}
    for binding in card.input_bindings:
        if binding.input_port in roles and binding.source.object_id in objects:
            obj = objects[binding.source.object_id]
            lines.append(f'{roles[binding.input_port]}：{obj.name}（{obj.object_id}）')
    references = [item.payload for item in adopted_inputs if item.available and isinstance(item.payload, NarrativeReferencePayload) and item.payload.category == 'shot']
    lines.extend(f'所属镜头：{ref.name}（{ref.reference_id}）' for ref in references)
    for value, label in ((card.scope.description, '适用范围'), (card.scope.phase, '制作阶段'), (card.scope.condition, '适用条件'), (card.source_locator, '来源')):
        if value:
            lines.append(label + '：' + value)
    acceptance = adopted_acceptance(adopted_inputs)
    lines.extend(acceptance_lines(acceptance))
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields, scope=card.scope,
                                source_locator=card.source_locator, objects=list(objects.values()), references=references, acceptance_basis=acceptance)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]
