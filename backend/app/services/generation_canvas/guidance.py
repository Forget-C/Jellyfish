"""本卡创作要求及验收关系；不检查纯文本真实性或产生审查结论。"""
from app.core.contracts.generation_canvas import (
    SpatialReferencePayload, NarrativeReferencePayload, CriterionReferencePayload, CreativeControlFields, GenerationGuidanceFields, AcceptanceCriterionFields,
    DesignTextPayload, OutputIdentity, ObjectReferencePayload,
)
from app.schemas.generation_canvas import CanvasResolvedOutput, GuidanceDirectionCard
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

FIELD_TYPES = {'direction.creative_control': CreativeControlFields,
               'direction.guidance': GenerationGuidanceFields, 'direction.criterion': AcceptanceCriterionFields}
FIELD_LABELS = {'freedom': '创作控制程度', 'allowed_range': '允许发挥范围', 'keep': '需要保持',
                'undecided': '待确定事项', 'priority': '编译优先级', 'reference_requirements': '参考绑定要求',
                'sound_strategy': '声音策略', 'prohibitions': '禁止项', 'standard': '可观察判断标准'}


def publish_guidance(canvas_id, card, adopted_inputs):
    """默认完整输出自身字段和必要对象指代；示例文件不进入设计输出。"""
    fields = FIELD_TYPES[card.type](**{key: getattr(card, key) for key in FIELD_TYPES[card.type].model_fields})
    objects = [item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available]
    references = [item.payload for item in adopted_inputs if item.available and isinstance(item.payload, (SpatialReferencePayload, NarrativeReferencePayload))]
    lines = ['名称：' + card.name] if card.name.strip() else []
    lines.extend(f'作用对象：{obj.name}（{obj.object_id}，{obj.category}）' for obj in objects)
    lines.extend(f'作用对象：{row.name}（{row.reference_id}，{row.category}）' for row in references)
    lines.extend(f'{PURPOSE_LABELS[field.purpose]} / {FIELD_LABELS[key]} [{STATE_LABELS[field.state]}]：{field.text}' + (f'（来源：{field.source_locator}）' if field.source_locator else '')
                 for key in type(fields).model_fields if (field := getattr(fields, key)).state not in ('empty', 'not_applicable') and (field.text or field.state == 'absent'))
    for label, value in [('适用范围', card.scope.description), ('制作阶段', card.scope.phase), ('适用条件', card.scope.condition), ('来源', card.source_locator)]:
        if value:
            lines.append(label + '：' + value)
    if not lines:
        return []
    outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text',
        payload=DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=fields, scope=card.scope,
            objects=objects, references=references, source_locator=card.source_locator))]
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


def validate_guidance_relations(document, published, previous):
    """要求身份稳定；采用和对象资格由明确直接候选决定。"""
    from app.services.generation_canvas.compiler import resolve_outputs, identity_key
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
        candidates = resolve_outputs(document, card.id, published)
        ids = set()
        for binding in relevant:
            item = next((item for item in candidates if identity_key(item.source) == identity_key(binding.source)), None)
            connected = any(edge.source_card == binding.source.card_id and edge.source_port == binding.source.port_id and edge.target_card == card.id and edge.target_port == binding.input_port for edge in document.edges)
            valid = isinstance(item.payload, CriterionReferencePayload) if item and binding.input_port == 'acceptance_basis' else bool(item and binding.input_port == 'effect_object' and isinstance(item.payload, (ObjectReferencePayload, SpatialReferencePayload, NarrativeReferencePayload)) and not (card.type == 'direction.criterion' and isinstance(item.payload, NarrativeReferencePayload) and item.payload.category == 'shot'))
            if binding.id in ids or not connected or not item or not item.available or not valid or binding.input_port not in card.input_ports:
                raise diagnostic('INVALID_REQUIREMENT_BINDING', '请选择直接候选中适用的对象或验收要求', {'card_id': card.id, 'path': ['input_bindings', binding.id]})
            ids.add(binding.id)

