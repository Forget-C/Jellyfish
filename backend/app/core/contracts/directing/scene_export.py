"""整场导出冻结保存修订与输出规格，不跟随之后的编辑。"""
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.core.contracts.directing.scene_timeline import SceneTimeline


class SceneExportRequest(Contract):
    """重复请求只核实首次提交，不重新读取时间线。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    size: Literal[1080, 720] = 1080


class SceneExportRetry(Contract):
    """重试指定失败或取消记录，保留该记录的全部输入。"""

    request_id: Identity


class SceneExportProfile(Contract):
    """第一版固定编码规格；尺寸来自已保存的输出比例。"""

    size: Literal[1080, 720] = 1080
    width: int
    height: int
    fps: Literal[30] = 30
    video_codec: Literal['h264'] = 'h264'
    audio_codec: Literal['aac'] = 'aac'
    container: Literal['mp4'] = 'mp4'


class SceneExportSnapshot(Contract):
    """后台只消费该快照，不能回读当前可编辑版本。"""

    version_id: Identity
    revision: int
    content: SceneVersionContent
    profile: SceneExportProfile


class SceneExportRead(Contract):
    """任务成功且文件可用时才提供下载入口。"""

    task_id: Identity
    request_id: Identity
    status: str
    cancel_requested: bool
    retry_of_task_id: Identity | None
    error: str | None
    snapshot: SceneExportSnapshot
    file_id: Identity | None
    file_status: Literal['none', 'available', 'unavailable', 'unknown']
    file_deleted: bool
    download_url: str | None


class SceneExportInspect(Contract):
    """只读检查当前剪辑，可包含尚未保存的编辑。"""

    timeline: SceneTimeline
    output_aspect_ratio: Literal['16:9', '9:16', '1:1']
    size: Literal[1080, 720] = 1080


class SceneExportClipScale(Contract):
    """实测显示尺寸与填满裁切后有效尺寸，不使用生成请求的名义分辨率。"""

    clip_id: Identity
    source_width: float
    source_height: float
    effective_width: float
    effective_height: float
    scale: float
    needs_upscale: bool


class SceneExportInspection(Contract):
    """读取时的实际媒体检查，不代表保存或提交任务。"""

    profile: SceneExportProfile
    clips: list[SceneExportClipScale]
