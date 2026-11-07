"""由真实卡类端点构建静态目录，并供候选图与客户端共享兼容规则。"""
from typing import get_args
from app.core.contracts.canvas_catalog import CanvasCatalog, CanvasCardTypeDefinition, CanvasInputPortDefinition, CanvasOutputPortDefinition, CanvasDesignFieldDefinition
from app.core.contracts.generation_canvas import DesignField, ReferenceDesignField
from app.schemas.generation_canvas import CanvasDocument, MovementCard, CompositionCard, CameraCard, LightingCard, FocusCard, SpatialDirectionCard, NarrativeDirectionCard, SoundDirectionCard, ConstraintDirectionCard, GuidanceDirectionCard, VisualStyleCard, ImageContentCard, VideoContentCard, AudioContentCard, NamedImageReferenceCard, ImageModelCard, VideoModelCard
from app.services.generation_canvas import performance, spatial, narrative, sound, continuity, guidance, photography, visual_style, composition, movement

CARD_TITLES = {'review.check': '检查卡', 'direction.movement': '运镜卡', 'direction.composition': '景别与构图卡', 'direction.creative_control': '创作控制卡', 'direction.guidance': '生成指导卡', 'direction.criterion': '验收要求卡', 'direction.space_rule': '空间规则卡', 'direction.continuity': '连续性设计卡', 'direction.fact': '不可改事实卡', 'direction.narrative': '叙事概览卡', 'direction.beat': '叙事节拍卡', 'direction.event': '事件与刺激卡', 'direction.shot': '镜头设计卡', 'direction.anchor': '空间锚点卡', 'direction.blocking': '站位与走位卡', 'direction.activity': '镜内活动卡', 'direction.environment': '环境活动与留白卡', 'direction.style': '画面风格卡', 'direction.camera': '机位与视角卡', 'direction.lighting': '光影与色彩卡', 'direction.focus': '焦点与成像卡', 'direction.dialogue': '对白卡', 'direction.sound': '声音安排卡', 'direction.situation': '角色情境卡', 'direction.performance': '人物表演卡', 'direction.performance_rule': '表演规则卡', 'reference.character': '角色参考卡', 'reference.place': '场所参考卡', 'reference.prop': '道具参考卡', 'reference.costume': '服装参考卡', 'content.character': '人物描述卡', 'content.prop': '道具描述卡', 'content.costume': '服装描述卡', 'content.place': '场所描述卡', 'content.text': '文本内容卡', 'content.basis': '原文／创作依据卡', 'content.image': '图片内容卡', 'content.video': '视频内容卡', 'content.audio': '音频内容卡', 'model.text': '文本模型卡', 'model.image': '图片模型卡', 'model.video': '视频模型卡'}

PORT_LABELS = {'check_basis': '生成检查依据', 'criterion': '验收要求', 'attention_object': '关注对象', 'focus_object': '焦点对象', 'speaker': '说话对象', 'dialogue': '对白引用', 'audio_example': '音频素材', 'shot': '镜头对象', 'event': '事件对象', 'covered_beat': '覆盖节拍', 'related_event': '关联事件', 'blocking_basis': '调度依据', 'space': '所属空间', 'anchor': '锚点引用', 'blocking': '调度引用', 'position_anchor': '位置锚点', 'area_anchor': '区域锚点', 'change_event': '变化事件', 'trigger_event': '触发事件', 'participant': '参与对象', 'effect_object': '作用对象', 'beat': '所属节拍', 'received_event': '接收事件', 'dialogue_basis': '对白依据', 'acceptance_basis': '验收依据', 'image_example': '图片素材', 'video_example': '视频素材', 'name': '名称关联', 'image_source': '图片来源', 'object': '对象引用', 'text': '文本', 'image': '参考图片', 'video': '视频', 'audio': '音频', 'first_frame': '首帧', 'last_frame': '尾帧', 'key_frame': '关键帧', 'subject_image': '主体图片', 'subject_video': '主体视频'}

VALUE_KINDS = {'check_basis': 'check_basis', 'criterion': 'criterion', 'attention_object': 'object_reference', 'focus_object': 'object_reference', 'speaker': 'object_reference', 'audio_example': 'audio', 'dialogue': 'dialogue', 'shot': 'shot', 'event': 'event', 'covered_beat': 'beat', 'related_event': 'event', 'blocking_basis': 'blocking', 'space': 'object_reference', 'anchor': 'anchor', 'position_anchor': 'anchor', 'area_anchor': 'anchor', 'blocking': 'blocking', 'change_event': 'event', 'trigger_event': 'event', 'participant': 'object_reference', 'effect_object': 'object_reference', 'beat': 'beat', 'received_event': 'event', 'dialogue_basis': 'dialogue', 'acceptance_basis': 'criterion', 'image_example': 'image', 'video_example': 'video', 'name': 'object_reference', 'image_source': 'image', 'object': 'object_reference', 'text': 'text', 'image': 'image', 'video': 'video', 'audio': 'audio', 'first_frame': 'image', 'last_frame': 'image', 'key_frame': 'image', 'subject_image': 'image', 'subject_video': 'video'}

