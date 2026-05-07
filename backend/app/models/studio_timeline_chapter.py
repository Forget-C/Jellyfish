"""章节级视频时间线 ORM（与旧 timeline_clips 语义分离）。

每章节一条可选状态行用于 layout_version；片段表绑定 shot，导出时从镜头成片解析文件。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.studio_projects import Chapter
    from app.models.studio_shots import Shot


class ChapterTimelineState(Base):
    """章节时间线保存状态（版本号用于乐观锁）。"""

    __tablename__ = "chapter_timeline_states"

    chapter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        primary_key=True,
        comment="章节 ID",
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="最近保存时间（UTC）",
    )
    layout_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
        comment="布局版本（每次成功保存递增）",
    )

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="timeline_state")


class ChapterTimelineSegment(Base, TimestampMixin):
    """章节时间线上的一个镜头片段（顺序由 position 表达）。"""

    __tablename__ = "chapter_timeline_segments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="片段行 ID")
    chapter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属章节",
    )
    shot_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("shots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="对应镜头",
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, comment="从 0 起的播放顺序")
    trim_start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="入点毫秒（可选）")
    trim_end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="出点毫秒（可选）")
    # 历史 SQL 已存在无默认值版本；这里补 ORM 侧默认，避免 INSERT 依赖 DB default。
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="timeline_segments")
    shot: Mapped["Shot"] = relationship("Shot", back_populates="timeline_segment")

    __table_args__ = (
        UniqueConstraint("chapter_id", "shot_id", name="uq_chapter_shot"),
        UniqueConstraint("chapter_id", "position", name="uq_chapter_position"),
    )


__all__ = ["ChapterTimelineState", "ChapterTimelineSegment"]
