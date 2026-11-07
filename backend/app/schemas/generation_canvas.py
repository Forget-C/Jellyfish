"""首个画布消费者使用的轻量类型契约，不包含布局或运行状态。"""
from app.core.contracts.generation_canvas import ReferenceDesignField, StyleDesignFields, CameraDesignFields, LightingDesignFields, FocusDesignFields, MovementDesignFields, MovementPhase
from typing import Annotated, Any, ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.common import ApiResponse
from app.core.contracts.media import VideoMediaInput
from app.core.contracts.generation_canvas import DesignMediaUse, CompositionDesignFields, DesignFrameTarget, DesignMediaOrigin, BasisTextOutputPayload, DialogueReferencePayload, OutputIdentity, InputBinding, TextOutputPayload, MediaOutputPayload, ObjectReferencePayload, DescriptionTextPayload, ReferenceImageBinding, NamedImagePayload, CanvasSourceMapping, NamedImageMapping, DesignScope, CriterionReferencePayload, DesignTextPayload, SpatialReferencePayload, NarrativeReferencePayload


from app.core.contracts.photography import PhotographyTextPayload, ImageFrameTarget


class CardDefinition(BaseModel):
    """卡片的稳定身份与类型版本；具体类型声明自己的端口及内容。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    type_version: Literal[1] = 1
    input_ports: ClassVar[tuple[str, ...]] = ()
    output_ports: ClassVar[tuple[str, ...]] = ()


class CanvasContentOrigin(BaseModel):
    """独立内容固定的历史来源；未完成标记不能因后续编辑或运行而消失。"""
    model_config = ConfigDict(extra='forbid')
    canvas_id: str
    run_id: str
    node_id: str
    position: int = Field(ge=0)
    incomplete: bool


class TextContentCard(CardDefinition):
    """一张卡一份文本，空字符串可以保存但没有可用输出。"""
    type: Literal['content.text'] = 'content.text'
    text: str = ''
    origin: CanvasContentOrigin | None = Field(default=None, exclude_if=lambda value: value is None)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class CreativeBasisCard(CardDefinition):
    """独立创作依据保留来源定位，不绑定章节或持续输入。"""
    type: Literal['content.basis'] = 'content.basis'
    text: str = ''
    source_locator: str = ''
    selection_start: int | None = Field(default=None, ge=0)
    selection_end: int | None = Field(default=None, ge=0)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class ObjectDescriptionCard(CardDefinition):
    """画布内独立描述对象；未完成名称或身份可以保存但不发布引用。"""
    object_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(default='', max_length=255)
    category: Literal['character', 'prop', 'costume', 'place'] = 'character'
    text: str = ''
    source_locator: str = ''
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'object')


class CharacterDescriptionCard(ObjectDescriptionCard):
    """人物描述的类别由卡片类型固定。"""
    type: Literal['content.character'] = 'content.character'
    category: Literal['character'] = 'character'


class PropDescriptionCard(ObjectDescriptionCard):
    """道具描述与人物、服装独立命名。"""
    type: Literal['content.prop'] = 'content.prop'
    category: Literal['prop'] = 'prop'


class CostumeDescriptionCard(ObjectDescriptionCard):
    """服装描述的类别由卡片类型固定。"""
    type: Literal['content.costume'] = 'content.costume'
    category: Literal['costume'] = 'costume'


class PlaceDescriptionCard(ObjectDescriptionCard):
    """场所描述不创建旧场次的 Scene 资产。"""
    type: Literal['content.place'] = 'content.place'
    category: Literal['place'] = 'place'




class PromptText(BaseModel):
    """普通正文保留字面内容，不因候选重排而改写。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    kind: Literal['text'] = Field(json_schema_extra={'enum': ['text']})
    text: str = ''


class PromptReference(BaseModel):
    """引用按稳定片段身份定位，显示代号由接收端计算。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    kind: Literal['reference'] = Field(json_schema_extra={'enum': ['reference']})
    binding_id: str | None = None
    source: OutputIdentity | None = Field(default=None, exclude=True)


class PromptInstruction(BaseModel):
    """本地显式系统指令；视频用途的具体映射由视频编译器消费。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    kind: Literal['instruction'] = Field(json_schema_extra={'enum': ['instruction']})
    command: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    references: list[PromptReference] = Field(default_factory=list)


