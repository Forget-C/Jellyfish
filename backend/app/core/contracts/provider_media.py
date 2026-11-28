"""仅在执行进程中使用的供应商媒体输入，URL 与正文不得保存到任务快照。"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

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


@dataclass(frozen=True)
class MediaResult:
    """执行期产物位置，含读取该产物所需的请求头。"""

    url: str | None = None
    b64_json: str | None = None
    headers: dict[str, str] = field(default_factory=dict, repr=False)


@dataclass(frozen=True)
class RemoteTaskReference:
    """已由供应商受理的媒体任务。"""

    kind: str
    task_id: str


@dataclass(frozen=True)
class PollObservation:
    """单次远端状态和可收取的产物。"""

    status: str
    outputs: tuple[MediaResult, ...] = ()


RemoteCancellation = Literal["unsupported", "accepted", "confirmed", "rejected"]


class MediaModelProvider(Protocol):
    """已绑定供应商配置的媒体操作。"""

    async def invoke(
        self, input_: ProviderImageInput | ProviderVideoInput,
    ) -> RemoteTaskReference | tuple[MediaResult, ...]:
        """执行一次直接生成或提交，返回已受理的远端任务引用或直接结果。"""

    async def poll(self, reference: RemoteTaskReference) -> PollObservation:
        """执行一次远端查询。"""

    async def cancel(self, reference: RemoteTaskReference) -> RemoteCancellation:
        """区分未接入、供应商受理、供应商确认及拒绝。"""
