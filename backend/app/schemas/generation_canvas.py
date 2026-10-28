"""首个画布消费者使用的轻量类型契约，不包含布局或运行状态。"""
from typing import Annotated, Any, ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.common import ApiResponse
from app.core.contracts.media import VideoMediaInput
from app.core.contracts.generation_canvas import OutputIdentity, InputBinding, TextOutputPayload, MediaOutputPayload, ObjectReferencePayload, DescriptionTextPayload, NamedImageObject, ReferenceImageBinding, NamedImagePayload, CanvasSourceMapping, NamedImageMapping, DesignField, DesignScope, DesignTextPayload, SpatialReferencePayload


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
    type: Literal['content.object'] = 'content.object'
    object_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(default='', max_length=255)
    category: Literal['character', 'prop', 'costume'] = 'character'
    text: str = ''
    source_locator: str = ''
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'object')


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
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'image')
    output_ports: ClassVar[tuple[str, ...]] = ('image',)


class VideoModelCard(ModelCard):
    """视频处理卡；目标端口固定帧与主体用途。"""
    type: Literal['model.video'] = 'model.video'
    config: VideoModelConfig = Field(default_factory=VideoModelConfig)
    input_ports: ClassVar[tuple[str, ...]] = ('text', 'first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video')
    output_ports: ClassVar[tuple[str, ...]] = ('video',)


class GenerationCanvasEdge(BaseModel):
    """候选连接只描述来源和用途，不代表实际使用。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    source_card: str
    source_port: str
    target_card: str
    target_port: str


class GenerationCanvasGroup(BaseModel):
    """分组仅组织独立成员，不提供聚合输出。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    card_ids: list[str] = Field(default_factory=list)
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
    """单张主图的本地命名和明确名称绑定，标题与对象名相互独立。"""
    type: Literal['reference.character', 'reference.place', 'reference.prop', 'reference.costume']
    title: str = ''
    angle: str = '正面'
    objects: list[NamedImageObject] = Field(default_factory=list)
    input_bindings: list[InputBinding] = Field(default_factory=list)
    image_binding: ReferenceImageBinding | None = None
    positions: dict[str, str] = Field(default_factory=dict)
    input_ports: ClassVar[tuple[str, ...]] = ('name', 'image_source')
    output_ports: ClassVar[tuple[str, ...]] = ('image', 'object')