class PromptDocument(BaseModel):
    """编辑器无关的原文、稳定引用与指令；不存正文偏移。"""
    model_config = ConfigDict(extra='forbid')
    segments: list[PromptText | PromptReference | PromptInstruction] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_segment_identities(self):
        """片段和指令内引用共享定位命名空间，避免诊断指向多处。"""
        identities = []
        for segment in self.segments:
            identities.append(segment.id)
            if isinstance(segment, PromptInstruction):
                identities.extend(reference.id for reference in segment.references)
        if len(identities) != len(set(identities)):
            raise ValueError('提示词片段身份必须唯一')
        return self


class ModelCard(CardDefinition):
    """模型切换只替换模型身份；未完成配置也可持久保存。"""
    model_id: str | None = None
    show_result_cards: bool = Field(default=False, exclude_if=lambda value: not value, description='在画布展开正式结果，仅控制显示')
    missing_designs: list[str] = Field(default_factory=list, description='已移除设计的稳定身份，补充或明确处理前阻塞运行')
    prompt: PromptDocument = Field(default_factory=PromptDocument)
    input_bindings: list[InputBinding] = Field(default_factory=list)

    @model_validator(mode='after')
    def resolve_prompt_bindings(self):
        """读取旧文档时规范化来源；写出的提示词只保留绑定身份。"""
        bindings = {binding.id: binding for binding in self.input_bindings}
        legacy_groups = {binding.id for binding in self.input_bindings if 'subject_name' not in binding.model_fields_set}
        if len(bindings) != len(self.input_bindings):
            raise ValueError('输入绑定身份必须唯一')
        # after 校验器收到的是 PromptDocument；Pylint 误将默认工厂推断为 FieldInfo。
        for segment in self.prompt.segments:  # pylint: disable=no-member
            refs = [segment] if isinstance(segment, PromptReference) else segment.references if isinstance(segment, PromptInstruction) else []
            port = {'首帧参考': 'first_frame', '尾帧参考': 'last_frame', '关键帧参考': 'key_frame', '主体参考': 'subject_image'}.get(
                getattr(segment, 'command', ''), None)
            for ref in refs:
                subject_name = segment.parameters.get('name', '').strip() if isinstance(segment, PromptInstruction) and segment.command == '主体参考' else None
                if ref.binding_id is None:
                    if ref.source is None:
                        raise ValueError('引用缺少输入绑定')
                    actual_port = port or ref.source.port_id
                    if self.type == 'model.video' and actual_port in ('image', 'video'):
                        actual_port = 'subject_' + actual_port
                    if actual_port == 'subject_image' and ref.source.port_id == 'video':
                        actual_port = 'subject_video'
                    existing = next((binding for binding in bindings.values()
                        if binding.source == ref.source and binding.input_port == actual_port and binding.subject_name == subject_name), None)
                    binding = existing or InputBinding(id='input-' + ref.id, source=ref.source, input_port=actual_port, subject_name=subject_name)
                    bindings[binding.id] = binding
                    ref.binding_id = binding.id
                binding = bindings.get(ref.binding_id)
                if binding is None:
                    raise ValueError('引用的输入绑定不存在')
                if ref.source is not None and ref.source != binding.source:
                    raise ValueError('引用来源与输入绑定不一致')
                # 旧 v2 跨主体复用绑定；规范化时拆开用途，不能静默任选第一个主体。
                if subject_name is not None and binding.id in legacy_groups and binding.subject_name not in (None, subject_name):
                    grouped = next((value for value in bindings.values() if value.source == binding.source
                        and value.input_port == binding.input_port and value.subject_name == subject_name), None)
                    if grouped is None:
                        identifier = 'input-' + ref.id
                        while identifier in bindings:
                            identifier += '-group'
                        grouped = binding.model_copy(update={'id': identifier, 'subject_name': subject_name})
                        bindings[grouped.id] = grouped
                    binding = grouped
                    ref.binding_id = binding.id
                if subject_name is not None and binding.subject_name is None:
                    binding.subject_name = subject_name
                ref.source = binding.source
        self.input_bindings = list(bindings.values())
        return self


class TextModelConfig(BaseModel):
    """文本请求使用模型管理中的有效参数；当前 DTO 没有逐卡覆盖参数。"""
    model_config = ConfigDict(extra='forbid')


class ImageModelConfig(BaseModel):
    """与 ImageGenerationOperationInput 对齐，范围问题留给运行诊断。"""
    model_config = ConfigDict(extra='forbid')
    target_ratio: str | None = None
    resolution_profile: str | None = None
    count: int = 1


class VideoModelConfig(BaseModel):
    """视频仅开放已接入的画幅、时长和随机种子。"""
    model_config = ConfigDict(extra='forbid')
    ratio: str | None = None
    seconds: int | None = None
    seed: int | None = None


