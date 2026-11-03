"""独立构图完整发布文字与结构化景别，不推断运镜关联。"""
from app.core.contracts.generation_canvas import DesignTextPayload, ObjectReferencePayload, NarrativeReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

COMPOSITION_LABELS = {'shot_size': '景别', 'composition': '构图重心', 'frame_position': '画面位置', 'depth_layers': '空间层次', 'negative_space': '留白', 'composition_requirements': '构图要求'}
SHOT_SIZE_LABELS = {'extreme_close_up': '大特写', 'close_up': '特写', 'medium': '中景', 'full': '全身', 'wide': '远景', 'extreme_wide': '大远景'}


def publish_composition(canvas_id, card, adopted_inputs):
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
    objects = {item.payload.object_id: item.payload for item in adopted_inputs if item.available and isinstance(item.payload, ObjectReferencePayload)}
    roles = {'effect_object': '作用对象', 'attention_object': '关注对象'}
    for binding in card.input_bindings:
        if binding.input_port in roles and binding.source.object_id in objects:
            obj = objects[binding.source.object_id]
            lines.append(f'{roles[binding.input_port]}：{obj.name}（{obj.object_id}）')
    references = [item.payload for item in adopted_inputs if item.available and isinstance(item.payload, NarrativeReferencePayload) and item.payload.category == 'shot']
    lines.extend(f'所属镜头：{ref.name}（{ref.reference_id}）' for ref in references)
    from app.services.generation_canvas.guidance import adopted_acceptance, acceptance_lines
    acceptance = adopted_acceptance(adopted_inputs)
    lines.extend(acceptance_lines(acceptance))
    if card.frame_target:
        lines.append(f'画面定位：{card.frame_target.card_id} / {card.frame_target.state_id}')
    if not lines:
        return []
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=card.fields,
                                scope=card.scope, source_locator=card.source_locator, objects=list(objects.values()),
                                references=references, acceptance_basis=acceptance)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]


def frame_target_field(target, cards):
    """定位唯一明确画面；名称只作展示，稳定阶段身份决定关系。"""
    from app.schemas.generation_canvas import MovementCard
    movement = cards.get(target.card_id)
    if isinstance(movement, MovementCard):
        if target.state_id == 'field:movement_start':
            return movement, '起始画面', movement.fields.movement_start, 'movement_start'
        if target.state_id == 'field:end_frame':
            return movement, '结束画面', movement.fields.end_frame, 'end_frame'
        for phase in movement.phases:
            if target.state_id == 'phase:' + phase.id:
                return movement, phase.name, phase.frame, target.state_id
    return None, '', None, ''


def resolve_frame_target(card, context, *, model_outputs, allow_reference_drafts=False):
    """只规范化目标字段及其来源事实，不采用运镜正文或收集接收模型媒体。"""
    from app.core.contracts.generation_canvas import DesignField, DesignFrameDependency, ResolvedDesignFrameTarget
    from app.services.generation_canvas.design_references import resolve_design_card, design_field_references
    from app.services.generation_canvas.output_resolution import identity_key
    movement, label, frame, key = frame_target_field(card.frame_target, context.cards)
    dependencies, issues = [], []
    if movement:
        candidates = context.resolve_outputs(movement.id, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts)
        by_source = {identity_key(item.source): item for item in candidates}
        # 展示代号顺序不改变定位依据；稳定来源事实单独进入 metadata。
        tokens = {identity_key(item.source): '@' + item.modality for item in candidates}
        normalized, _, issues, _ = resolve_design_card(context, movement, model_outputs=model_outputs,
            allow_reference_drafts=allow_reference_drafts, reference_tokens=tokens, field_ids={key})
        _, _, frame, _ = frame_target_field(card.frame_target, {movement.id: normalized})
        seen = set()
        for reference, field_id, _ in design_field_references(movement, effective=True):
            if field_id != key:
                continue
            source_key = identity_key(reference.source)
            if source_key in seen:
                continue
            seen.add(source_key)
            item = by_source.get(source_key)
            dependencies.append(DesignFrameDependency(source=reference.source, available=bool(item and item.available),
                file_id=item.file_id if item else None, result_set_id=item.result_set_id if item else None,
                basis_current=item.basis_current if item else True))
    available = bool(frame and frame.state not in ('empty', 'not_applicable') and frame.text.strip() and not issues)
    normalized_frame = DesignField.model_validate(frame.model_dump(exclude={'document'})) if frame else None
    return ResolvedDesignFrameTarget(target=card.frame_target, available=available, label=label,
                                     frame=normalized_frame, dependencies=dependencies)


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
