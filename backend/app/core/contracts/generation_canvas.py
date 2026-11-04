"""跨层画布输入输出值契约，不包含运行编排或存储行为。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator


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


class BasisTextOutputPayload(BaseModel):
    """创作依据直接输出正文与只读来源定位，定位信息不是模型指令。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['basis'] = Field(default='basis', json_schema_extra={'enum': ['basis']})
    text: str
    source_locator: str
    selection_start: int | None = None
    selection_end: int | None = None


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
    # 编辑来源不参与生成依据；正文独占的采用可随最后一处引用删除，独立采用仍保留。
    prompt_owned: bool | None = Field(default=None, exclude_if=lambda value: value is None)


class DesignMediaUse(BaseModel):
    """视频接收端对设计实际携带素材的用途；不创建候选或采用关系。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    source: OutputIdentity
    input_port: Literal['first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video']
    subject_name: str | None = None


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
    """固定具体文件；新增来源仅支持图片内容卡，旧的直接文件与历史产物绑定仍保留。"""
    model_config = ConfigDict(extra='forbid')
    file_id: str = Field(min_length=1, max_length=36)
    source: OutputIdentity | None = None
    result_set_id: str | None = None


class NamedImagePayload(BaseModel):
    """图片出口自含默认名称映射，无需接收端读取祖先。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['named_image'] = 'named_image'
    name: str = ''
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


class DesignFieldText(BaseModel):
    """Literal field text, never parsed again after reference expansion."""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    kind: Literal['text'] = Field(json_schema_extra={'enum': ['text']})
    text: str = ''


class DesignFieldReference(BaseModel):
    """A field owns its stable source, independently of model adoption bindings."""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    kind: Literal['reference'] = Field(json_schema_extra={'enum': ['reference']})
    source: OutputIdentity


class DesignFieldDocument(BaseModel):
    """Editor-independent field segments with unique diagnostic identities."""
    model_config = ConfigDict(extra='forbid')
    segments: list[DesignFieldText | DesignFieldReference] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_identities(self):
        """Repeated fragment identities cannot locate a reference unambiguously."""
        if len({segment.id for segment in self.segments}) != len(self.segments):
            raise ValueError('设计参数片段身份必须唯一')
        return self


class ReferenceDesignField(DesignField):
    """Design parameters with explicit, field-owned source references."""
    document: DesignFieldDocument | None = Field(default=None, exclude_if=lambda value: value is None)


class DesignMediaReference(BaseModel):
    """Actual active field media, with stable provenance and resolved availability."""
    model_config = ConfigDict(extra='forbid')
    source: OutputIdentity
    field_id: str
    modality: Literal['image', 'video', 'audio']
    token: str
    file_id: str | None = None
    result_set_id: str | None = None
    available: bool
    basis_current: bool = True
    payload: MediaOutputPayload | NamedImagePayload | None = None


class DesignMediaOrigin(BaseModel):
    """One actual media source can be required by several adopted design fields."""
    model_config = ConfigDict(extra='forbid')
    source: OutputIdentity
    field_id: str


class DesignReferenceIssue(BaseModel):
    """An active field problem follows adopted design output to model diagnostics."""
    model_config = ConfigDict(extra='forbid')
    source: OutputIdentity | None = None
    field_id: str
    reference_id: str
    code: str
    message: str


class DesignScope(BaseModel):
    """创作者声明的范围与制作阶段，不自动推断镜头适用性。"""
    model_config = ConfigDict(extra='forbid')
    description: str = ''
    phase: Literal['video', 'sound', 'postproduction'] | None = None
    condition: str = ''


class PerformanceDesignFields(BaseModel):
    """导演表演的具体业务字段；字段编辑不开放局部采用。"""
    model_config = ConfigDict(extra='forbid')
    situation: ReferenceDesignField | None = None
    relationship: ReferenceDesignField | None = None
    objective: ReferenceDesignField | None = None
    obstacle: ReferenceDesignField | None = None
    subtext: ReferenceDesignField | None = None
    attention: ReferenceDesignField | None = None
    internal_adjustment: ReferenceDesignField | None = None
    physical_action: ReferenceDesignField | None = None
    gaze: ReferenceDesignField | None = None
    breath: ReferenceDesignField | None = None
    weight: ReferenceDesignField | None = None
    hands: ReferenceDesignField | None = None
    voice: ReferenceDesignField | None = None
    delivery: ReferenceDesignField | None = None
    reaction_order: ReferenceDesignField | None = None
    exit_state: ReferenceDesignField | None = None
    avoid: ReferenceDesignField | None = None
    applicability: ReferenceDesignField | None = None


class AnchorDesignFields(BaseModel):
    """可引用空间位置的完整设计。"""
    model_config = ConfigDict(extra='forbid')
    position: ReferenceDesignField
    orientation: ReferenceDesignField
    spatial_relation: ReferenceDesignField
    scale: ReferenceDesignField