class TextModelCard(ModelCard):
    """纯文本模型，不虚报多模态理解能力。"""
    type: Literal['model.text'] = 'model.text'
    config: TextModelConfig = Field(default_factory=TextModelConfig)
    input_ports: ClassVar[tuple[str, ...]] = ('text',)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class ImageModelCard(ModelCard):
    """图片处理卡，参考图片必须被接收端明确使用。"""
    type: Literal['model.image'] = 'model.image'
    config: ImageModelConfig = Field(default_factory=ImageModelConfig)
    frame_targets: list[ImageFrameTarget] = Field(default_factory=list)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image')
    output_ports: ClassVar[tuple[str, ...]] = ('image',)


class VideoModelCard(ModelCard):
    """视频处理卡；目标端口固定帧与主体用途。"""
    type: Literal['model.video'] = 'model.video'
    config: VideoModelConfig = Field(default_factory=VideoModelConfig)
    design_media_uses: list[DesignMediaUse] = Field(default_factory=list)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video')
    output_ports: ClassVar[tuple[str, ...]] = ('video',)

    @model_validator(mode='after')
    def unique_design_uses(self):
        """用途身份唯一；空分组和不支持的用途留给可定位的编译诊断。"""
        ids = [use.id for use in self.design_media_uses]
        if len(ids) != len(set(ids)):
            raise ValueError('设计素材用途 id 不得重复')
        return self


class CanvasResultScope(BaseModel):
    """模型候选范围。only 指定位置，except 保留新增位置的候选资格。"""
    model_config = ConfigDict(extra='forbid')
    mode: Literal['only', 'except']
    positions: Annotated[list[Annotated[int, Field(ge=0, strict=True)]], Field(min_length=1)]

    @model_validator(mode='after')
    def normalize_positions(self):
        """位置范围是集合，顺序由接收端连接顺序决定。"""
        if len(self.positions) != len(set(self.positions)):
            raise ValueError('输出位置不能重复')
        self.positions.sort()
        return self


class GenerationCanvasEdge(BaseModel):
    """候选连接只描述来源和用途，不代表实际使用。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    source_card: str
    source_port: str
    target_card: str
    target_port: str
    result_scope: Annotated[CanvasResultScope | None, Field(exclude_if=lambda value: value is None)] = None

    def includes_position(self, position: int) -> bool:
        """无范围的既有连线接收该端口全部当前及未来结果。"""
        scope = self.result_scope
        return scope is None or (position in scope.positions) == (scope.mode == 'only')


class GenerationCanvasGroup(BaseModel):
    """编组与只读堆叠组织独立成员，不提供聚合输出。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    card_ids: list[str] = Field(default_factory=list)
    kind: Literal['group', 'stack'] = 'group'
    collapsed: bool = False


class CanvasModelCapability(BaseModel):
    """当前适配器真正接入的模态、用途、组合、数量及参数范围。"""
    model_id: str
    modality: Literal['text', 'image', 'video']
    input_ports: list[str]
    ratios: list[str] = Field(default_factory=list)
    resolution_profiles: dict[str, dict[str, str]] = Field(default_factory=dict)
    min_count: int = 1
    max_count: int = 10
    max_reference_images: int | None = None
    supports_duplicate_reference_images: bool = True
    min_seconds: int | None = None
    max_seconds: int | None = None
    supports_seed: bool = False
    supports_subject_reference_with_frame_reference: bool = False
    max_subjects: int | None = None
    max_images_per_subject: int | None = None
    max_videos_per_subject: int | None = None
    max_media_per_subject: int | None = None
    max_total_subject_videos: int | None = None


class MediaContentCard(CardDefinition):
    """媒体内容固定引用一份项目文件；上传期间已有文件仍受保护但不发布输出。"""
    file_id: str | None = Field(default=None, min_length=1, max_length=36)
    uploading: bool = False
    origin: CanvasContentOrigin | None = Field(default=None, exclude_if=lambda value: value is None)


class ImageContentCard(MediaContentCard):
    """图片内容卡只有一个图片输出位置。"""
    type: Literal['content.image'] = 'content.image'
    output_ports: ClassVar[tuple[str, ...]] = ('image',)


class VideoContentCard(MediaContentCard):
    """视频内容保留完整文件及自带音轨。"""
    type: Literal['content.video'] = 'content.video'
    output_ports: ClassVar[tuple[str, ...]] = ('video',)


class AudioContentCard(MediaContentCard):
    """音频内容卡只导入和播放，不提供音频生成。"""
    type: Literal['content.audio'] = 'content.audio'
    output_ports: ClassVar[tuple[str, ...]] = ('audio',)




