"""独立表演卡发布自身字段与直接关系；完整明确依赖由模型编译闭包传递。"""
from app.core.contracts.generation_canvas import DialogueReferencePayload, CriterionReferencePayload, FrameState, DialogueBasis, DesignField, DesignTextPayload, PerformanceDesignFields, ObjectReferencePayload, OutputIdentity
from app.schemas.generation_canvas import CanvasResolvedOutput, PerformanceDirectionCard, SoundDirectionCard, SpatialDirectionCard, NarrativeDirectionCard, GuidanceDirectionCard, ConstraintDirectionCard
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.formatting import design_field_line

FIELD_LABELS = {'situation': '当前处境', 'relationship': '人物关系', 'objective': '人物目标', 'obstacle': '阻碍',
                'subtext': '潜台词', 'attention': '注意对象说明', 'internal_adjustment': '内在调整',
                'physical_action': '身体动作', 'gaze': '目光', 'breath': '呼吸', 'weight': '重心',
                'hands': '手部', 'voice': '声音表现', 'delivery': '表达方式', 'reaction_order': '反应顺序',
                'exit_state': '结束状态', 'avoid': '避免的表现', 'applicability': '表演适用说明'}


def publish_design(canvas_id, card, adopted_inputs):
    """完整设计只发布一个出口；空与不适用不编译为要求，开放状态保持原意。"""
    fields = {key: getattr(card, key) for key in FIELD_LABELS if isinstance(getattr(card, key, None), DesignField)}
    active = [(key, value) for key, value in fields.items() if value.state not in ('empty', 'not_applicable') and (value.text or value.state == 'absent')]
    dialogues = [item.payload for item in adopted_inputs if isinstance(item.payload, DialogueReferencePayload) and item.source.port_id == 'dialogue' and item.available]
    from app.services.generation_canvas.guidance import adopted_acceptance, acceptance_lines
    acceptance = adopted_acceptance(adopted_inputs)
    if not active and not dialogues and not acceptance:
        return []
    objects = list({item.payload.object_id: item.payload for item in adopted_inputs if isinstance(item.payload, ObjectReferencePayload) and item.available}.values())
    participant = next((binding.source.object_id for binding in card.input_bindings if binding.input_port == 'participant'), None)
    from app.services.generation_canvas.narrative import direct_relations, relation_lines
    relations = direct_relations(card, adopted_inputs)
    lines = relation_lines([row for row in relations if row.input_port in ('beat', 'received_event')]) + [f'对象：{obj.name}（{obj.object_id}，{obj.category}）' for obj in objects]
    if participant:
        lines.append(f'参与对象：{participant}')
    lines.extend(design_field_line(FIELD_LABELS[key], value) for key, value in active)
    if card.scope.description:
        lines.append('适用范围：' + card.scope.description)
    if card.scope.phase:
        lines.append('制作阶段：' + card.scope.phase)
    if card.scope.condition:
        lines.append('适用条件：' + card.scope.condition)
    if card.source_locator:
        lines.append('来源：' + card.source_locator)
    lines.extend(acceptance_lines(acceptance))
    lines.extend(f'对白依据：{item.dialogue_id} · 说话对象：{item.speaker.name if item.speaker else "待确定"}' for item in dialogues)
    basis = [DialogueBasis(dialogue_id=item.dialogue_id, speaker=item.speaker) for item in dialogues]
    payload = DesignTextPayload(design_type=card.type, text='\n'.join(lines), fields=PerformanceDesignFields(**fields),
                                scope=card.scope, objects=objects, participant_id=participant, narrative_relations=relations, source_locator=card.source_locator, dialogue_basis=basis, acceptance_basis=acceptance,
                                frame_states=[FrameState(id='field:exit_state', label='结束状态')] if any(key == 'exit_state' for key, _ in active) else [])
    return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0), modality='text', payload=payload)]


