"""首个画布消费者使用的轻量类型契约，不包含布局或运行状态。"""
from typing import Any, ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.common import ApiResponse
from app.core.contracts.media import VideoMediaInput


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


class OutputIdentity(BaseModel):
    """稳定输出位置不等于历史产物 ID；不得按文件合并来源。"""
    model_config = ConfigDict(extra='forbid')
    canvas_id: str
    card_id: str
    port_id: str
    position: int = Field(ge=0)


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
    source: OutputIdentity


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


class CanvasDocument(BaseModel):
    """完整编辑文档；位置、尺寸和视角由浏览器另存。"""
    model_config = ConfigDict(extra='forbid')
    id: str
    project_id: str
    name: str = Field(min_length=1, max_length=255)
    schema_version: Literal[1] = 1
    cards: list[TextContentCard | ImageContentCard | VideoContentCard | AudioContentCard | TextModelCard | ImageModelCard | VideoModelCard] = Field(default_factory=list)
    edges: list[GenerationCanvasEdge] = Field(default_factory=list)
    input_order: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    groups: list[GenerationCanvasGroup] = Field(default_factory=list)


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
    text: str | None = None
    file_id: str | None = None
    token: str = ''
    available: bool = True
    basis_current: bool = True
    result_set_id: str | None = None


class CanvasCompiledInput(BaseModel):
    """单次展开与实际使用映射，媒体位置为实际提交子集内的序号。"""
    card_id: str
    revision: int | None = None
    text: str = ''
    used: list[CanvasResolvedOutput] = Field(default_factory=list)
    media: list[CanvasResolvedOutput] = Field(default_factory=list)
    video_media: VideoMediaInput | None = None
    mapping: list[dict[str, Any]] = Field(default_factory=list)
    diagnostics: list[CanvasDiagnostic] = Field(default_factory=list)
    can_run: bool = True


class CanvasPrecheckRequest(BaseModel):
    """单卡执行范围，不隐式执行上游。"""
    model_config = ConfigDict(extra='forbid')
    card_id: str


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