class NamedImageReferenceCard(CardDefinition):
    """单张图片、单个映射名称；允许未完成草稿，名称有效后才发布输出。"""
    type_version: Literal[2] = 2
    type: Literal['reference.character', 'reference.place', 'reference.prop', 'reference.costume']
    name: str = Field(default='', max_length=255)
    angle: str = '正面'
    object_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name_binding: OutputIdentity | None = None
    image_binding: ReferenceImageBinding | None = None
    input_ports: ClassVar[tuple[str, ...]] = ('name', 'image_source')
    output_ports: ClassVar[tuple[str, ...]] = ('image', 'object')



class DesignMediaExample(BaseModel):
    """示例只关联直接媒体，正反用途及视频／音频有效区间不成为生成输入。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    source: OutputIdentity
    file_id: str = Field(min_length=1)
    purpose: Literal['positive', 'negative'] = 'positive'
    field_id: str | None = Field(default=None, pattern=r'^[a-z_]+$')
    description: str = ''
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, gt=0)

    @model_validator(mode='after')
    def validate_interval(self):
        """图片无时间区间，视频与音频起止必须完整且递增。"""
        if (self.start_ms is None) != (self.end_ms is None):
            raise ValueError('有效区间须同时填写起点和终点')
        if self.end_ms is not None and (self.source.port_id not in ('video', 'audio') or self.end_ms <= self.start_ms):
            raise ValueError('仅视频或音频可以使用递增有效区间')
        return self


class PerformanceDirectionCard(CardDefinition):
    """独立导演设计公共元信息；无章节、节拍或镜头前置要求。"""
    scope: DesignScope = Field(default_factory=DesignScope)
    source_locator: str = ''
    input_bindings: list[InputBinding] = Field(default_factory=list)
    examples: list[DesignMediaExample] = Field(default_factory=list)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class CharacterSituationCard(PerformanceDirectionCard):
    """情境只维护本卡处境和关系背景，不复制对象描述。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.situation'] = Field(default='direction.situation', json_schema_extra={'enum': ['direction.situation']})
    situation: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    relationship: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor', 'participant')


class CharacterPerformanceCard(PerformanceDirectionCard):
    """完整表演；可选后续端点待对应来源票据接入，不伪造身份。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.performance'] = Field(default='direction.performance', json_schema_extra={'enum': ['direction.performance']})
    objective: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    obstacle: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    subtext: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    attention: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    internal_adjustment: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    physical_action: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    gaze: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    breath: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    weight: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    hands: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    voice: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    delivery: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    reaction_order: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    exit_state: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    avoid: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor', 'participant', 'beat', 'received_event', 'dialogue_basis', 'acceptance_basis')


class PerformanceRuleCard(PerformanceDirectionCard):
    """规则保留背景或约束用途、适用范围和必要制作阶段。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.performance_rule'] = Field(default='direction.performance_rule', json_schema_extra={'enum': ['direction.performance_rule']})
    applicability: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')


class GuidanceDirectionCard(PerformanceDirectionCard):
    """创作要求沿用设计保存和固定示例保护，字段由具体卡声明。"""
    name: str = ''
    input_ports: ClassVar[tuple[str, ...]] = ('effect_object', 'image_example', 'video_example')


class CreativeControlCard(GuidanceDirectionCard):
    """控制发挥范围，不建立全场自动适用规则。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.creative_control'] = Field(default='direction.creative_control', json_schema_extra={'enum': ['direction.creative_control']})
    freedom: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    allowed_range: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    keep: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    undecided: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(state='undecided'))

    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')


class GenerationGuidanceCard(GuidanceDirectionCard):
    """编译要求是创作者表达，参考需求不替代明确输入绑定。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.guidance'] = Field(default='direction.guidance', json_schema_extra={'enum': ['direction.guidance']})
    priority: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    reference_requirements: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    sound_strategy: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    prohibitions: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))

    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')


