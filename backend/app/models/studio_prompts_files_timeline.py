from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, JSON, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import FileType, PromptCategory


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
    thumbnail_key: Mapped[str | None] = mapped_column(String(700), nullable=True, comment="缩略图存储 key")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, comment="标签（JSON 数组）")
    storage_key: Mapped[str] = mapped_column(
        String(700, collation="utf8mb4_bin").with_variant(String(700), "sqlite"),
        nullable=False, unique=True,
        comment="不可变对象的唯一存储 key",
    )
    content_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    delete_requested_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="文件内容哈希")

    usages: Mapped[list["FileUsage"]] = relationship(
        "FileUsage",
        back_populates="file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_files_updated_at", "updated_at"),
        Index("ix_files_delete", "deleted_at", "delete_requested_at"),
    )


__all__ = ["PromptTemplate", "FileItem"]
