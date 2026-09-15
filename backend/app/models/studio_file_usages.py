from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin
from app.models.types import FileUsageKind

if TYPE_CHECKING:
    from app.models.studio_prompts_files_timeline import FileItem


class FileUsage(Base, TimestampMixin):
    """文件在项目业务链上的使用位置（多对一 files；同一 file 可多行）。"""

    __tablename__ = "file_usages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="行 ID")
    file_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="文件 ID",
    )
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="项目 ID",
    )
    chapter_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="章节 ID（可空）",
    )
    usage_kind: Mapped[FileUsageKind] = mapped_column(
        String(32),
        nullable=False,
        index=True,
        comment="用途类型",
    )
    source_ref: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        default="",
        comment="幂等键（如同一槽位 upsert；无则空串）",
    )

    file: Mapped["FileItem"] = relationship(back_populates="usages")

    __table_args__ = (
        UniqueConstraint("file_id", "project_id", "usage_kind", "source_ref", name="uq_file_usages_file_project_kind_ref"),
    )


__all__ = ["FileUsage"]