class AcceptanceCriterionCard(GuidanceDirectionCard):
    """稳定要求身份独立于标准正文，使用方明确选择引用。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.criterion'] = Field(default='direction.criterion', json_schema_extra={'enum': ['direction.criterion']})
    criterion_id: str | None = Field(default=None, min_length=1, max_length=64)
    standard: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'criterion')

    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')


class SpatialDirectionCard(PerformanceDirectionCard):
    """空间设计共用保存和媒体保护，业务字段仍由各具体类型声明。"""


class AnchorImageMarker(BaseModel):
    """图片归一化坐标只定位示意，不推断实际几何。"""
    model_config = ConfigDict(extra='forbid')
    example_id: str = Field(min_length=1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class SpatialAnchorCard(SpatialDirectionCard):
    """文字可先于参考图；锚点身份不随媒体更换。"""
    type: Literal['direction.anchor'] = Field(default='direction.anchor', json_schema_extra={'enum': ['direction.anchor']})
    anchor_id: str | None = Field(default=None, min_length=1, max_length=64)
    markers: list[AnchorImageMarker] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_markers(self):
        """标记必须指向本卡明确关联的图片，每张示意图一个位置。"""
        ids = [marker.example_id for marker in self.markers]
        if len(ids) != len(set(ids)) or any(not any(example.id == ident and example.source.port_id == 'image' for example in self.examples) for ident in ids):
            raise ValueError('锚点标记须对应唯一的已关联图片')
        return self
    name: str = ''
    position: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    orientation: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    spatial_relation: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    scale: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor', 'space', 'image_example', 'video_example')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'anchor')


class BlockingDirectionCard(SpatialDirectionCard):
    """明确调度对象供后续镜头引用；事件来源后续接入。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.blocking'] = Field(default='direction.blocking', json_schema_extra={'enum': ['direction.blocking']})
    blocking_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str = ''
    position: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    orientation: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    initiative: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    path: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    transition_reason: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor', 'participant', 'position_anchor', 'change_event')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'blocking')


class InFrameActivityCard(SpatialDirectionCard):
    """持续任务、反应延迟与入出画；触发事件不自动执行。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.activity'] = Field(default='direction.activity', json_schema_extra={'enum': ['direction.activity']})
    task: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    attention: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    main_action_effect: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    path: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    delay_basis: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    delay_ms: int | None = Field(default=None, ge=0)
    entry_exit: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    exit_state: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    depth: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    intensity: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor', 'participant', 'area_anchor', 'trigger_event')


class EnvironmentActivityCard(SpatialDirectionCard):
    """环境活动与留白不要求先建镜头、人物或节拍。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.environment'] = Field(default='direction.environment', json_schema_extra={'enum': ['direction.environment']})
    activity: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    empty_space: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    reason: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')

class SoundDirectionCard(CardDefinition):
    """声音设计仅关联直接对象与固定素材，不新增模型音频输入。"""
    scope: DesignScope = Field(default_factory=DesignScope)
    source_locator: str = ''
    input_bindings: list[InputBinding] = Field(default_factory=list)
    examples: list[DesignMediaExample] = Field(default_factory=list)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class DialogueCard(SoundDirectionCard):
    """一条稳定身份的对白，内容随画布修订保存。"""
    type: Literal['direction.dialogue'] = Field(default='direction.dialogue', json_schema_extra={'enum': ['direction.dialogue']})
    dialogue_id: str = Field(min_length=1, max_length=64)
    content: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('speaker', 'video_example', 'audio_example', 'text')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'dialogue')


class SoundArrangementCard(SoundDirectionCard):
    """声源、环境声、动作声和音乐约束保持各自用途。"""
    type: Literal['direction.sound'] = Field(default='direction.sound', json_schema_extra={'enum': ['direction.sound']})
    source_description: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    environment: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    action_sound: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    music: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('audio_example', 'text', 'image', 'video', 'anchor')


class VisualStyleCard(PerformanceDirectionCard):
    """独立风格整卡采用，内置预设应用后成为本卡普通字段。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.style'] = Field(default='direction.style', json_schema_extra={'enum': ['direction.style']})
    fields: StyleDesignFields = Field(default_factory=StyleDesignFields)
    input_ports: ClassVar[tuple[str, ...]] = ('image_example', 'video_example', 'text', 'image', 'video', 'audio', 'object')


class CameraCard(PerformanceDirectionCard):
    """Independent camera design, adopted only as a whole."""
    type: Literal['direction.camera'] = Field(default='direction.camera', json_schema_extra={'enum': ['direction.camera']})
    fields: CameraDesignFields = Field(default_factory=CameraDesignFields)
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    input_ports: ClassVar[tuple[str, ...]] = ('shot', 'acceptance_basis', 'text', 'image', 'video', 'audio', 'object')


class LightingCard(PerformanceDirectionCard):
    """Independent lighting design, adopted only as a whole."""
    type: Literal['direction.lighting'] = Field(default='direction.lighting', json_schema_extra={'enum': ['direction.lighting']})
    fields: LightingDesignFields = Field(default_factory=LightingDesignFields)
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    input_ports: ClassVar[tuple[str, ...]] = ('shot', 'acceptance_basis', 'text', 'image', 'video', 'audio', 'object')


class FocusCard(PerformanceDirectionCard):
    """Independent focus design, adopted only as a whole."""
    type: Literal['direction.focus'] = Field(default='direction.focus', json_schema_extra={'enum': ['direction.focus']})
    fields: FocusDesignFields = Field(default_factory=FocusDesignFields)
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    input_ports: ClassVar[tuple[str, ...]] = ('attention_object', 'focus_object', 'shot', 'acceptance_basis', 'text', 'image', 'video', 'audio', 'object')

class CompositionCard(PerformanceDirectionCard):
    """独立景别与构图，仅整卡采用。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.composition'] = Field(default='direction.composition', json_schema_extra={'enum': ['direction.composition']})
    fields: CompositionDesignFields = Field(default_factory=CompositionDesignFields)
    frame_target: DesignFrameTarget | None = Field(default=None, exclude_if=lambda value: value is None)
    input_ports: ClassVar[tuple[str, ...]] = ('shot', 'acceptance_basis', 'image_example', 'video_example', 'text', 'image', 'video', 'audio', 'object')
