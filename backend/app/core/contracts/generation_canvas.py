"""跨层画布输入输出值契约，不包含运行编排或存储行为。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_serializer


class OutputIdentity(BaseModel):
    """稳定输出位置不等于历史产物 ID；不得按文件合并来源。"""
    model_config = ConfigDict(extra='forbid')
    canvas_id: str
    card_id: str
    port_id: str
    position: int = Field(ge=0)
    object_id: str | None = None

    @model_serializer(mode='wrap')
    def serialize_identity(self, handler):
        """旧输出身份不写空选择器，保持原始引用、结果依据与哈希语义。"""
        value = handler(self)
        if self.object_id is None:
            value.pop('object_id', None)
        return value



class TextOutputPayload(BaseModel):
    """已声明的正文出口，不包含来源卡的其他字段。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['text'] = 'text'
    text: str


class MediaOutputPayload(BaseModel):
    """明确媒体引用，禁止由正文或名称猜测内容。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['image', 'video', 'audio']
    file_id: str



class InputBinding(BaseModel):
    """接收端明确采用的唯一来源记录，提示词通过身份引用它。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    source: OutputIdentity
    input_port: str
    subject_name: str | None = None
    photography_scope: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)


class ObjectReferencePayload(BaseModel):
    """关系出口只携带对象身份，不传递描述、媒体或祖先内容。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['object_reference'] = 'object_reference'
    object_id: str
    name: str
    category: Literal['character', 'prop', 'costume', 'place']


class DescriptionTextPayload(BaseModel):
    """描述出口保留本卡对象与来源信息；模型只展开正文。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['description'] = 'description'
    object_id: str | None
    name: str
    category: Literal['character', 'prop', 'costume', 'place']
    text: str
    source_locator: str


class NamedImageObject(BaseModel):
    """名称、身份与图内定位；绝不携带描述或穿着动作。"""
    model_config = ConfigDict(extra='forbid')
    object_id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(default='', max_length=255)
    category: Literal['character', 'prop', 'costume', 'place']
    position: str = ''


class ReferenceImageBinding(BaseModel):
    """固定具体文件及直接来源产物；无画布来源即项目文件选择。"""
    model_config = ConfigDict(extra='forbid')
    file_id: str = Field(min_length=1, max_length=36)
    source: OutputIdentity | None = None
    result_set_id: str | None = None


class NamedImagePayload(BaseModel):
    """图片出口自含默认名称映射，无需接收端读取祖先。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['named_image'] = 'named_image'
    file_id: str
    objects: list[NamedImageObject] = Field(default_factory=list)
    angle: str


class CanvasSourceMapping(BaseModel):
    """本地代号对应的直接来源和实际媒体序号。"""
    model_config = ConfigDict(extra='forbid')
    token: str
    source: OutputIdentity
    media_position: int | None


class NamedImageMapping(NamedImageObject):
    """编译预览中可核对的对象到实际提交图片映射。"""
    media_position: int = Field(ge=1)
    angle: str
    input_port: str | None = None
    subject_name: str | None = None
    purpose_position: int | None = Field(default=None, ge=1)

    @model_serializer(mode='wrap')
    def serialize_mapping(self, handler):
        """图片旧映射不增加空字段，视频映射保留明确用途及用户分组。"""
        value = handler(self)
        for field in ('input_port', 'subject_name', 'purpose_position'):
            if getattr(self, field) is None:
                value.pop(field, None)
        return value


class DesignField(BaseModel):
    """显式创作状态及用途；不从正文猜测事实或强制可见动作。"""
    model_config = ConfigDict(extra='forbid')
    text: str = ''
    state: Literal['empty', 'not_applicable', 'absent', 'undecided', 'proposal', 'fact'] = 'empty'
    purpose: Literal['background', 'design', 'constraint'] = 'design'
    source_locator: str = ''


class DesignScope(BaseModel):
    """创作者声明的范围与制作阶段，不自动推断镜头适用性。"""
    model_config = ConfigDict(extra='forbid')
    description: str = ''
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str = ''


class PerformanceDesignFields(BaseModel):
    """导演表演的具体业务字段；字段编辑不开放局部采用。"""
    model_config = ConfigDict(extra='forbid')
    situation: DesignField | None = None
    relationship: DesignField | None = None
    objective: DesignField | None = None
    obstacle: DesignField | None = None
    subtext: DesignField | None = None
    attention: DesignField | None = None
    internal_adjustment: DesignField | None = None
    physical_action: DesignField | None = None
    gaze: DesignField | None = None
    breath: DesignField | None = None
    weight: DesignField | None = None
    hands: DesignField | None = None
    voice: DesignField | None = None
    delivery: DesignField | None = None
    reaction_order: DesignField | None = None
    exit_state: DesignField | None = None
    avoid: DesignField | None = None
    applicability: DesignField | None = None


class AnchorDesignFields(BaseModel):
    """可引用空间位置的完整设计。"""
    model_config = ConfigDict(extra='forbid')
    position: DesignField
    orientation: DesignField
    spatial_relation: DesignField
    scale: DesignField


class BlockingDesignFields(BaseModel):
    """调度状态与切换依据，完整采用。"""
    model_config = ConfigDict(extra='forbid')
    position: DesignField
    orientation: DesignField
    initiative: DesignField
    path: DesignField
    transition_reason: DesignField


class ActivityDesignFields(BaseModel):
    """镜内活动完整过程和明确时序。"""
    model_config = ConfigDict(extra='forbid')
    task: DesignField
    attention: DesignField
    main_action_effect: DesignField
    path: DesignField
    delay_basis: DesignField
    delay_ms: int | None = Field(default=None, ge=0)
    entry_exit: DesignField
    exit_state: DesignField
    depth: DesignField
    intensity: DesignField


class EnvironmentDesignFields(BaseModel):
    """环境活动与刻意留白分别表达。"""
    model_config = ConfigDict(extra='forbid')
    activity: DesignField
    empty_space: DesignField
    reason: DesignField


class SpatialReferencePayload(BaseModel):
    """空间对象只提供稳定身份和名称，不带设计正文或祖先。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['spatial_reference'] = Field(default='spatial_reference', json_schema_extra={'enum': ['spatial_reference']})
    category: Literal['anchor', 'blocking']
    reference_id: str
    name: str


