"""来源展示只返回可读信息与受控目标，不返回完整任务快照。"""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.contracts.directing.common import Contract, Source


class SourceResolveRequest(Contract):
    """按当前场次批量解析来源，限制单次请求大小。"""

    sources: list[Source] = Field(min_length=1, max_length=100)


class SourceRead(Contract):
    """原始身份保持不变；不可用来源不以当前数据冒充历史。"""

    source: Source
    status: Literal["ready", "unavailable"]
    label: str
    description: str
    model_name: str | None = None
    task_id: str | None = None
    created_at: datetime | None = None
    context_text: str | None = None
    chapter_name: str | None = None
    revision_id: str | None = None
    revision_kind: str | None = None
    file_id: str | None = None
    file_name: str | None = None
    media_kind: str | None = None