class MovementCard(PerformanceDirectionCard):
    """独立运镜及稳定阶段，只有整卡设计出口。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.movement'] = Field(default='direction.movement', json_schema_extra={'enum': ['direction.movement']})
    fields: MovementDesignFields = Field(default_factory=MovementDesignFields)
    phases: list[MovementPhase] = Field(default_factory=list)
    input_ports: ClassVar[tuple[str, ...]] = ('attention_object', 'shot', 'acceptance_basis', 'image_example', 'video_example', 'text', 'image', 'video', 'audio', 'object')

    @model_validator(mode='after')
    def validate_phase_ids(self):
        """阶段重复身份无法可靠定位，保存时拒绝。"""
        if len({phase.id for phase in self.phases}) != len(self.phases):
            raise ValueError('运镜阶段身份必须唯一')
        return self


class NarrativeDirectionCard(PerformanceDirectionCard):
    """独立叙事设计，不要求完整场次计划。"""
    name: str = ''


class NarrativeOverviewCard(NarrativeDirectionCard):
    """narrative 的专用字段及可选直接关系。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.narrative'] = Field(default='direction.narrative', json_schema_extra={'enum': ['direction.narrative']})
    viewpoint: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    information_change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    relationship_change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    turning_point: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    open_questions: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')


class NarrativeBeatCard(NarrativeDirectionCard):
    """beat 的专用字段及可选直接关系。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.beat'] = Field(default='direction.beat', json_schema_extra={'enum': ['direction.beat']})
    beat_id: str | None = Field(default=None, min_length=1, max_length=64)
    objective: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    obstacle: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    expected_change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    audience_must_see: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('related_event', 'text', 'image', 'video', 'anchor')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'beat')


class NarrativeEventCard(NarrativeDirectionCard):
    """event 的专用字段及可选直接关系。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.event'] = Field(default='direction.event', json_schema_extra={'enum': ['direction.event']})
    event_id: str | None = Field(default=None, min_length=1, max_length=64)
    action_change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'anchor')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'event')


class ShotDesignCard(NarrativeDirectionCard):
    """shot 的专用字段及可选直接关系。"""
    examples: list[DesignMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.shot'] = Field(default='direction.shot', json_schema_extra={'enum': ['direction.shot']})
    shot_id: str | None = Field(default=None, min_length=1, max_length=64)
    narrative_role: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    visible_result: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    estimated_duration: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'covered_beat', 'related_event', 'blocking_basis', 'acceptance_basis', 'text', 'image', 'video', 'anchor')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'shot')


class ConstraintMediaExample(DesignMediaExample):
    """前后态与证据固定到直接媒体产物及对应字段。"""
    purpose: Literal['positive', 'negative', 'before', 'after', 'evidence'] = 'evidence'
    field_id: Literal['spatial_basis', 'shootable_area', 'axis', 'scale', 'before', 'change', 'after', 'following_constraints', 'fact', 'source_basis'] | None = None


class ConstraintDirectionCard(PerformanceDirectionCard):
    """空间、连续性和事实共享直接关系及固定证据机制。"""
    examples: list[ConstraintMediaExample] = Field(default_factory=list)


