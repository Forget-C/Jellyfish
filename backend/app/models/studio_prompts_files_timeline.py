from __future__ import annotations

from sqlalchemy import Boolean, JSON, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import FileType, PromptCategory, TimelineClipType


class PromptTemplate(Base,TimestampMixin):
    """提示词模板表。

    应用层保证：
    - 同一 category 下至多一条 is_default=True，写入/更新时由接口层维护。
    - is_system=True 的记录由初始化脚本写入，接口层拒绝删除和修改。
    """

    __tablename__ = "prompt_templates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="模板 ID（UUID）")
    category: Mapped[PromptCategory] = mapped_column(String(32), nullable=False, index=True, comment="模板类别")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="模板名称")
    preview: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="预览文案")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="模板内容")
    variables: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="变量名列表（JSON 数组）")
    variable_defaults: Mapped[dict[str, str]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
        comment="可配置变量的默认值（JSON 对象）",
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="模板内容版本号（每次内容或变量修改递增）")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否为默认提示词（同类别唯一，应用层保证）")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否为系统预置（仅初始化脚本写入，接口层禁止删改）")

    __table_args__ = (
        Index("ix_prompt_templates_name", "name"),
    )


class FileItem(Base, TimestampMixin):
    """素材文件表。"""

    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="文件 ID（UUID）")
    type: Mapped[FileType] = mapped_column(String(16), nullable=False, index=True, comment="文件类型")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="文件名/标题")
    thumbnail: Mapped[str] = mapped_column(String(1024), nullable=False, default="", comment="缩略图 URL/路径")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签（JSON 数组）")
    storage_key: Mapped[str] = mapped_column(
        String(1024),
        nullable=False,
        comment="对象存储中的 key（如 files/xxx.png）",
    )
    content_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="文件内容版本")
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="文件内容哈希")

    usages: Mapped[list["FileUsage"]] = relationship(
        "FileUsage",
        back_populates="file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_files_updated_at", "updated_at"),
    )


class TimelineClip(Base):
    """时间线片段。

    说明：
    - `source_id` 为逻辑引用（例如文件/音频素材 ID），不强制外键，便于接入不同素材来源。
    - 表内无 project_id/chapter_id，不直接归属项目/章节。

    应用层保证：
    - 若业务需按项目/章节维度的时间线，需在应用层通过 source_id 或关联表绑定归属。
    """

    __tablename__ = "timeline_clips"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, comment="片段 ID")
    type: Mapped[TimelineClipType] = mapped_column(String(16), nullable=False, index=True, comment="片段类型")
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, comment="来源素材 ID（逻辑引用）")
    label: Mapped[str] = mapped_column(String(255), nullable=False, comment="显示标签")
    start: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="起始时间（秒）")
    end: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="结束时间（秒）")
    track: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="轨道号")

    __table_args__ = (
        Index("ix_timeline_clips_track", "track"),
    )


__all__ = ["PromptTemplate", "FileItem", "TimelineClip"]
