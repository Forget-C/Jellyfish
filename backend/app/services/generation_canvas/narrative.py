"""叙事设计只发布本卡内容；故事对象引用与全文输出分开。"""
from app.core.contracts.generation_canvas import (
    CriterionReferencePayload, FrameState, DesignField, DesignTextPayload, NarrativeOverviewFields, NarrativeBeatFields,
    NarrativeEventFields, ShotDesignFields, NarrativeReferencePayload,
    NarrativeDesignRelation, ObjectReferencePayload, SpatialReferencePayload, OutputIdentity,
)
from app.schemas.generation_canvas import NarrativeDirectionCard, CanvasResolvedOutput
from app.services.generation_canvas.formatting import scope_source_lines
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS
from app.services.generation_canvas.errors import diagnostic

FIELD_TYPES = {'direction.narrative': NarrativeOverviewFields, 'direction.beat': NarrativeBeatFields,
               'direction.event': NarrativeEventFields, 'direction.shot': ShotDesignFields}
FIELD_LABELS = {'viewpoint': '观察视点', 'information_change': '信息变化', 'relationship_change': '人物关系变化',
                'turning_point': '关键转折', 'open_questions': '待确定问题', 'objective': '行动目标',
                'obstacle': '阻碍', 'expected_change': '预期变化', 'audience_must_see': '必须让观众看到',
                'action_change': '动作或变化说明', 'narrative_role': '叙事作用', 'visible_result': '可见结果', 'estimated_duration': '预计时长'}
RELATION_LABELS = {'participant': '参与对象', 'effect_object': '作用对象', 'covered_beat': '覆盖节拍',
                   'related_event': '关联事件', 'blocking_basis': '调度依据', 'beat': '所属节拍',
                   'received_event': '接收事件', 'change_event': '变化事件', 'trigger_event': '触发事件', 'shot': '所属镜头'}
REFERENCE_TYPES = (ObjectReferencePayload, SpatialReferencePayload, NarrativeReferencePayload)


def direct_relations(card, adopted_inputs):
    """只记录明确采用的直接身份和用途，不读取祖先设计。"""
    return [NarrativeDesignRelation(input_port=binding.input_port, reference=item.payload)
            for binding in card.input_bindings for item in adopted_inputs
            if item.source == binding.source and item.available and isinstance(item.payload, REFERENCE_TYPES)]


def relation_lines(relations):
    """名称用于展示；稳定身份不从名称推断。"""
    return [f'{RELATION_LABELS.get(row.input_port, row.input_port)}：{row.reference.name}（{row.reference.object_id if isinstance(row.reference, ObjectReferencePayload) else row.reference.reference_id}）'
            for row in relations]


def publish_narrative(canvas_id, card, adopted_inputs):
    """默认整卡输出；节拍、事件、镜头的引用出口不携带正文。"""
    field_type = FIELD_TYPES[card.type]
    fields = field_type(**{key: getattr(card, key) for key in field_type.model_fields})
    relations = direct_relations(card, adopted_inputs)
    from app.services.generation_canvas.guidance import adopted_acceptance, acceptance_lines
    acceptance = adopted_acceptance(adopted_inputs)
    lines = ['名称：' + card.name] if card.name.strip() else []
    lines.extend(relation_lines(relations))
    lines.extend(acceptance_lines(acceptance))
    lines.extend(f'{PURPOSE_LABELS[field.purpose]} / {FIELD_LABELS[key]} [{STATE_LABELS[field.state]}]：{field.text}' + (f'（来源：{field.source_locator}）' if field.source_locator else '')
                 for key in field_type.model_fields if isinstance((field := getattr(fields, key)), DesignField) and field.state not in ('empty', 'not_applicable') and (field.text or field.state == 'absent'))
    lines.extend(scope_source_lines(card.scope, card.source_locator))
    outputs = []
    if lines:
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text',
            payload=DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=fields, scope=card.scope,
                objects=[row.reference for row in relations if isinstance(row.reference, ObjectReferencePayload)],
                references=[row.reference for row in relations if isinstance(row.reference, (SpatialReferencePayload, NarrativeReferencePayload))],
                narrative_relations=relations, acceptance_basis=acceptance, source_locator=card.source_locator,
                frame_states=[FrameState(id='field:visible_result', label='可见结果')] if card.type == 'direction.shot' and card.visible_result.state not in ('empty', 'not_applicable') and card.visible_result.text else [])))
    category = card.type.removeprefix('direction.')
    identifier = getattr(card, category + '_id', None)
    if identifier and card.name.strip():
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id=category, position=0, object_id=identifier), modality='text',
            payload=NarrativeReferencePayload(category=category, reference_id=identifier, name=card.name.strip())))
    return outputs


def narrative_binding_allowed(port, payload):
    """按接收用途限制对象类别，避免把名称或设计全文当身份。"""
    if isinstance(payload, CriterionReferencePayload):
        return port == 'acceptance_basis'
    if isinstance(payload, ObjectReferencePayload):
        return port == 'effect_object' or port == 'participant' and payload.category in ('character', 'prop', 'costume')
    if isinstance(payload, SpatialReferencePayload):
        return port == 'blocking_basis' and payload.category == 'blocking'
    if isinstance(payload, NarrativeReferencePayload):
        return (payload.category == 'beat' and port in ('beat', 'covered_beat') or
                payload.category == 'event' and port in ('related_event', 'received_event', 'change_event', 'trigger_event') or
                payload.category == 'shot' and port == 'shot')
    return False


def validate_narrative_relations(document, published, previous, *, context=None):
    """稳定身份及直接关系校验；所有候选仍由统一 DAG 检查。"""
    from app.services.generation_canvas.design_bindings import inspect_design_bindings
    identities, names = set(), set()
    for card in document.cards:
        if not isinstance(card, NarrativeDirectionCard):
            continue
        category = card.type.removeprefix('direction.')
        field = category + '_id'
        value = getattr(card, field, None)
        old = next((item.get(field) for item in previous.get('cards', []) if item['id'] == card.id), None)
        target = {'card_id': card.id, 'path': [field]}
        if old and old != value:
            raise diagnostic('IMMUTABLE_NARRATIVE_IDENTITY', '已建立故事对象身份不可修改', target)
        if value:
            if (category, value) in identities:
                raise diagnostic('DUPLICATE_NARRATIVE_IDENTITY', '独立故事对象身份必须唯一', target)
            identities.add((category, value))
        if card.name.strip():
            key = (category, card.name.strip())
            if key in names:
                raise diagnostic('DUPLICATE_NARRATIVE_NAME', '同类故事对象名称必须唯一', {'card_id': card.id, 'path': ['name']})
            names.add(key)
        for check in inspect_design_bindings(document, card, card.input_bindings, published, context=context):
            binding, item = check.binding, check.output
            if not check.binding_valid or not item:
                raise diagnostic('INVALID_NARRATIVE_BINDING', '请选择直接候选中的明确关系', {'card_id': card.id, 'path': ['input_bindings', binding.id]})
            if not narrative_binding_allowed(binding.input_port, item.payload):
                raise diagnostic('INVALID_NARRATIVE_CATEGORY', '对象类别不适用于此叙事关系', {'card_id': card.id, 'path': ['input_bindings', binding.id]})