class SpaceRuleCard(ConstraintDirectionCard):
    """空间规则可独立使用，所属空间只提供身份和名称。"""
    examples: list[ConstraintMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.space_rule'] = Field(default='direction.space_rule', json_schema_extra={'enum': ['direction.space_rule']})
    spatial_basis: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    shootable_area: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    axis: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    scale: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('space', 'text', 'image', 'video', 'anchor')


class ContinuityCard(ConstraintDirectionCard):
    """可选主体及事件，前后态不会变成隐式首尾帧。"""
    examples: list[ConstraintMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.continuity'] = Field(default='direction.continuity', json_schema_extra={'enum': ['direction.continuity']})
    category: Literal['space', 'appearance', 'hands_props', 'environment', 'photography', 'dialogue_sound'] = 'space'
    before: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    change: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    after: ReferenceDesignField = Field(default_factory=ReferenceDesignField)
    following_constraints: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'related_event', 'text', 'image', 'video', 'audio', 'anchor')


class ImmutableFactCard(ConstraintDirectionCard):
    """保留事实、来源与范围，不验证文本或图片真伪。"""
    examples: list[ConstraintMediaExample] = Field(default_factory=list, max_length=0)
    type: Literal['direction.fact'] = Field(default='direction.fact', json_schema_extra={'enum': ['direction.fact']})
    fact: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='constraint'))
    source_basis: ReferenceDesignField = Field(default_factory=lambda: ReferenceDesignField(purpose='background'))
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image', 'video', 'audio', 'anchor')


