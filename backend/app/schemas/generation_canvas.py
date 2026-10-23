"""首个画布消费者使用的轻量类型契约，不包含布局或运行状态。"""
from typing import Any, ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.common import ApiResponse


class CardDefinition(BaseModel):
    """卡片的稳定身份与类型版本；具体类型声明自己的端口及内容。"""
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    type_version: Literal[1] = 1
    input_ports: ClassVar[tuple[str, ...]] = ()
    output_ports: ClassVar[tuple[str, ...]] = ()


class TextContentCard(CardDefinition):
    """一张卡一份文本，空字符串可以保存但没有可用输出。"""
    type: Literal['content.text'] = 'content.text'
    text: str = ''
    output_ports: ClassVar[tuple[str, ...]] = ('text',)


class ModelCard(CardDefinition):
    """模型切换只替换模型身份；未完成配置也可持久保存。"""
    model_id: str | None = None
    prompt: str = ''


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
    severity: Literal['error'] = 'error'
    message: str
    target: dict[str, Any]
    blocks: list[str]


class CanvasError(ApiResponse[CanvasDiagnostic]):
    """统一 HTTP 错误封套，data 保留稳定代号、定位及阻止动作。"""
