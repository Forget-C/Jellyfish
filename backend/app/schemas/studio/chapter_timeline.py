"""章节视频时间线读写与导出相关 Schema（与 OpenAPI 契约对齐）。"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

_PREVIEW_NOTE_DEFAULT = (
    "剪辑页支持顺序预览与入出点裁剪；导出将按裁剪拼接成片。"
)


class TimelineClipStatus(str, Enum):
    """片段成片解析状态（展示用）。"""

    ready = "ready"
    missing_video = "missing_video"
    file_missing = "file_missing"


class ChapterTimelineSegmentWrite(BaseModel):
    """保存时间线时的一段（顺序由数组顺序表达）。"""

    shot_id: str = Field(..., description="镜头 ID")
    trim_start_ms: int | None = Field(
        None,
        ge=0,
        description="裁剪入点毫秒（可选）；与 trim_end_ms 均为空表示全长；否则区间为左闭右开 [start,end)",
    )
    trim_end_ms: int | None = Field(
        None,
        ge=0,
        description="裁剪出点毫秒（exclusive，可选）；为空则默认为源成片时长",
    )


class ChapterTimelineWrite(BaseModel):
    """全量替换章节时间线片段。"""

    layout_version: int | None = Field(None, description="与 GET 返回一致时可校验乐观锁")
    segments: list[ChapterTimelineSegmentWrite] = Field(default_factory=list)


class ChapterTimelineSegmentRead(BaseModel):
    """时间线片段读取模型（含成片文件解析状态）。"""

    id: str = Field(..., description="片段行 ID；尚未落库的合成行可为空字符串")
    shot_id: str
    position: int = Field(..., ge=0)
    trim_start_ms: int | None = Field(None, description="已保存入点毫秒；null 表示从 0")
    trim_end_ms: int | None = Field(None, description="已保存出点毫秒（exclusive）；null 表示至片尾")
    clip_status: TimelineClipStatus
    file_id: str | None = None
    label: str = Field("", description="镜头标题等展示字段")


class ChapterTimelineRead(BaseModel):
    """章节时间线读取模型。"""

    layout_version: int = Field(1, ge=1)
    segments: list[ChapterTimelineSegmentRead] = Field(default_factory=list)
    preview_note: str = Field(default=_PREVIEW_NOTE_DEFAULT, description="连续预览能力说明")


class ChapterTimelineEncodeMode(str, Enum):
    """导出编码策略。"""

    uniform_transcode = "uniform_transcode"
    lossless_concat_only = "lossless_concat_only"


class ChapterTimelineExportRequest(BaseModel):
    """发起章节时间线导出任务。"""

    idempotency_key: str | None = Field(None, description="可选幂等键")
    encode_mode: ChapterTimelineEncodeMode = Field(
        default=ChapterTimelineEncodeMode.uniform_transcode,
        description="uniform_transcode：统一转码拼接；lossless_concat_only：仅当片段编码一致时无损拼接",
    )
