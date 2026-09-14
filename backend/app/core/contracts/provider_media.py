"""仅在执行进程中使用的供应商媒体输入，URL 与正文不得保存到任务快照。"""

from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.video_generation import VideoGenerationInput


class ProviderImageReference(BaseModel):
    """供应商图片引用，与业务 FileItem 标识明确分开。"""

    model_config = ConfigDict(extra="forbid")
    image_url: str
    file_id: str | None = None


class ProviderImageInput(ImageGenerationInput):
    """保留图片参数校验，仅将业务引用转换为执行期地址。"""

    images: list[ProviderImageReference] = Field(default_factory=list)


class ProviderVideoFrames(BaseModel):
    """按时间角色排列的执行期帧地址。"""

    model_config = ConfigDict(extra="forbid")
    first_frame: str | None = None
    last_frame: str | None = None
    key_frames: list[str] = Field(default_factory=list)


class ProviderVideoSubject(BaseModel):
    """供应商所需的命名主体及其分类型参考地址。"""

    model_config = ConfigDict(extra="forbid")
    name: str
    images: list[str] = Field(default_factory=list)
    videos: list[str] = Field(default_factory=list)


class ProviderVideoInput(VideoGenerationInput):
    """保留视频参数校验，帧和主体地址只在执行期间存在。"""

    frame_references: ProviderVideoFrames = Field(default_factory=ProviderVideoFrames)
    subject_references: list[ProviderVideoSubject] = Field(default_factory=list)
