"""统一生成的产物、媒体快照与可靠投递 ORM 模型。"""

from __future__ import annotations

from enum import Enum
from typing import Any

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import TimestampMixin


class GenerationArtifactPublishStatus(str, Enum):
    """产物自动发布到业务目标后的最终状态。"""

    published = "published"
    conflicted = "conflicted"
    skipped = "skipped"


class GenerationArtifact(Base, TimestampMixin):
    """一条真实生成结果一行，避免 GenerationTaskLink 只保存首个产物。"""

    __tablename__ = "generation_artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=True)
    generation_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    modality: Mapped[str] = mapped_column(String(16), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    file_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_result: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    publish_status: Mapped[GenerationArtifactPublishStatus] = mapped_column(String(16), nullable=False)
    publish_error: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("task_id", "ordinal", name="uq_generation_artifacts_task_ordinal"),
        CheckConstraint("(file_id IS NOT NULL AND text_content IS NULL) OR (file_id IS NULL AND text_content IS NOT NULL)", name="ck_generation_artifact_single_content"),
        CheckConstraint("(publish_status = 'published' AND publish_error IS NULL) OR (publish_status = 'conflicted' AND publish_error = 'target_version_conflict') OR (publish_status = 'skipped' AND publish_error IS NOT NULL)", name="ck_generation_artifact_publish_status"),
        Index("ix_generation_artifacts_task_ordinal", "task_id", "ordinal"),
    )


class GenerationTaskMediaReference(Base, TimestampMixin):
    """任务执行期的媒体快照，用于删除保护与内容版本漂移检测。"""

    __tablename__ = "generation_task_media_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(64), ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False)
    file_id: Mapped[str] = mapped_column(String(64), ForeignKey("files.id", ondelete="RESTRICT"), nullable=False)
    group_path: Mapped[str] = mapped_column(String(255), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    media_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    file_content_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("task_id", "group_path", "ordinal", name="uq_generation_task_media_group_ordinal"),
        Index("ix_generation_task_media_file_task", "file_id", "task_id"),
    )


class GenerationDispatchOutbox(Base, TimestampMixin):
    """与任务同事务提交的可靠投递记录，dispatcher 可安全重试。"""

    __tablename__ = "generation_dispatch_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(64), ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False, unique=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    dispatched_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_generation_dispatch_outbox_dispatched", "dispatched_at", "created_at"),)