class BlockingDesignFields(BaseModel):
    """调度状态与切换依据，完整采用。"""
    model_config = ConfigDict(extra='forbid')
    position: ReferenceDesignField
    orientation: ReferenceDesignField
    initiative: ReferenceDesignField
    path: ReferenceDesignField
    transition_reason: ReferenceDesignField


class ActivityDesignFields(BaseModel):
    """镜内活动完整过程和明确时序。"""
    model_config = ConfigDict(extra='forbid')
    task: ReferenceDesignField
    attention: ReferenceDesignField
    main_action_effect: ReferenceDesignField
    path: ReferenceDesignField
    delay_basis: ReferenceDesignField
    delay_ms: int | None = Field(default=None, ge=0)
    entry_exit: ReferenceDesignField
    exit_state: ReferenceDesignField
    depth: ReferenceDesignField
    intensity: ReferenceDesignField


class EnvironmentDesignFields(BaseModel):
    """环境活动与刻意留白分别表达。"""
    model_config = ConfigDict(extra='forbid')
    activity: ReferenceDesignField
    empty_space: ReferenceDesignField
    reason: ReferenceDesignField


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
    speaker: ObjectReferencePayload | None = None

    @model_validator(mode='before')
    @classmethod
    def read_historical_basis(cls, value):
        """旧运行记录可读，但正文不再是关系出口的一部分。"""
        return {key: item for key, item in value.items() if key != 'content'} if isinstance(value, dict) else value


class DialogueReferencePayload(DialogueBasis):
    """对白关系出口只声明身份、版本与说话对象。"""
    kind: Literal['dialogue_reference'] = Field(default='dialogue_reference', json_schema_extra={'enum': ['dialogue_reference']})


class CriterionReferencePayload(BaseModel):
    """验收依据只提供稳定要求身份与名称，不包含标准正文或示例。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['criterion_reference'] = Field(default='criterion_reference', json_schema_extra={'enum': ['criterion_reference']})
    criterion_id: str
    name: str


class CreativeControlFields(BaseModel):
    """可发挥、保持和待定内容分别保留状态，不推断创作程度。"""
    model_config = ConfigDict(extra='forbid')
    freedom: DesignField
    allowed_range: DesignField
    keep: DesignField
    undecided: DesignField


class GenerationGuidanceFields(BaseModel):
    """生成优先级和参考要求仅作为设计，不自动采用媒体。"""
    model_config = ConfigDict(extra='forbid')
    priority: DesignField
    reference_requirements: DesignField
    sound_strategy: DesignField
    prohibitions: DesignField


class AcceptanceCriterionFields(BaseModel):
    """可观察的判断标准不代表结果已经通过验收。"""
    model_config = ConfigDict(extra='forbid')
    standard: DesignField


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


class SpaceRuleFields(BaseModel):
    """空间规则是设计要求，不校验自然语言的几何真实性。"""
    model_config = ConfigDict(extra='forbid')
    spatial_basis: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    shootable_area: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    axis: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    scale: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))


class ContinuityFields(BaseModel):
    """明确前后态是可定位状态，变化仍完整保留。"""
    model_config = ConfigDict(extra='forbid')
    before: DesignField = Field(default_factory=DesignField)
    change: DesignField = Field(default_factory=DesignField)
    after: DesignField = Field(default_factory=DesignField)
    following_constraints: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))


class ImmutableFactFields(BaseModel):
    """事实由创作者表述；来源定位不授权祖先正文读取。"""
    model_config = ConfigDict(extra='forbid')
    fact: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    source_basis: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))


class FrameState(BaseModel):
    """导演明确提供的画面状态，图片仅定位其稳定身份。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    label: str


class StyleDesignFields(BaseModel):
    """风格只保留可编辑创作意图；示例文件不属于设计输出。"""
    model_config = ConfigDict(extra='forbid')
    direction: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    visual_features: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    materials: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    colors: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    notes: ReferenceDesignField = Field(default_factory=ReferenceDesignField)


class DesignFrameTarget(BaseModel):
    """构图显式定位同画布运镜的画面，不构成正文或媒体采用。"""
    model_config = ConfigDict(extra='forbid')
    card_id: str = Field(min_length=1, max_length=64)
    state_id: str = Field(default='', max_length=128)


class DesignFrameDependency(BaseModel):
    """目标画面引用的固定来源事实；不是接收模型采用的媒体。"""
    model_config = ConfigDict(extra='forbid')
    source: OutputIdentity
    file_id: str | None = None
    result_set_id: str | None = None
    available: bool
    basis_current: bool = True


class ResolvedDesignFrameTarget(BaseModel):
    """只解析目标画面元信息，用于诊断和固定执行依据。"""
    model_config = ConfigDict(extra='forbid')
    target: DesignFrameTarget
    available: bool
    label: str = ''
    frame: DesignField | None = None
    dependencies: list[DesignFrameDependency] = Field(default_factory=list)