class DesignMediaExample(BaseModel):
    """示例只关联直接媒体，正反用途及视频／音频有效区间不成为生成输入。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1)
    source: OutputIdentity
    file_id: str = Field(min_length=1)
    purpose: Literal['positive', 'negative'] = 'positive'
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
    type: Literal['direction.situation'] = Field(default='direction.situation', json_schema_extra={'enum': ['direction.situation']})
    situation: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    relationship: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'effect_object')


class CharacterPerformanceCard(PerformanceDirectionCard):
    """完整表演；可选后续端点待对应来源票据接入，不伪造身份。"""
    type: Literal['direction.performance'] = Field(default='direction.performance', json_schema_extra={'enum': ['direction.performance']})
    objective: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    obstacle: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    subtext: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    attention: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    internal_adjustment: DesignField = Field(default_factory=lambda: DesignField(purpose='background'))
    physical_action: DesignField = Field(default_factory=DesignField)
    gaze: DesignField = Field(default_factory=DesignField)
    breath: DesignField = Field(default_factory=DesignField)
    weight: DesignField = Field(default_factory=DesignField)
    hands: DesignField = Field(default_factory=DesignField)
    voice: DesignField = Field(default_factory=DesignField)
    delivery: DesignField = Field(default_factory=DesignField)
    reaction_order: DesignField = Field(default_factory=DesignField)
    exit_state: DesignField = Field(default_factory=DesignField)
    avoid: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'effect_object', 'beat', 'received_event', 'dialogue_basis', 'acceptance_basis', 'image_example', 'video_example')


class PerformanceRuleCard(PerformanceDirectionCard):
    """规则保留背景或约束用途、适用范围和必要制作阶段。"""
    type: Literal['direction.performance_rule'] = Field(default='direction.performance_rule', json_schema_extra={'enum': ['direction.performance_rule']})
    applicability: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    input_ports: ClassVar[tuple[str, ...]] = ('effect_object', 'image_example', 'video_example')


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
    position: DesignField = Field(default_factory=DesignField)
    orientation: DesignField = Field(default_factory=DesignField)
    spatial_relation: DesignField = Field(default_factory=DesignField)
    scale: DesignField = Field(default_factory=DesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('space', 'effect_object', 'image_example', 'video_example')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'anchor')


class BlockingDirectionCard(SpatialDirectionCard):
    """明确调度对象供后续镜头引用；事件来源后续接入。"""
    type: Literal['direction.blocking'] = Field(default='direction.blocking', json_schema_extra={'enum': ['direction.blocking']})
    blocking_id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str = ''
    position: DesignField = Field(default_factory=DesignField)
    orientation: DesignField = Field(default_factory=DesignField)
    initiative: DesignField = Field(default_factory=DesignField)
    path: DesignField = Field(default_factory=DesignField)
    transition_reason: DesignField = Field(default_factory=DesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'position_anchor', 'change_event', 'image_example', 'video_example')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'blocking')


class InFrameActivityCard(SpatialDirectionCard):
    """持续任务、反应延迟与入出画；触发事件不自动执行。"""
    type: Literal['direction.activity'] = Field(default='direction.activity', json_schema_extra={'enum': ['direction.activity']})
    task: DesignField = Field(default_factory=DesignField)
    attention: DesignField = Field(default_factory=DesignField)
    main_action_effect: DesignField = Field(default_factory=DesignField)
    path: DesignField = Field(default_factory=DesignField)
    delay_basis: DesignField = Field(default_factory=DesignField)
    delay_ms: int | None = Field(default=None, ge=0)
    entry_exit: DesignField = Field(default_factory=DesignField)
    exit_state: DesignField = Field(default_factory=DesignField)
    depth: DesignField = Field(default_factory=DesignField)
    intensity: DesignField = Field(default_factory=DesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('participant', 'area_anchor', 'trigger_event', 'effect_object', 'image_example', 'video_example')


class EnvironmentActivityCard(SpatialDirectionCard):
    """环境活动与留白不要求先建镜头、人物或节拍。"""
    type: Literal['direction.environment'] = Field(default='direction.environment', json_schema_extra={'enum': ['direction.environment']})
    activity: DesignField = Field(default_factory=DesignField)
    empty_space: DesignField = Field(default_factory=DesignField)
    reason: DesignField = Field(default_factory=DesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('image_example', 'video_example')

class SoundDirectionCard(CardDefinition):
    """声音设计仅关联直接对象与固定素材，不新增模型音频输入。"""
    scope: DesignScope = Field(default_factory=DesignScope)
    source_locator: str = ''
    input_bindings: list[InputBinding] = Field(default_factory=list)
    examples: list[DesignMediaExample] = Field(default_factory=list)
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class DialogueCard(SoundDirectionCard):
    """一条稳定对白，正文修订由创作者显式记录版本。"""
    type: Literal['direction.dialogue'] = Field(default='direction.dialogue', json_schema_extra={'enum': ['direction.dialogue']})
    dialogue_id: str = Field(min_length=1, max_length=64)
    version: int = Field(default=1, ge=1)
    content: DesignField = Field(default_factory=DesignField)
    input_ports: ClassVar[tuple[str, ...]] = ('speaker', 'video_example', 'audio_example')
    output_ports: ClassVar[tuple[str, ...]] = ('text', 'dialogue')


class SoundArrangementCard(SoundDirectionCard):
    """声源、环境声、动作声和音乐约束保持各自用途及制作安排。"""
    type: Literal['direction.sound'] = Field(default='direction.sound', json_schema_extra={'enum': ['direction.sound']})
    source_description: DesignField = Field(default_factory=DesignField)
    environment: DesignField = Field(default_factory=DesignField)
    action_sound: DesignField = Field(default_factory=DesignField)
    music: DesignField = Field(default_factory=lambda: DesignField(purpose='constraint'))
    production: Literal['synchronous', 'postproduction', 'undecided'] = 'undecided'
    input_ports: ClassVar[tuple[str, ...]] = ('effect_object', 'audio_example')


class CanvasDocument(BaseModel):
    """完整编辑文档；位置、尺寸和视角由浏览器另存。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    project_id: str
    name: str = Field(min_length=1, max_length=255)
    schema_version: Literal[2] = 2
    cards: list[DialogueCard | SoundArrangementCard | SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard | CharacterSituationCard | CharacterPerformanceCard | PerformanceRuleCard | NamedImageReferenceCard | TextContentCard | CreativeBasisCard | ObjectDescriptionCard | PlaceDescriptionCard | ImageContentCard | VideoContentCard | AudioContentCard | TextModelCard | ImageModelCard | VideoModelCard] = Field(default_factory=list)
    edges: list[GenerationCanvasEdge] = Field(default_factory=list)
    input_order: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    groups: list[GenerationCanvasGroup] = Field(default_factory=list)


    @model_validator(mode='before')
    @classmethod
    def read_legacy_document(cls, value):
        """只读解析旧格式；不原地重写原始幂等正文或历史快照。"""
        if isinstance(value, dict) and value.get('schema_version', 1) == 1:
            return {**value, 'schema_version': 2}
        return value


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
    modality: str
    payload: Annotated[TextOutputPayload | MediaOutputPayload | ObjectReferencePayload | DescriptionTextPayload | NamedImagePayload | DesignTextPayload | SpatialReferencePayload, Field(discriminator='kind')] | None = None
    text: str | None = None
    file_id: str | None = None
    token: str = ''
    available: bool = True
    basis_current: bool = True
    result_set_id: str | None = None


    @model_validator(mode='after')
    def normalize_payload(self):
        """强类型内容是权威；旧读取字段作为只读投影保持历史可读。"""
        if self.payload is None:
            if self.modality == 'text' and self.text is not None:
                self.payload = TextOutputPayload(text=self.text)
            elif self.modality in ('image', 'video', 'audio') and self.file_id:
                self.payload = MediaOutputPayload(kind=self.modality, file_id=self.file_id)
        if self.payload is not None:
            self.modality = 'text' if isinstance(self.payload, (ObjectReferencePayload, DescriptionTextPayload, DesignTextPayload, SpatialReferencePayload)) else 'image' if isinstance(self.payload, NamedImagePayload) else self.payload.kind
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
