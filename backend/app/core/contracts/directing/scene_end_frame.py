"""真实采用的原素材落幅；不等同于输出构图或后段依赖确认。"""
from datetime import datetime

from pydantic import Field

from app.core.contracts.directing.common import Contract, Identity, Source
from app.core.contracts.directing.scene_timeline import SceneMediaCutItem


class SceneEndFrameCreate(Contract):
    """明确保存修订和单次采用身份，重试使用原请求。"""

    request_id: Identity
    expected_revision: int = Field(gt=0)
    clip_id: Identity


class SceneEndFrameRead(Contract):
    """固定真实帧时间及原采用区间，单独表达当前适用性与文件可用性。"""

    id: Identity
    version_id: Identity
    request_id: Identity
    revision: int
    clip: SceneMediaCutItem
    file_id: Identity
    at_ms: int = Field(ge=0)
    source: Source
    created_at: datetime
    matches_current: bool
    available: bool
    image_url: str | None
