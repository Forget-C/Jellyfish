"""执行期文件解析的内部数据结构。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.media import MediaKind


class ResolvedMediaSnapshot(BaseModel):
    """冻结任务引用的文件版本，不携带 URL、Data URL 或媒体正文。

    Submitter 可将此结构投影到 ``GenerationTaskMediaReference``；实际下载
    必须在 Worker 执行时通过 ``FileResolver`` 完成，避免可变访问地址进入
    异步任务 payload。
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    file_id: str = Field(min_length=1)
    media_kind: MediaKind
    ordinal: int = Field(ge=0)
    file_content_version: int = Field(ge=1)
    file_content_hash: str | None = None


class ResolvedMediaContent(BaseModel):
    """Provider 适配前的内存媒体内容，仅限当前执行进程使用。"""

    model_config = ConfigDict(extra="forbid", frozen=True, arbitrary_types_allowed=True)

    snapshot: ResolvedMediaSnapshot
    content: bytes
    content_type: str | None = None
