"""空间设计只展开本卡字段和直接选择的身份，媒体关联不成为输出。"""
from app.core.contracts.generation_canvas import (
    DesignTextPayload, SpatialDesignRelations, DesignField, AnchorDesignFields, BlockingDesignFields, ActivityDesignFields, EnvironmentDesignFields, SpatialReferencePayload,
    ObjectReferencePayload, OutputIdentity,
)
from app.schemas.generation_canvas import SpatialDirectionCard, SpatialAnchorCard, CanvasResolvedOutput
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS
from app.services.generation_canvas.errors import diagnostic

RELATION_LABELS = {'space': '所属空间', 'participant': '参与对象', 'effect_object': '作用对象', 'position_anchor': '位置锚点', 'area_anchor': '区域锚点', 'change_event': '变化事件', 'trigger_event': '触发事件'}

FIELD_LABELS = {'position': '位置', 'orientation': '方位与朝向', 'spatial_relation': '空间关系', 'scale': '尺度依据',
                'initiative': '主动权', 'path': '路径', 'transition_reason': '状态切换原因', 'task': '持续任务', 'attention': '注意对象说明', 'main_action_effect': '对主戏的作用', 'delay_basis': '反应延迟依据', 'entry_exit': '入出画', 'exit_state': '结束状态', 'depth': '景深层次', 'intensity': '活动强度', 'activity': '环境活动', 'empty_space': '刻意留白', 'reason': '留白理由'}


def publish_spatial(canvas_id, card, adopted_inputs):
    """稳定引用独立于完整设计；不把位置锚点全文隐式传递。"""
    field_type = {'direction.anchor': AnchorDesignFields, 'direction.blocking': BlockingDesignFields, 'direction.activity': ActivityDesignFields, 'direction.environment': EnvironmentDesignFields}[card.type]
    fields = field_type(**{key: getattr(card, key) for key in field_type.model_fields})
    objects = [item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available]
    references = [item.payload for item in adopted_inputs if isinstance(item.payload, SpatialReferencePayload) and item.available]
    relations = SpatialDesignRelations()
    for binding in card.input_bindings:
        if binding.input_port in ('space', 'participant', 'area_anchor', 'change_event', 'trigger_event'):
            setattr(relations, binding.input_port + '_id', binding.source.object_id)
        elif binding.input_port in ('effect_object', 'position_anchor'):
            getattr(relations, binding.input_port + '_ids').append(binding.source.object_id)
    from app.services.generation_canvas.narrative import direct_relations, relation_lines
    narrative_relations = [row for row in direct_relations(card, adopted_inputs) if row.input_port in ('change_event', 'trigger_event')]
    lines = relation_lines(narrative_relations)
    for binding in card.input_bindings:
        item = next((item for item in adopted_inputs if item.source == binding.source and item.available), None)
        if item and isinstance(item.payload, (ObjectReferencePayload, SpatialReferencePayload)):
            identifier = item.payload.object_id if isinstance(item.payload, ObjectReferencePayload) else item.payload.reference_id
            lines.append(f'{RELATION_LABELS[binding.input_port]}：{item.payload.name}（{identifier}）')
    lines.extend(f'{PURPOSE_LABELS[field.purpose]} / {FIELD_LABELS[key]} [{STATE_LABELS[field.state]}]：{field.text}' + (f'（来源：{field.source_locator}）' if field.source_locator else '')
                 for key in field_type.model_fields if isinstance((field := getattr(fields, key)), DesignField) and field.state not in ('empty', 'not_applicable') and (field.text or field.state == 'absent'))
    if getattr(card, 'delay_ms', None) is not None:
        lines.append(f'反应延迟毫秒：{card.delay_ms}')
    if getattr(card, 'name', ''):
        lines.insert(0, '名称：' + card.name)
    for label, value in [('适用范围', card.scope.description), ('制作阶段', card.scope.phase), ('适用条件', card.scope.condition), ('来源', card.source_locator)]:
        if value:
            lines.append(label + '：' + value)
    outputs = []
    if lines:
        participant = next((binding.source.object_id for binding in card.input_bindings if binding.input_port == 'participant'), None)
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text',
            payload=DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=fields, scope=card.scope,
                objects=objects, references=references, spatial_relations=relations, narrative_relations=narrative_relations, participant_id=participant, source_locator=card.source_locator)))
    if card.type not in ('direction.anchor', 'direction.blocking'):
        return outputs
    port = 'anchor' if isinstance(card, SpatialAnchorCard) else 'blocking'
    identifier = getattr(card, port + '_id')
    if identifier and card.name.strip():
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id=port, position=0, object_id=identifier), modality='text',
            payload=SpatialReferencePayload(category=port, reference_id=identifier, name=card.name.strip())))
    return outputs


