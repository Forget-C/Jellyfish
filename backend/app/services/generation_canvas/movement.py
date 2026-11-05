"""独立运镜发布完整文字和画面状态，不提供局部采用投影。"""
from app.core.contracts.generation_canvas import DesignTextPayload, FrameState, NarrativeReferencePayload, ObjectReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.formatting import design_field_line
from app.services.generation_canvas.photography import REGIONS


def publish_movement(canvas_id, card, adopted_inputs):
    """阶段和字段保持明确状态；只对有效画面声明稳定定位身份。"""
    fields = [(f'field:{key}', REGIONS['movement'][key], value) for key, value in card.fields]
    fields += [(f'phase:{phase.id}', phase.name, phase.frame) for phase in card.phases]
    lines = [design_field_line(label, value)
             for _, label, value in fields if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    objects = list({item.payload.object_id: item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available}.values())
    roles = {'effect_object': '作用对象', 'attention_object': '关注对象'}
    for binding in card.input_bindings:
        obj = next((obj for obj in objects if obj.object_id == binding.source.object_id), None)
        if obj and binding.input_port in roles:
            lines.append(f'{roles[binding.input_port]}：{obj.name}（{obj.object_id}，{obj.category}）')
    shots = [item.payload for item in adopted_inputs if isinstance(item.payload, NarrativeReferencePayload) and item.payload.category == 'shot' and item.available]
    if shots:
        lines.append(f'所属镜头：{shots[0].name}（{shots[0].reference_id}）')
    frames = [FrameState(id=key, label=label) for key, label, value in fields
              if (key in ('field:movement_start', 'field:end_frame') or key.startswith('phase:'))
              and value.state not in ('empty', 'not_applicable') and value.text.strip()]
    if card.scope.description:
        lines.append('适用范围：' + card.scope.description)
    if card.scope.phase:
        lines.append('制作阶段：' + card.scope.phase)
    if card.scope.condition:
        lines.append('适用条件：' + card.scope.condition)
    if card.source_locator:
        lines.append('来源：' + card.source_locator)
    from app.services.generation_canvas.guidance import adopted_acceptance, acceptance_lines
    acceptance = adopted_acceptance(adopted_inputs)
    lines.extend(acceptance_lines(acceptance))
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields,
        movement_phases=card.phases, frame_states=frames, requires_frame_target=len(frames) > 1,
        scope=card.scope, source_locator=card.source_locator, acceptance_basis=acceptance,
        objects=objects, references=shots)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]
