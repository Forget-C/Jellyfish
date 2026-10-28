"""摄影范围投影只使用显式声明；候选全卡不成为采用依据。"""
from app.core.contracts.generation_canvas import NarrativeReferencePayload, ObjectReferencePayload, OutputIdentity
from app.core.contracts.photography import PhotographyObjectUse, PhotographyEntry, PhotographyAdoptionScope, PhotographyTextPayload, PhotographyRequirement, FrameState
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

REGIONS = {'composition': {'shot_size': '景别', 'composition': '构图重心', 'frame_position': '画面位置', 'depth_layers': '空间层次', 'negative_space': '留白', 'composition_requirements': '构图要求'}, 'camera': {'viewpoint': '观察视点', 'position': '机位位置', 'height_angle': '高度与角度', 'lens_effect': '焦段与透视意图', 'support': '支撑方式'}, 'movement': {'movement_type': '运动方式', 'movement_start': '起始画面', 'movement_trigger': '触发条件', 'movement_path': '运动路径', 'movement_speed': '运动速度', 'end_frame': '结束画面'}, 'lighting': {'light_sources': '光源', 'light_direction': '光线方向', 'light_regions': '明暗区域', 'exposure_color': '曝光与色温', 'color_relationship': '色彩关系'}, 'focus': {'depth_focus': '景深与焦点', 'focus_change': '焦点变化', 'optical_effects': '光学效果', 'motion_texture': '运动质感', 'technical_parameters': '技术意图', 'adjacent_requirements': '相邻镜头衔接', 'prohibitions': '禁止项'}}
REGION_LABELS = {'composition': '景别与构图', 'camera': '机位与视角', 'movement': '运镜', 'lighting': '光影与色彩', 'focus': '焦点与成像'}

def render_photography(payload):
    """空和不适用不生成要求，否定与开放状态保留原意。"""
    roles = {'effect_object': '作用对象', 'attention_object': '关注对象', 'focus_object': '焦点对象'}
    lines = [f'{roles[use.input_port]}：{use.object.name}（{use.object.object_id}，{use.object.category}）' for use in payload.object_uses]
    if payload.shot:
        lines.append(f'所属镜头：{payload.shot.name}（{payload.shot.reference_id}）')
    from app.services.generation_canvas.guidance import acceptance_lines
    lines.extend(acceptance_lines(payload.acceptance_basis))
    lines.extend(f'{PURPOSE_LABELS[entry.value.purpose]} / {entry.label} [{STATE_LABELS[entry.value.state]}]：{entry.value.text}' +
                 (f'（来源：{entry.value.source_locator}）' if entry.value.source_locator else '')
                 for entry in payload.entries if entry.value.state not in ('empty', 'not_applicable') and (entry.value.text or entry.value.state == 'absent'))
    sizes = {'extreme_close_up': '大特写', 'close_up': '特写', 'medium': '中景', 'full': '全景', 'wide': '远景', 'extreme_wide': '大远景'}
    for requirement in payload.requirements:
        value = requirement.field
        if value.size and value.state not in ('empty', 'not_applicable'):
            lines.append(f'{PURPOSE_LABELS[value.purpose]} / 结构化景别 [{STATE_LABELS[value.state]}]：{sizes[value.size]}（目标：{value.target_id or "未指定"}；状态：{value.state_id or "同一画面"}）')
    if payload.scope.description:
        lines.append('适用范围：' + payload.scope.description)
    if payload.scope.phase:
        lines.append('制作阶段：' + payload.scope.phase)
    if payload.scope.condition:
        lines.append('适用条件：' + payload.scope.condition)
    if payload.source_locator:
        lines.append('来源：' + payload.source_locator)
    return '\n'.join(lines)