def validate_design_relations(document, published, *, context=None):
    """只允许直接明确对象；多人参考逐身份选取，主体按真实身份至多一个。"""
    from app.services.generation_canvas.design_bindings import inspect_design_bindings
    for card in document.cards:
        if not isinstance(card, PerformanceDirectionCard) or isinstance(card, (SoundDirectionCard, SpatialDirectionCard, NarrativeDirectionCard, GuidanceDirectionCard, ConstraintDirectionCard)):
            continue
        participants, beats, shots = set(), set(), set()
        for check in inspect_design_bindings(document, card, card.input_bindings, published, context=context):
            binding, item = check.binding, check.output
            target = {'card_id': card.id, 'path': ['input_bindings', binding.id]}
            if not check.binding_valid or binding.input_port not in ('participant', 'effect_object', 'attention_object', 'focus_object', 'beat', 'received_event', 'dialogue_basis', 'shot', 'acceptance_basis'):
                raise diagnostic('INVALID_DESIGN_BINDING', '请选择已接入的明确关系用途', target)
            if binding.input_port == 'acceptance_basis':
                if not item or not isinstance(item.payload, CriterionReferencePayload):
                    raise diagnostic('INVALID_REQUIREMENT_BINDING', '请选择直接候选中的验收要求', target)
                continue
            if binding.input_port == 'dialogue_basis':
                if not item or not isinstance(item.payload, DialogueReferencePayload) or item.source.port_id != 'dialogue':
                    raise diagnostic('INVALID_DESIGN_BINDING', '请选择直接候选中的具体对白', target)
                continue
            if not item:
                raise diagnostic('INVALID_DESIGN_BINDING', '请选择直接候选中的具体对象', target)
            if binding.input_port in ('beat', 'received_event', 'shot'):
                from app.services.generation_canvas.narrative import narrative_binding_allowed
                if not narrative_binding_allowed(binding.input_port, item.payload):
                    raise diagnostic('INVALID_DESIGN_CATEGORY', '故事对象类别不适用于此关系', target)
                if binding.input_port == 'shot':
                    shots.add(item.payload.reference_id)
                if binding.input_port == 'beat':
                    beats.add(item.payload.reference_id)
                continue
            if not isinstance(item.payload, ObjectReferencePayload):
                raise diagnostic('INVALID_DESIGN_CATEGORY', '请选择明确对象身份', target)
            allowed = ('character', 'prop', 'costume') if binding.input_port == 'participant' else ('character', 'prop', 'costume', 'place')
            if item.payload.category not in allowed:
                raise diagnostic('INVALID_DESIGN_CATEGORY', '对象类别不适用于此关系', target)
            if binding.input_port == 'participant':
                participants.add(item.payload.object_id)
        if len(shots) > 1:
            raise diagnostic('SHOT_COUNT_EXCEEDED', '所属镜头至多一个', {'card_id': card.id, 'port_id': 'shot'})
        if len(beats) > 1:
            raise diagnostic('BEAT_COUNT_EXCEEDED', '所属节拍至多一个', {'card_id': card.id, 'port_id': 'beat'})
        if len(participants) > 1:
            raise diagnostic('PARTICIPANT_COUNT_EXCEEDED', '情境和表演主体至多一个对象', {'card_id': card.id, 'port_id': 'participant'})


async def validate_design_examples(db, document, published, project_id, previous, media_references, *, context=None):
    """示例必须是直接已发布媒体，固定文件保持项目归属和删除保护。"""
    from app.services.generation_canvas.saved_media import validate_media_file
    from app.services.generation_canvas.output_resolution import CanvasOutputContext, identity_key
    context = context or CanvasOutputContext(document)
    for card in document.cards:
        if not isinstance(card, (PerformanceDirectionCard, SoundDirectionCard)):
            continue
        candidates = context.resolve_outputs(card.id, model_outputs=published, allow_reference_drafts=True)
        old_examples = next((row.get('examples', []) for row in previous.get('cards', []) if row['id'] == card.id), [])
        ids = set()
        for example, media_reference in zip(card.examples, media_references[card.id]):
            target = {'card_id': card.id, 'path': ['examples', example.id]}
            if example.field_id and not isinstance(getattr(card, example.field_id, getattr(getattr(card, 'fields', None), example.field_id, None)), DesignField):
                raise diagnostic('INVALID_EXAMPLE_FIELD', '请选择本卡声明的设计字段', {**target, 'field': 'field_id'})
            port = {'image': 'image_example', 'video': 'video_example', 'audio': 'audio_example'}.get(example.source.port_id)
            from app.services.generation_canvas.design_references import FLAT_DESIGN_TYPES
            accepted_ports = (port, example.source.port_id) if card.type in FLAT_DESIGN_TYPES else (port,)
            connected = any(edge.target_card == card.id and edge.target_port in accepted_ports and edge.source_card == example.source.card_id and edge.source_port == example.source.port_id for edge in document.edges)
            item = next((item for item in candidates if identity_key(item.source) == identity_key(example.source)), None)
            fixed = any(old['id'] == example.id and old['file_id'] == example.file_id and old['source'] == example.source.model_dump() for old in old_examples)
            if example.id in ids or not connected or example.source.canvas_id != document.id or not port or (not fixed and (not item or not item.available or item.file_id != example.file_id)):
                raise diagnostic('INVALID_DESIGN_EXAMPLE', '请选择直接候选中的具体图片、视频或音频示例', target)
            ids.add(example.id)
            await validate_media_file(db, project_id, media_reference)