class SpatialDesignRelations(BaseModel):
    """各空间关系用途保持独立；名称不授予读取正文的许可。"""
    model_config = ConfigDict(extra='forbid')
    space_id: str | None = None
    participant_id: str | None = None
    effect_object_ids: list[str] = Field(default_factory=list)
    position_anchor_ids: list[str] = Field(default_factory=list)
    area_anchor_id: str | None = None
    change_event_id: str | None = None
    trigger_event_id: str | None = None

class SoundDesignFields(BaseModel):
    """对白正文与声音安排的具体字段；制作安排不代表生成成果。"""
    model_config = ConfigDict(extra='forbid')
    content: DesignField | None = None
    source_description: DesignField | None = None
    environment: DesignField | None = None
    action_sound: DesignField | None = None
    music: DesignField | None = None
    production: Literal['synchronous', 'postproduction', 'undecided'] | None = None


class DialogueBasis(BaseModel):
    """表演明确采用的对白依据；不携带参考素材或祖先内容。"""
    model_config = ConfigDict(extra='forbid')
    dialogue_id: str
    version: int
    content: DesignField
    speaker: ObjectReferencePayload | None = None


class NarrativeOverviewFields(BaseModel):
    """本卡强类型完整叙事字段，保留显式状态。"""
    model_config = ConfigDict(extra='forbid')
    viewpoint: DesignField
    information_change: DesignField
    relationship_change: DesignField
    turning_point: DesignField
    open_questions: DesignField


class NarrativeBeatFields(BaseModel):
    """本卡强类型完整叙事字段，保留显式状态。"""
    model_config = ConfigDict(extra='forbid')
    objective: DesignField
    obstacle: DesignField
    expected_change: DesignField
    audience_must_see: DesignField


class NarrativeEventFields(BaseModel):
    """本卡强类型完整叙事字段，保留显式状态。"""
    model_config = ConfigDict(extra='forbid')
    action_change: DesignField


class ShotDesignFields(BaseModel):
    """本卡强类型完整叙事字段，保留显式状态。"""
    model_config = ConfigDict(extra='forbid')
    narrative_role: DesignField
    visible_result: DesignField
    estimated_duration: DesignField


class NarrativeReferencePayload(BaseModel):
    """稳定节拍、事件或镜头身份；不携带关联正文或媒体。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['narrative_reference'] = Field(default='narrative_reference', json_schema_extra={'enum': ['narrative_reference']})
    category: Literal['beat', 'event', 'shot']
    reference_id: str
    name: str


class NarrativeDesignRelation(BaseModel):
    """直接采用的用途与必要身份，保留多个不同用途。"""
    model_config = ConfigDict(extra='forbid')
    input_port: Literal['participant', 'effect_object', 'covered_beat', 'related_event', 'blocking_basis', 'beat', 'received_event', 'change_event', 'trigger_event', 'shot', 'space', 'position_anchor', 'area_anchor']
    reference: ObjectReferencePayload | SpatialReferencePayload | NarrativeReferencePayload


class FrameState(BaseModel):
    """导演明确提供的画面状态，图片仅定位其稳定身份。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str


class DesignTextPayload(BaseModel):
    """本卡完整设计及直接采用的必要对象，不包含祖先正文或示例媒体。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['design'] = Field(default='design', json_schema_extra={'enum': ['design']})
    design_type: Literal['direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment', 'direction.narrative', 'direction.beat', 'direction.event', 'direction.shot', 'direction.dialogue', 'direction.sound']
    adoption: Literal['whole_card'] = Field(default='whole_card', json_schema_extra={'enum': ['whole_card']})
    text: str
    frame_states: list[FrameState] = Field(default_factory=list, exclude_if=lambda value: not value)
    requires_frame_target: bool = Field(default=False, exclude_if=lambda value: not value)
    fields: NarrativeOverviewFields | NarrativeBeatFields | NarrativeEventFields | ShotDesignFields | PerformanceDesignFields | AnchorDesignFields | BlockingDesignFields | ActivityDesignFields | EnvironmentDesignFields | SoundDesignFields
    scope: DesignScope
    objects: list[ObjectReferencePayload] = Field(default_factory=list)
    spatial_relations: SpatialDesignRelations | None = Field(default=None, exclude_if=lambda value: value is None)
    references: list[SpatialReferencePayload | NarrativeReferencePayload] = Field(default_factory=list, exclude_if=lambda value: not value)
    narrative_relations: list[NarrativeDesignRelation] = Field(default_factory=list, exclude_if=lambda value: not value)
    participant_id: str | None = None
    dialogue_id: str | None = Field(default=None, exclude_if=lambda value: value is None)
    version: int | None = Field(default=None, exclude_if=lambda value: value is None)
    source_locator: str = ''
    dialogue_basis: list[DialogueBasis] = Field(default_factory=list, exclude_if=lambda value: not value)