def validate_spatial_relations(document, published, previous):
    """关系只接受直接且类别匹配的身份，单对象端点按实际身份计数。"""
    from app.services.generation_canvas.compiler import resolve_outputs, identity_key
    identities = set()
    for card in document.cards:
        if not isinstance(card, SpatialDirectionCard):
            continue
        field = 'anchor_id' if card.type == 'direction.anchor' else 'blocking_id' if card.type == 'direction.blocking' else None
        if field:
            value = getattr(card, field)
            old = next((item.get(field) for item in previous.get('cards', []) if item['id'] == card.id), None)
            if old and old != value:
                raise diagnostic('IMMUTABLE_SPATIAL_IDENTITY', '已建立空间身份不可改绑，请新建对象', {'card_id': card.id, 'path': [field]})
            if value and (field, value) in identities:
                raise diagnostic('DUPLICATE_SPATIAL_IDENTITY', '独立空间对象身份必须唯一', {'card_id': card.id, 'path': [field]})
            if value:
                identities.add((field, value))
        candidates = resolve_outputs(document, card.id, published)
        ids, counts = set(), {}
        for binding in card.input_bindings:
            target = {'card_id': card.id, 'path': ['input_bindings', binding.id]}
            item = next((item for item in candidates if identity_key(item.source) == identity_key(binding.source)), None)
            connected = any(edge.target_card == card.id and edge.target_port == binding.input_port and edge.source_card == binding.source.card_id and edge.source_port == binding.source.port_id for edge in document.edges)
            if binding.id in ids or binding.input_port not in card.input_ports or binding.input_port in ('image_example', 'video_example') or not connected or not item or not item.available:
                raise diagnostic('INVALID_SPATIAL_BINDING', '请选择直接候选中的明确空间关系', target)
            ids.add(binding.id)
            payload = item.payload
            allowed = isinstance(payload, ObjectReferencePayload) and (binding.input_port == 'effect_object' or binding.input_port == 'space' and payload.category == 'place' or binding.input_port == 'participant' and payload.category in ('character', 'costume', 'prop'))
            allowed = allowed or isinstance(payload, SpatialReferencePayload) and payload.category == 'anchor' and binding.input_port in ('position_anchor', 'area_anchor')
            from app.services.generation_canvas.narrative import narrative_binding_allowed
            allowed = allowed or binding.input_port in ('change_event', 'trigger_event') and narrative_binding_allowed(binding.input_port, payload)
            if not allowed:
                raise diagnostic('INVALID_SPATIAL_CATEGORY', '对象类别不适用于此空间关系', target)
            counts.setdefault(binding.input_port, set()).add(payload.object_id if isinstance(payload, ObjectReferencePayload) else payload.reference_id)
        if any(len(counts.get(port, set())) > 1 for port in ('space', 'participant', 'area_anchor', 'change_event', 'trigger_event')):
            raise diagnostic('SPATIAL_RELATION_COUNT', '所属空间、参与对象和区域锚点各至多一个', {'card_id': card.id})
