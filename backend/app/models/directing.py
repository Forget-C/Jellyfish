"""场次工作台基础存储。大工作单使用类型化 JSON，关系和版本由列约束。"""

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class Sequence(Base, TimestampMixin):
    """故事场次，通过章节唯一确定项目，与 Scene 场所资产不同。"""

    __tablename__ = "directing_sequences"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id", ondelete="RESTRICT"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("chapter_id", "position", name="uq_directing_sequence_position"),
        CheckConstraint("position >= 0 AND version > 0", name="ck_directing_sequence_numbers"),
    )


class DirectingRevision(Base, TimestampMixin):
    """设计、计划、提示词、审稿、剪辑共用版本机制，payload 按 kind 强类型验证。"""

    __tablename__ = "directing_revisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey("directing_sequences.id", ondelete="RESTRICT"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        CheckConstraint("kind IN ('design','plan','prompt','review','cut')", name="ck_directing_revision_kind"),
        CheckConstraint("version > 0", name="ck_directing_revision_version"),
        CheckConstraint("(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)", name="ck_directing_revision_confirmation"),
    )


class RevisionDependency(Base):
    """冻结版本的直接依据索引，保护被引用版本并支持局部影响查询。"""

    __tablename__ = "directing_revision_dependencies"

    revision_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="CASCADE"), primary_key=True)
    dependency_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"), primary_key=True)


class Take(Base, TimestampMixin):
    """成功 TaskOutput 的唯一素材登记，单元归属固定，审片注释单独乐观更新。"""

    __tablename__ = "directing_takes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey("directing_sequences.id", ondelete="RESTRICT"), nullable=False, index=True)
    prompt_revision_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"), nullable=False)
    plan_revision_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"), nullable=False)
    unit_id: Mapped[str] = mapped_column(String(64), nullable=False)
    task_id: Mapped[str] = mapped_column(String(64), nullable=False)
    output_ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="RESTRICT"), nullable=False)
    annotation: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        ForeignKeyConstraint(["task_id", "output_ordinal"], ["task_outputs.task_id", "task_outputs.ordinal"], ondelete="RESTRICT"),
        UniqueConstraint("task_id", "output_ordinal", name="uq_directing_take_output"),
        CheckConstraint("version > 0 AND output_ordinal >= 0", name="ck_directing_take_numbers"),
    )


class CutTakeReference(Base):
    """剪辑 JSON 中 Take 引用的关系索引，防止删除已采用素材记录。"""

    __tablename__ = "directing_cut_take_references"

    revision_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="CASCADE"), primary_key=True)
    take_id: Mapped[str] = mapped_column(ForeignKey("directing_takes.id", ondelete="RESTRICT"), primary_key=True)
