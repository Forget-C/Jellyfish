"""对白及声音安排只发布本卡设计；参考素材不进入出口。"""
from app.core.contracts.generation_canvas import DialogueReferencePayload, DesignField, DesignTextPayload, SoundDesignFields, ObjectReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput, DialogueCard, SoundDirectionCard
from app.services.generation_canvas.formatting import scope_source_lines, design_field_line
from app.services.generation_canvas.errors import diagnostic

FIELD_LABELS = {'content': '对白正文', 'language_pronunciation': '语言／发音要求', 'source_description': '声源说明', 'environment': '环境声', 'action_sound': '动作声', 'music': '音乐约束'}


def publish_sound(canvas_id, card, adopted_inputs):
    """完整保留字段用途，身份仅来自直接选择。"""
    fields = {key: getattr(card, key) for key in FIELD_LABELS if isinstance(getattr(card, key, None), DesignField)}
    active = [(key, value) for key, value in fields.items() if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    if not active:
        return []
    objects = list({item.payload.object_id: item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available}.values())
    speaker = next((binding.source.object_id for binding in card.input_bindings if binding.input_port == 'speaker'), None)
    lines = [f'对象：{obj.name}（{obj.object_id}，{obj.category}）' for obj in objects]
    values = {}
    if isinstance(card, DialogueCard):
        values = {'dialogue_id': card.dialogue_id}
        lines.append(f'对白：{card.dialogue_id} · 说话对象：{speaker or "待确定"}')
    lines.extend(design_field_line(FIELD_LABELS[key], value) for key, value in active)
    lines.extend(scope_source_lines(card.scope, card.source_locator))
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=SoundDesignFields(**fields), scope=card.scope,
                                objects=objects, participant_id=speaker, source_locator=card.source_locator, **values)
    outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]
    if isinstance(card, DialogueCard):
        outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='dialogue', position=0), modality='text',
            payload=DialogueReferencePayload(dialogue_id=card.dialogue_id, speaker=next((obj for obj in objects if obj.object_id == speaker), None))))
    return outputs


def validate_sound_relations(document, published, previous, *, context=None):
    """对白身份不可替换；说话对象至多一个，声源允许直接明确对象。"""
    from app.services.generation_canvas.design_bindings import inspect_design_bindings
    identities = set()
    for card in document.cards:
        if not isinstance(card, SoundDirectionCard):
            continue
        if isinstance(card, DialogueCard):
            old = next((row for row in previous.get('cards', []) if row['id'] == card.id), None)
            if card.dialogue_id in identities or old and old.get('dialogue_id') != card.dialogue_id:
                raise diagnostic('INVALID_DIALOGUE_IDENTITY', '对白身份必须唯一且保存后不可替换', {'card_id': card.id, 'path': ['dialogue_id']})
            identities.add(card.dialogue_id)
        speakers = set()
        for check in inspect_design_bindings(document, card, card.input_bindings, published, context=context):
            binding, item = check.binding, check.output
            target = {'card_id': card.id, 'path': ['input_bindings', binding.id]}
            if not check.binding_valid or binding.input_port not in ('speaker', 'effect_object') or not item or not isinstance(item.payload, ObjectReferencePayload):
                raise diagnostic('INVALID_DESIGN_BINDING', '请选择直接候选中的具体对象', target)
            if binding.input_port == 'speaker':
                if item.payload.category not in ('character', 'prop'):
                    raise diagnostic('INVALID_DESIGN_CATEGORY', '说话对象须为人物或物件', target)
                speakers.add(item.payload.object_id)
        if len(speakers) > 1:
            raise diagnostic('SPEAKER_COUNT_EXCEEDED', '每条对白至多选择一个说话对象', {'card_id': card.id, 'port_id': 'speaker'})
