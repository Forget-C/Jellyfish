"""独立构图完整发布文字与结构化景别，不推断运镜关联。"""
from app.core.contracts.generation_canvas import DesignTextPayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

COMPOSITION_LABELS = {'shot_size': '景别', 'composition': '构图重心', 'frame_position': '画面位置', 'depth_layers': '空间层次', 'negative_space': '留白', 'composition_requirements': '构图要求'}
SHOT_SIZE_LABELS = {'extreme_close_up': '大特写', 'close_up': '特写', 'medium': '中景', 'full': '全身', 'wide': '远景', 'extreme_wide': '大远景'}


def publish_composition(canvas_id, card):
    """保留字段状态与结构化景别；空白不虚构设计要求。"""
    lines = []
    for key, value in card.fields:
        text = value.text
        if key == 'shot_size' and value.size:
            text = ' / '.join(filter(None, [SHOT_SIZE_LABELS[value.size], text]))
        if value.state not in ('empty', 'not_applicable') and (text or value.state == 'absent'):
            lines.append(f'{PURPOSE_LABELS[value.purpose]} / {COMPOSITION_LABELS[key]} [{STATE_LABELS[value.state]}]：{text}')
    for label, value in (('适用范围', card.scope.description), ('制作阶段', card.scope.phase), ('适用条件', card.scope.condition), ('来源', card.source_locator)):
        if value:
            lines.append(label + '：' + value)
    if card.frame_target:
        lines.append(f'画面定位：{card.frame_target.card_id} / {card.frame_target.state_id}')
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields,
                                scope=card.scope, source_locator=card.source_locator)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]


def resolve_frame_target(card, cards):
    """只读取显式运镜目标字段，不遍历其引用或收集媒体。"""
    from app.core.contracts.generation_canvas import ResolvedDesignFrameTarget
    from app.schemas.generation_canvas import MovementCard
    target = card.frame_target
    movement = cards.get(target.card_id)
    label, frame = '', None
    if isinstance(movement, MovementCard):
        if target.state_id == 'field:movement_start':
            label, frame = '起始画面', movement.fields.movement_start
        elif target.state_id == 'field:end_frame':
            label, frame = '结束画面', movement.fields.end_frame
        elif target.state_id.startswith('phase:'):
            phase = next((phase for phase in movement.phases if 'phase:' + phase.id == target.state_id), None)
            if phase:
                label, frame = phase.name, phase.frame
    available = bool(frame and frame.state not in ('empty', 'not_applicable') and frame.text.strip())
    return ResolvedDesignFrameTarget(target=target, available=available, label=label, frame=frame)


def validate_composition_requirements(card, result, issue):
    """比较相同明确目标上的必须景别，开放提议不成为硬冲突。"""
    from app.core.contracts.generation_canvas import DesignTextPayload
    seen = {}
    selected = {binding.source.card_id: target.state_id for binding in card.input_bindings
                for target in getattr(card, 'frame_targets', []) if target.binding_id == binding.id}
    for item in result.used:
        payload = item.payload
        if not isinstance(payload, DesignTextPayload) or payload.design_type != 'direction.composition':
            continue
        value = payload.fields.shot_size
        if value.state != 'fact' or value.purpose == 'background' or not value.size:
            continue
        target = payload.frame_target_state
        if target:
            if not target.available or selected.get(target.target.card_id, target.target.state_id) != target.target.state_id:
                continue
            key = target.target.card_id, target.target.state_id
        elif value.target_id:
            key = value.target_id, value.state_id
        else:
            continue
        if key in seen and seen[key] != value.size:
            issue('CONFLICTING_FRAME_REQUIREMENTS', '同一目标和状态存在互斥的必须景别，请调整或取消其中一项', item.source.card_id, ['input_bindings'])
        seen[key] = value.size
