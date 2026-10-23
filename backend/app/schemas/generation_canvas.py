"""首个画布消费者使用的轻量类型契约，不包含布局或运行状态。"""
from typing import Any, ClassVar, Literal
from pydantic import BaseModel, ConfigDict, Field


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
    cards: list[TextContentCard | ImageContentCard | VideoContentCard | AudioContentCard] = Field(default_factory=list)


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


class CanvasError(BaseModel):
    """文档结构或 CAS 失败的 HTTP 错误正文。"""
    detail: CanvasDiagnostic