class CanvasDocument(BaseModel):
    """完整编辑文档；位置、尺寸和视角由浏览器另存。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    project_id: str
    name: str = Field(min_length=1, max_length=255)
    schema_version: Literal[2] = 2
    cover_file_id: str | None = Field(default=None, min_length=1, max_length=36)
    cards: list[MovementCard | CompositionCard | CameraCard | LightingCard | FocusCard | VisualStyleCard | SpaceRuleCard | ContinuityCard | ImmutableFactCard | CreativeControlCard | GenerationGuidanceCard | AcceptanceCriterionCard | DialogueCard | SoundArrangementCard | NarrativeOverviewCard | NarrativeBeatCard | NarrativeEventCard | ShotDesignCard | SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard | CharacterSituationCard | CharacterPerformanceCard | PerformanceRuleCard | NamedImageReferenceCard | TextContentCard | CreativeBasisCard | CharacterDescriptionCard | PropDescriptionCard | CostumeDescriptionCard | PlaceDescriptionCard | ImageContentCard | VideoContentCard | AudioContentCard | TextModelCard | ImageModelCard | VideoModelCard] = Field(default_factory=list)
    edges: list[GenerationCanvasEdge] = Field(default_factory=list)
    input_order: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    groups: list[GenerationCanvasGroup] = Field(default_factory=list)



    @model_validator(mode='after')
    def synchronize_reference_names(self):
        """关联名称由同类描述拥有；同步不复制正文，也不改写关联和本地对象身份。"""
        cards = {card.id: card for card in self.cards}
        for card in self.cards:
            if not isinstance(card, NamedImageReferenceCard) or not card.name_binding:
                continue
            source = cards.get(card.name_binding.card_id)
            if isinstance(source, ObjectDescriptionCard) and source.category == card.type.split('.')[1] and source.object_id == card.name_binding.object_id:
                card.name = source.name
        return self



class CanvasCreate(BaseModel):
    """创建无需章节或场次的项目画布。"""
    name: str = Field(default='未命名画布', min_length=1, max_length=255)


class CanvasSave(BaseModel):
    """请求正文保持原样用于幂等核实，服务层返回带定位的结构诊断。"""
    request_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=0)
    document: Any


class CanvasRead(BaseModel):
    """当前保存的内容和 CAS 修订。"""
    id: str
    project_id: str
    revision: int
    document: CanvasDocument


class CanvasSaved(BaseModel):
    """可持久重放的原保存回执。"""
    request_id: str
    canvas_id: str
    revision: int


class CanvasDiagnostic(BaseModel):
    """按稳定身份和字段路径定位的业务诊断。"""
    code: str
    severity: Literal['error', 'warning'] = 'error'
    message: str
    target: dict[str, Any]
    blocks: list[str]


class CanvasError(ApiResponse[CanvasDiagnostic]):
    """统一 HTTP 错误封套，data 保留稳定代号、定位及阻止动作。"""




class CanvasResolvedOutput(BaseModel):
    """已发布的实际输出，运行层可注入模型当前输出而无需虚构未来结果。"""
    source: OutputIdentity
    modality: Literal['text', 'image', 'video', 'audio']
    payload: Annotated[BasisTextOutputPayload | DialogueReferencePayload | TextOutputPayload | MediaOutputPayload | ObjectReferencePayload | DescriptionTextPayload | NamedImagePayload | DesignTextPayload | SpatialReferencePayload | NarrativeReferencePayload | CriterionReferencePayload | PhotographyTextPayload, Field(discriminator='kind')] | None = None
    text: str | None = None
    file_id: str | None = None
    token: str = ''
    available: bool = True
    basis_current: bool = True
    result_set_id: str | None = None
    design_sources: list[DesignMediaOrigin] = Field(default_factory=list, exclude_if=lambda value: not value)


    @model_validator(mode='after')
    def normalize_payload(self):
        """强类型内容是权威；旧读取字段作为只读投影保持历史可读。"""
        if self.payload is None:
            if self.modality == 'text' and self.text is not None:
                self.payload = TextOutputPayload(text=self.text)
            elif self.modality in ('image', 'video', 'audio') and self.file_id:
                self.payload = MediaOutputPayload(kind=self.modality, file_id=self.file_id)
        if self.payload is not None:
            self.modality = 'text' if isinstance(self.payload, (BasisTextOutputPayload, DialogueReferencePayload, ObjectReferencePayload, DescriptionTextPayload, DesignTextPayload, SpatialReferencePayload, NarrativeReferencePayload, CriterionReferencePayload, PhotographyTextPayload)) else 'image' if isinstance(self.payload, NamedImagePayload) else self.payload.kind
            self.text = getattr(self.payload, 'text', None)
            self.file_id = getattr(self.payload, 'file_id', None)
        return self


class CanvasCardOutputs(BaseModel):
    """已保存修订的本卡输出与直接候选；预览不改变采用。"""
    revision: int
    card_id: str
    outputs: list[CanvasResolvedOutput]
    candidates: list[CanvasResolvedOutput]


class CanvasCompiledInput(BaseModel):
    """单次展开与实际使用映射，媒体位置为实际提交子集内的序号。"""
    card_id: str
    revision: int | None = None
    text: str = ''
    used: list[CanvasResolvedOutput] = Field(default_factory=list)
    media: list[CanvasResolvedOutput] = Field(default_factory=list)
    video_media: VideoMediaInput | None = None
    mapping: list[CanvasSourceMapping | NamedImageMapping] = Field(default_factory=list)
    diagnostics: list[CanvasDiagnostic] = Field(default_factory=list)
    can_run: bool = True


class CanvasPrecheckRequest(BaseModel):
    """单卡、运行到目标或严格框选；框选 ID 中的内容卡与分组不执行。"""
    model_config = ConfigDict(extra='forbid')
    card_id: str
    kind: Literal['single', 'target', 'selection'] = 'single'
    card_ids: list[str] = Field(default_factory=list, max_length=1000)


class CanvasPrecheck(BaseModel):
    """可展示的固定输入；秘密供应商配置不进入协议。"""
    revision: int
    card_id: str
    execution_nodes: list[str]
    reused_results: list[str] = Field(default_factory=list)
    input: CanvasCompiledInput
    model: dict[str, Any] = Field(default_factory=dict)
    diagnostics: list[CanvasDiagnostic] = Field(default_factory=list)
    can_run: bool
    preview_token: str | None = None


class CanvasRunSubmit(BaseModel):
    """重放必须保留原始请求身份及预检凭据。"""
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(min_length=1, max_length=64)
    preview_token: str = Field(min_length=1, max_length=64)


class CanvasRunAccepted(BaseModel):
    """与运行及 Task 原子持久化的受理回执。"""
    request_id: str
    canvas_id: str
    run_id: str
    task_ids: list[str]


class CanvasNodeRead(BaseModel):
    """运行正文属于累计未完成成果，正式输出由结果集单独标识。"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    card_id: str
    task_id: str | None
    status: str
    stage: str
    progress: int | None
    text: str
    basis: dict[str, Any]
    outputs: list[CanvasResolvedOutput]
    result_set_id: str | None
    current_output_updated: bool
    error_code: str | None
    error_message: str | None


class CanvasRunRead(BaseModel):
    """生命周期结束不代表整次运行的成功等级。"""
    id: str
    canvas_id: str
    lifecycle: Literal['active', 'finished']
    nodes: list[CanvasNodeRead]


class CanvasSnapshot(BaseModel):
    """一致切点及其之后的恢复游标。"""
    cursor: int
    runs: list[CanvasRunRead]
    current_outputs: dict[str, list[CanvasResolvedOutput]]


class CanvasRuntimeEvent(BaseModel):
    """共用连接复用所有运行，按画布游标去重。"""
    version: Literal[1] = 1
    cursor: int
    type: Literal['snapshot', 'node.updated', 'text.delta', 'node.finished', 'run.finished']
    canvas_id: str
    run_id: str | None = None
    node_id: str | None = None
    payload: dict[str, Any]


class CanvasStreamConnection(BaseModel):
    """由 generated operation 提供流地址，通用 transport 负责 SSE。"""
    url: str