def publish_photography(canvas_id, card, adopted_inputs):
    """声明所有静态范围，合法清空仍可解析；删除的阶段不再声明。"""
    entries, scopes = [], [PhotographyAdoptionScope(id='whole', label='完整摄影设计', kind='whole')]
    for region, fields in REGIONS.items():
        scopes.append(PhotographyAdoptionScope(id='region:' + region, label=REGION_LABELS[region], kind='region'))
        for key, label in fields.items():
            entries.append(PhotographyEntry(id='field:' + key, label=label, region=region, value=getattr(card.fields, key)))
            scopes.append(PhotographyAdoptionScope(id='field:' + key, label=label, kind='field'))
    for phase in card.phases:
        entries.append(PhotographyEntry(id='phase:' + phase.id, label=phase.name, region='movement', value=phase.frame))
        scopes.append(PhotographyAdoptionScope(id='phase:' + phase.id, label=phase.name, kind='phase'))
    frames = [FrameState(id=entry.id, label=entry.label) for entry in entries if (entry.id in ('field:movement_start', 'field:end_frame') or entry.id.startswith('phase:')) and entry.value.state not in ('empty', 'not_applicable') and entry.value.text]
    objects = {item.payload.object_id: item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available}
    uses = [PhotographyObjectUse(input_port=binding.input_port, object=objects[binding.source.object_id]) for binding in card.input_bindings if binding.source.object_id in objects]
    from app.services.generation_canvas.guidance import adopted_acceptance
    payload = PhotographyTextPayload(text='', entries=entries, requirements=[PhotographyRequirement(entry_id='field:shot_size', field=card.fields.shot_size)], adoption_scopes=scopes, frame_states=frames,
        requires_frame_target=len(frames) > 1, acceptance_basis=adopted_acceptance(adopted_inputs), scope=card.scope, source_locator=card.source_locator,
        objects=list(objects.values()), object_uses=uses,
        shot=next((item.payload for item in adopted_inputs if isinstance(item.payload, NarrativeReferencePayload) and item.payload.category == 'shot' and item.available), None))
    payload.text = render_photography(payload)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]


def project_photography(item, selection):
    """投影文字及完整 used 载荷，保证无关区域变化不使局部依据失效。"""
    payload = item.payload
    if not isinstance(payload, PhotographyTextPayload):
        return (item, False) if selection is None else (item.model_copy(update={'available': False, 'payload': None, 'text': None}), True)
    chosen = ['whole'] if selection is None else selection
    declared = {scope.id for scope in payload.adoption_scopes}
    if not chosen or any(key not in declared for key in chosen):
        return item.model_copy(update={'available': False, 'payload': None, 'text': None}), True
    entries = [entry for entry in payload.entries if 'whole' in chosen or entry.id in chosen or 'region:' + entry.region in chosen]
    ids = {entry.id for entry in entries}
    frames = [frame for frame in payload.frame_states if frame.id in ids]
    regions = {entry.region for entry in entries}
    uses = [use for use in payload.object_uses if use.input_port == 'effect_object' or use.input_port == 'attention_object' and 'movement' in regions or use.input_port == 'focus_object' and 'focus' in regions]
    objects = list({use.object.object_id: use.object for use in uses}.values())
    projected = payload.model_copy(update={'objects': objects, 'object_uses': uses, 'entries': entries, 'requirements': [requirement for requirement in payload.requirements if requirement.entry_id in ids], 'adoption_scopes': [scope for scope in payload.adoption_scopes if scope.id in chosen], 'frame_states': frames, 'requires_frame_target': len(frames) > 1})
    projected.text = render_photography(projected)
    return item.model_copy(update={'payload': projected, 'text': projected.text}), False



def validate_frame_requirements(card, result, issue):
    """只比较同一显式目标／状态的已知单值硬要求；不推断文本或适用范围。"""
    seen = {}
    for item in result.used:
        if not isinstance(item.payload, PhotographyTextPayload):
            continue
        for requirement in item.payload.requirements:
            value = requirement.field
            if value.state != 'fact' or value.purpose == 'background' or not value.size or not value.target_id:
                continue
            if card.type == 'model.image' and value.state_id:
                binding_ids = {binding.id for binding in card.input_bindings if binding.source == item.source}
                selected = {target.state_id for target in card.frame_targets if target.binding_id in binding_ids}
                if selected and value.state_id not in selected:
                    continue
            key = value.target_id, value.state_id
            if key in seen and seen[key] != value.size:
                issue('CONFLICTING_FRAME_REQUIREMENTS', '同一目标和状态存在互斥的必须景别，请调整或取消其中一项', item.source.card_id, ['input_bindings'])
            seen[key] = value.size
