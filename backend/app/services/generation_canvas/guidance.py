"""本卡创作要求及验收关系；不检查纯文本真实性或产生审查结论。"""
from app.core.contracts.generation_canvas import (
    CriterionReferencePayload, CreativeControlFields, GenerationGuidanceFields, AcceptanceCriterionFields,
    DesignTextPayload, OutputIdentity,
)
from app.schemas.generation_canvas import CanvasResolvedOutput, GuidanceDirectionCard
from app.services.generation_canvas.formatting import scope_source_lines, design_field_line
from app.services.generation_canvas.errors import diagnostic

FIELD_TYPES = {'direction.creative_control': CreativeControlFields,
               'direction.guidance': GenerationGuidanceFields, 'direction.criterion': AcceptanceCriterionFields}
FIELD_LABELS = {'freedom': '创作控制程度', 'allowed_range': '允许发挥范围', 'keep': '需要保持',
                'undecided': '待确定事项', 'priority': '编译优先级', 'reference_requirements': '参考绑定要求',
                'sound_strategy': '声音策略', 'prohibitions': '禁止项', 'standard': '可观察判断标准'}


def publish_guidance(canvas_id, card, _adopted_inputs):
    """默认完整输出自身字段；明确字段来源沿用完整引用解析，示例不进入输出。"""
    fields = FIELD_TYPES[card.type](**{key: getattr(card, key) for key in FIELD_TYPES[card.type].model_fields})
    lines = ['名称：' + card.name] if card.name.strip() else []
    lines.extend(design_field_line(FIELD_LABELS[key], field)
                 for key in type(fields).model_fields if (field := getattr(fields, key)).state not in ('empty', 'not_applicable') and (field.text or field.state == 'absent'))
    lines.extend(scope_source_lines(card.scope, card.source_locator))
    if not lines:
        return []
    outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text',
        payload=DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=fields, scope=card.scope,
            source_locator=card.source_locator))]
    if card.type == 'direction.criterion' and card.criterion_id and card.name.strip():
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='criterion', position=0, object_id=card.criterion_id), modality='text',
            payload=CriterionReferencePayload(criterion_id=card.criterion_id, name=card.name.strip())))
    return outputs


def adopted_acceptance(adopted_inputs):
    """只消费已采用直接验收引用，不跟随身份查询判断正文。"""
    return [item.payload for item in adopted_inputs if item.available and isinstance(item.payload, CriterionReferencePayload)]


def acceptance_lines(references):
    """保留可读要求名和追溯身份，不表示验收通过。"""
    return [f'验收依据：{row.name}（{row.criterion_id}；仅关联要求，未作验收）' for row in references]


def validate_guidance_relations(document, published, previous, *, context=None):
    """要求身份稳定；采用和对象资格由明确直接候选决定。"""
    from app.services.generation_canvas.design_bindings import inspect_design_bindings
    identities, names = set(), set()
    for card in document.cards:
        if isinstance(card, GuidanceDirectionCard):
            if card.type == 'direction.criterion':
                old = next((row.get('criterion_id') for row in previous.get('cards', []) if row['id'] == card.id), None)
                if old and card.criterion_id != old:
                    raise diagnostic('IMMUTABLE_CRITERION_IDENTITY', '已建立的验收要求身份不可修改', {'card_id': card.id, 'path': ['criterion_id']})
                if card.criterion_id:
                    if card.criterion_id in identities:
                        raise diagnostic('DUPLICATE_CRITERION_IDENTITY', '独立验收要求身份必须唯一', {'card_id': card.id, 'path': ['criterion_id']})
                    identities.add(card.criterion_id)
                if card.name.strip():
                    if card.name.strip() in names:
                        raise diagnostic('DUPLICATE_CRITERION_NAME', '独立验收要求名称必须唯一', {'card_id': card.id, 'path': ['name']})
                    names.add(card.name.strip())
        bindings = getattr(card, 'input_bindings', [])
        relevant = [binding for binding in bindings if isinstance(card, GuidanceDirectionCard) or binding.input_port == 'acceptance_basis']
        if not relevant:
            continue
        for check in inspect_design_bindings(document, card, relevant, published, context=context):
            binding, item = check.binding, check.output
            valid = isinstance(item.payload, CriterionReferencePayload) if item and binding.input_port == 'acceptance_basis' else False
            if not check.binding_valid or not item or not valid:
                raise diagnostic('INVALID_REQUIREMENT_BINDING', '请选择直接候选中适用的对象或验收要求', {'card_id': card.id, 'path': ['input_bindings', binding.id]})

