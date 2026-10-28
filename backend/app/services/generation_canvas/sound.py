"""对白及声音安排只发布本卡设计；参考素材不进入出口。"""
from app.core.contracts.generation_canvas import DesignField, DesignTextPayload, SoundDesignFields, ObjectReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput, DialogueCard, SoundDirectionCard
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.performance import STATE_LABELS, PURPOSE_LABELS

FIELD_LABELS = {'content': '对白正文', 'source_description': '声源说明', 'environment': '环境声', 'action_sound': '动作声', 'music': '音乐约束'}
PRODUCTION_LABELS = {'synchronous': '同期生成意图（按模型实际能力执行，不代表已生成声音）', 'postproduction': '待后期（本次不视为已生成声音）', 'undecided': '待确定'}


def publish_sound(canvas_id, card, adopted_inputs):
    """完整保留字段用途和制作安排，身份仅来自直接选择。"""
    fields = {key: getattr(card, key) for key in FIELD_LABELS if isinstance(getattr(card, key, None), DesignField)}
    active = [(key, value) for key, value in fields.items() if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    if not active and (isinstance(card, DialogueCard) or card.production == 'undecided'):
        return []
    objects = list({item.payload.object_id: item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available}.values())
    speaker = next((binding.source.object_id for binding in card.input_bindings if binding.input_port == 'speaker'), None)
    lines = [f'对象：{obj.name}（{obj.object_id}，{obj.category}）' for obj in objects]
    values = {}
    if isinstance(card, DialogueCard):
        values = {'dialogue_id': card.dialogue_id, 'version': card.version}
        lines.append(f'对白：{card.dialogue_id} · 版本 {card.version} · 说话对象：{speaker or "待确定"}')
    else:
        fields['production'] = card.production
        lines.append('制作安排：' + PRODUCTION_LABELS[card.production])
    lines.extend(f'{PURPOSE_LABELS[value.purpose]} / {FIELD_LABELS[key]} [{STATE_LABELS[value.state]}]：{value.text}' + (f'（来源：{value.source_locator}）' if value.source_locator else '') for key, value in active)
    for label, value in [('适用范围', card.scope.description), ('制作阶段', card.scope.phase), ('适用条件', card.scope.condition), ('来源', card.source_locator)]:
        if value:
            lines.append(f'{label}：{value}')
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=SoundDesignFields(**fields), scope=card.scope,
                                objects=objects, participant_id=speaker, source_locator=card.source_locator, **values)
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id=port, position=0), modality='text', payload=payload) for port in card.output_ports]


def validate_sound_relations(document, published, previous):
    """对白身份不可替换；说话对象至多一个，声源允许直接明确对象。"""
    from app.services.generation_canvas.compiler import resolve_outputs, identity_key
    identities = set()
    for card in document.cards:
        if not isinstance(card, SoundDirectionCard):
            continue
        if isinstance(card, DialogueCard):
            old = next((row for row in previous.get('cards', []) if row['id'] == card.id), None)
            if card.dialogue_id in identities or old and old.get('dialogue_id') != card.dialogue_id:
                raise diagnostic('INVALID_DIALOGUE_IDENTITY', '对白身份必须唯一且保存后不可替换', {'card_id': card.id, 'path': ['dialogue_id']})
            identities.add(card.dialogue_id)
            if old and card.version < old['version']:
                raise diagnostic('INVALID_DIALOGUE_VERSION', '对白版本不可倒退', {'card_id': card.id, 'path': ['version']})
        candidates = resolve_outputs(document, card.id, published)
        ids, speakers = set(), set()
        for binding in card.input_bindings:
            target = {'card_id': card.id, 'path': ['input_bindings', binding.id]}
            item = next((item for item in candidates if identity_key(item.source) == identity_key(binding.source)), None)
            connected = any(edge.target_card == card.id and edge.target_port == binding.input_port and edge.source_card == binding.source.card_id and edge.source_port == binding.source.port_id for edge in document.edges)
            if binding.id in ids or binding.input_port not in card.input_ports or binding.input_port not in ('speaker', 'effect_object') or not connected or not item or not item.available or not isinstance(item.payload, ObjectReferencePayload):
                raise diagnostic('INVALID_DESIGN_BINDING', '请选择直接候选中的具体对象', target)
            ids.add(binding.id)
            if binding.input_port == 'speaker':
                if item.payload.category not in ('character', 'prop'):
                    raise diagnostic('INVALID_DESIGN_CATEGORY', '说话对象须为人物或物件', target)
                speakers.add(item.payload.object_id)
        if len(speakers) > 1:
            raise diagnostic('SPEAKER_COUNT_EXCEEDED', '每条对白至多选择一个说话对象', {'card_id': card.id, 'port_id': 'speaker'})
