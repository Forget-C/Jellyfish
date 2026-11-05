"""完整约束输出只使用本卡字段及明确直接身份；证据不随文本传输。"""
from app.core.contracts.generation_canvas import (
    SpaceRuleFields, ContinuityFields, ImmutableFactFields, DesignTextPayload,
    FrameState, ObjectReferencePayload, OutputIdentity,
)
from app.schemas.generation_canvas import CanvasResolvedOutput
from app.services.generation_canvas.formatting import scope_source_lines, design_field_line
from app.services.generation_canvas.narrative import direct_relations, relation_lines

FIELD_TYPES = {'direction.space_rule': SpaceRuleFields, 'direction.continuity': ContinuityFields, 'direction.fact': ImmutableFactFields}
FIELD_LABELS = {'spatial_basis': '空间依据', 'shootable_area': '可拍区域', 'axis': '轴线', 'scale': '空间尺度', 'before': '前态', 'change': '变化', 'after': '后态', 'following_constraints': '后续约束', 'fact': '不可改事实', 'source_basis': '来源依据'}
CATEGORY_LABELS = {'space': '空间', 'appearance': '造型', 'hands_props': '手部与道具', 'environment': '环境', 'photography': '摄影', 'dialogue_sound': '对白与声音'}


def publish_constraint(canvas_id, card, adopted_inputs):
    """整卡采用保留所有状态；图片画面目标仅选择明确前态或后态。"""
    field_type = FIELD_TYPES[card.type]
    fields = field_type(**{key: getattr(card, key) for key in field_type.model_fields})
    relations = direct_relations(card, adopted_inputs)
    lines = relation_lines(relations)
    if card.type == 'direction.continuity':
        lines.append('连续性分类：' + CATEGORY_LABELS[card.category])
    active = {key: field for key in field_type.model_fields if (field := getattr(fields, key)).state not in ('empty', 'not_applicable') and (field.text or field.state == 'absent')}
    lines.extend(design_field_line(FIELD_LABELS[key], field) for key, field in active.items())
    lines.extend(scope_source_lines(card.scope, card.source_locator))
    if not lines:
        return []
    states = [FrameState(id='field:' + key, label=FIELD_LABELS[key]) for key in ('before', 'after') if key in active]
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text',
        payload=DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=fields, scope=card.scope,
            objects=[row.reference for row in relations if isinstance(row.reference, ObjectReferencePayload)],
            narrative_relations=relations, source_locator=card.source_locator, frame_states=states, requires_frame_target=len(states) > 1))]


def constraint_binding_allowed(port, payload):
    """按接收字段判断资格，不用显示名称或相同图片猜测身份。"""
    from app.core.contracts.generation_canvas import NarrativeReferencePayload, SpatialReferencePayload
    if isinstance(payload, ObjectReferencePayload):
        return port == 'effect_object' or port == 'space' and payload.category == 'place' or port == 'participant' and payload.category in ('character', 'prop', 'costume')
    if isinstance(payload, NarrativeReferencePayload):
        return port == 'related_event' and payload.category == 'event' or port == 'effect_object'
    return port == 'effect_object' and isinstance(payload, SpatialReferencePayload)


def validate_constraint_relations(document, published, *, context=None):
    """关系与示例独立校验，候选未采用时不要求绑定完整。"""
    from app.schemas.generation_canvas import ConstraintDirectionCard
    from app.services.generation_canvas.design_bindings import inspect_design_bindings
    from app.services.generation_canvas.errors import diagnostic
    for card in document.cards:
        if not isinstance(card, ConstraintDirectionCard):
            continue
        counts = {}
        for check in inspect_design_bindings(document, card, card.input_bindings, published, context=context):
            binding, item = check.binding, check.output
            target = {'card_id': card.id, 'path': ['input_bindings', binding.id]}
            if not check.binding_valid or not item:
                raise diagnostic('INVALID_CONSTRAINT_BINDING', '请选择直接候选中的明确关系', target)
            if not constraint_binding_allowed(binding.input_port, item.payload):
                raise diagnostic('INVALID_CONSTRAINT_CATEGORY', '对象类别不适用于此约束关系', target)
            counts.setdefault(binding.input_port, set()).add(binding.source.object_id)
        if any(len(counts.get(port, set())) > 1 for port in ('space', 'participant', 'related_event')):
            raise diagnostic('CONSTRAINT_RELATION_COUNT', '所属空间、参与对象和关联事件各至多一个', {'card_id': card.id, 'path': ['input_bindings']})
        for example in card.examples:
            field = example.field_id
            if field and field not in FIELD_TYPES[card.type].model_fields or example.purpose in ('before', 'after') and (card.type != 'direction.continuity' or field != example.purpose):
                raise diagnostic('INVALID_CONSTRAINT_EXAMPLE_FIELD', '素材用途须定位本卡对应字段，前后态须分别定位', {'card_id': card.id, 'path': ['examples', example.id]})