CATEGORIES = {
    '检查': ('review.check',),
    '画面设计': ('direction.movement', 'direction.composition', 'direction.style', 'direction.camera', 'direction.lighting', 'direction.focus'),
    '表演与调度': ('direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment'),
    '叙事与镜头': ('direction.narrative', 'direction.beat', 'direction.event', 'direction.shot'),
    '声音设计': ('direction.dialogue', 'direction.sound'),
    '连续性与约束': ('direction.space_rule', 'direction.continuity', 'direction.fact', 'direction.creative_control', 'direction.guidance', 'direction.criterion'),
}


def input_definition(card_type, port):
    """同一声明用于保存图校验与前端候选提示，不借用模态表达业务身份。"""
    from app.services.generation_canvas.connection_policy import single_source_port
    accepts = [VALUE_KINDS[port]]
    if port == 'effect_object' and card_type in ('direction.space_rule', 'direction.fact', 'direction.creative_control', 'direction.guidance', 'direction.criterion'):
        accepts += ['anchor', 'blocking', 'beat', 'event']
        if card_type != 'direction.criterion':
            accepts.append('shot')
    relation = 'generation_input' if port in ('text', 'image', 'first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video') else 'material_association' if port in ('image_source', 'image_example', 'video_example', 'audio_example') else 'business_reference'
    if port == 'check_basis':
        relation = 'observation'
    return CanvasInputPortDefinition(id=port, label='所属镜头' if port == 'shot' else PORT_LABELS[port], relation=relation, accepts=accepts, max_sources=1 if single_source_port(card_type, port) else None)


def ports_compatible(source_port, receiver_type, target_port, source_type=None):
    """只判断声明的值种类；具体对象类别和实际采用仍由接收业务校验。"""
    if source_type == 'direction.criterion' and receiver_type.startswith('direction.') and source_port == 'text':
        return False
    return VALUE_KINDS[source_port] in input_definition(receiver_type, target_port).accepts


def design_fields(card_model):
    """目录声明具体卡片可定位的设计字段，不将它们变为独立采用项。"""
    if issubclass(card_model, MovementCard):
        labels = photography.REGIONS['movement']
        names = labels
    elif issubclass(card_model, CompositionCard):
        labels = composition.COMPOSITION_LABELS
        names = labels
    elif issubclass(card_model, (CameraCard, LightingCard, FocusCard)):
        labels = photography.REGIONS[card_model.model_fields['type'].default.split('.')[1]]
        names = labels
    elif issubclass(card_model, VisualStyleCard):
        labels = visual_style.STYLE_LABELS
        names = labels
    else:
        labels = next((module.FIELD_LABELS for base, module in ((ConstraintDirectionCard, continuity), (GuidanceDirectionCard, guidance), (SpatialDirectionCard, spatial), (NarrativeDirectionCard, narrative), (SoundDirectionCard, sound)) if issubclass(card_model, base)), performance.FIELD_LABELS)
        names = [name for name, field in card_model.model_fields.items() if field.annotation in (DesignField, ReferenceDesignField)]
    # Defaults come from the actual saved-card schema, including specialized state/purpose defaults.
    owner = card_model.model_fields['fields'].annotation if 'fields' in card_model.model_fields else card_model
    definitions = []
    for name in names:
        value = owner.model_fields[name].get_default(call_default_factory=True)
        default = DesignField(**{key: getattr(value, key) for key in DesignField.model_fields})
        definitions.append(CanvasDesignFieldDefinition(id=name, label=labels[name], default_value=default))
    return definitions


def canvas_catalog():
    """从文档联合类型发现实际卡类；六类设计具有各自真实类型。"""
    cards = []
    for card_model in get_args(get_args(CanvasDocument.model_fields['cards'].annotation)[0]):
        for card_type in get_args(card_model.model_fields['type'].annotation):
            category = next((name for name, types in CATEGORIES.items() if card_type in types), None)
            group = '导演工具箱' if category else '模型生成' if card_type.startswith('model.') else '基础内容'
            modality = 'image' if issubclass(card_model, (ImageContentCard, NamedImageReferenceCard, ImageModelCard)) else 'video' if issubclass(card_model, (VideoContentCard, VideoModelCard)) else 'audio' if issubclass(card_model, AudioContentCard) else 'text'
            cards.append(CanvasCardTypeDefinition(type=card_type, title=CARD_TITLES[card_type], group=group, category=category, modality=modality,
                inputs=[input_definition(card_type, port) for port in card_model.input_ports],
                outputs=[CanvasOutputPortDefinition(id=port, label=PORT_LABELS[port], value_kind=VALUE_KINDS[port], adoption='observation' if port == 'check_basis' else 'whole_card' if category and port == 'text' else 'object' if VALUE_KINDS[port] not in ('text', 'image', 'video', 'audio') else 'item') for port in card_model.output_ports],
                fields=design_fields(card_model), entries=[]))
    from app.services.generation_canvas.connection_policy import connection_policies
    return CanvasCatalog(cards=cards, connection_policies=connection_policies(cards))
