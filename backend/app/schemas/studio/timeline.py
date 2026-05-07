"""时间线片段 API 模型（与 `timeline_clips` 表字段对齐）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.types import TimelineClipType


class TimelineClipRead(BaseModel):
    """时间线片段只读模型。"""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="片段 ID")
    type: TimelineClipType = Field(..., description="片段类型：video / audio")
    source_id: str = Field(..., description="来源素材 ID（逻辑引用）")
    label: str = Field(..., description="轨道展示标签")
    start: int = Field(..., description="起始时间（秒）")
    end: int = Field(..., description="结束时间（秒）")
    track: int = Field(..., description="轨道号")