class CameraDesignFields(BaseModel):
    """Camera owns only its declared design parameters."""
    model_config = ConfigDict(extra='forbid')
    viewpoint: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    position: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    height_angle: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    lens_effect: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    support: ReferenceDesignField = Field(default_factory=ReferenceDesignField)


class LightingDesignFields(BaseModel):
    """Lighting owns only its declared design parameters."""
    model_config = ConfigDict(extra='forbid')
    light_sources: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    light_direction: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    light_regions: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    exposure_color: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    color_relationship: ReferenceDesignField = Field(default_factory=ReferenceDesignField)


class FocusDesignFields(BaseModel):
    """Focus owns only its declared design parameters."""
    model_config = ConfigDict(extra='forbid')
    depth_focus: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    focus_change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    optical_effects: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    motion_texture: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    technical_parameters: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    adjacent_requirements: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    prohibitions: ReferenceDesignField = Field(default_factory=ReferenceDesignField)

class CompositionFramingField(ReferenceDesignField):
    """构图的结构化景别；跨卡画面定位另由显式关系表达。"""
    size: Literal['extreme_close_up', 'close_up', 'medium', 'full', 'wide', 'extreme_wide'] | None = None
    target_id: str = ''
    state_id: str | None = None


class CompositionDesignFields(BaseModel):
    """构图独立拥有所属字段，不包含其他摄影分区。"""
    model_config = ConfigDict(extra='forbid')
    shot_size: CompositionFramingField = Field(default_factory=CompositionFramingField)
    composition: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    frame_position: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    depth_layers: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    negative_space: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    composition_requirements: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
class MovementDesignFields(BaseModel):
    """独立运镜字段；其他摄影区域不属于本卡。"""
    model_config = ConfigDict(extra='forbid')
    movement_type: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    movement_start: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    movement_trigger: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    movement_path: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    movement_speed: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    end_frame: ReferenceDesignField = Field(default_factory=ReferenceDesignField)


class MovementPhase(BaseModel):
    """明确画面阶段的稳定身份，不随名称和排序改变。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = ''
    frame: ReferenceDesignField = Field(default_factory=ReferenceDesignField)


class DesignTextPayload(BaseModel):
    """本卡完整设计及直接采用的必要对象，不包含祖先正文或示例媒体。"""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['design'] = Field(default='design', json_schema_extra={'enum': ['design']})
    design_type: Literal['direction.movement', 'direction.composition', 'direction.camera', 'direction.lighting', 'direction.focus', 'direction.style', 'direction.space_rule', 'direction.continuity', 'direction.fact', 'direction.creative_control', 'direction.guidance', 'direction.criterion', 'direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment', 'direction.narrative', 'direction.beat', 'direction.event', 'direction.shot', 'direction.dialogue', 'direction.sound']
    material_references: list[DesignMediaReference] = Field(default_factory=list, exclude_if=lambda value: not value)
    reference_issues: list[DesignReferenceIssue] = Field(default_factory=list, exclude_if=lambda value: not value)
    adoption: Literal['whole_card'] = Field(default='whole_card', json_schema_extra={'enum': ['whole_card']})
    text: str
    frame_target_state: ResolvedDesignFrameTarget | None = Field(default=None, exclude_if=lambda value: value is None)
    movement_phases: list[MovementPhase] = Field(default_factory=list, exclude_if=lambda value: not value)
    frame_states: list[FrameState] = Field(default_factory=list, exclude_if=lambda value: not value)
    requires_frame_target: bool = Field(default=False, exclude_if=lambda value: not value)
    fields: MovementDesignFields | CompositionDesignFields | CameraDesignFields | LightingDesignFields | FocusDesignFields | StyleDesignFields | SpaceRuleFields | ContinuityFields | ImmutableFactFields | CreativeControlFields | GenerationGuidanceFields | AcceptanceCriterionFields | NarrativeOverviewFields | NarrativeBeatFields | NarrativeEventFields | ShotDesignFields | PerformanceDesignFields | AnchorDesignFields | BlockingDesignFields | ActivityDesignFields | EnvironmentDesignFields | SoundDesignFields
    scope: DesignScope
    objects: list[ObjectReferencePayload] = Field(default_factory=list)
    spatial_relations: SpatialDesignRelations | None = Field(default=None, exclude_if=lambda value: value is None)
    references: list[SpatialReferencePayload | NarrativeReferencePayload] = Field(default_factory=list, exclude_if=lambda value: not value)
    narrative_relations: list[NarrativeDesignRelation] = Field(default_factory=list, exclude_if=lambda value: not value)
    participant_id: str | None = None
    dialogue_id: str | None = Field(default=None, exclude_if=lambda value: value is None)
    version: int | None = Field(default=None, exclude_if=lambda value: value is None)
    source_locator: str = ''
    acceptance_basis: list[CriterionReferencePayload] = Field(default_factory=list, exclude_if=lambda value: not value)
    dialogue_basis: list[DialogueBasis] = Field(default_factory=list, exclude_if=lambda value: not value)
