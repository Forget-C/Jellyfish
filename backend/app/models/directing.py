"""场次工作台基础存储。大工作单使用类型化 JSON，关系和版本由列约束。"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, JSON, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.mysql import DATETIME
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
    source_start: Mapped[int | None] = mapped_column(Integer)
    source_end: Mapped[int | None] = mapped_column(Integer)
    source_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("('')"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("chapter_id", "position", name="uq_directing_sequence_position"),
        CheckConstraint("position >= 0 AND version > 0", name="ck_directing_sequence_numbers"),
    )


def revision_created_at() -> datetime:
    """应用侧保存微秒创建时间，保证连续创建版本的展示顺序。"""
    return datetime.now(UTC).replace(tzinfo=None)


class DirectingRevision(Base, TimestampMixin):
    """设计、计划、提示词、审稿、剪辑共用版本机制，payload 按 kind 强类型验证。"""

    __tablename__ = "directing_revisions"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True).with_variant(DATETIME(fsp=6), "mysql"),
                                                default=revision_created_at, server_default=func.now(), nullable=False)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey("directing_sequences.id", ondelete="RESTRICT"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    source_key: Mapped[str | None] = mapped_column(String(64))
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime().with_variant(DATETIME(fsp=6), "mysql"))

    __table_args__ = (
        CheckConstraint("kind IN ('design','plan','prompt','review','cut','cut_review','repair','knowledge')", name="ck_directing_revision_kind"),
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


class DirectingAction(Base, TimestampMixin):
    """记录用户实际点击的编译/执行授权，绑定版本，不采信模型自称批准。"""

    __tablename__ = "directing_actions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey("directing_sequences.id", ondelete="RESTRICT"), nullable=False, index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    displayed_label: Mapped[str] = mapped_column(String(128), nullable=False)
    unit_id: Mapped[str] = mapped_column(String(64), nullable=False)
    review_revision_id: Mapped[str | None] = mapped_column(ForeignKey("directing_revisions.id", ondelete="RESTRICT"))
    request_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="RESTRICT"), unique=True)

    __table_args__ = (
        CheckConstraint("action IN ('compile','execute')", name="ck_directing_action_kind"),
    )


class ProjectStyleRecord(Base, TimestampMixin):
    """项目级风格快照，独立于任一场次且保留确认人与派生关系。"""

    __tablename__ = 'directing_project_styles'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id', ondelete='RESTRICT'), nullable=False, index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey('directing_project_styles.id', ondelete='RESTRICT'))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True).with_variant(DATETIME(fsp=6), 'mysql'), default=revision_created_at, nullable=False)

    __table_args__ = (
        CheckConstraint('version > 0', name='ck_directing_style_version'),
        CheckConstraint('(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)', name='ck_directing_style_confirmation'),
    )


class DirectingBatch(Base, TimestampMixin):
    """固定一次预检选择与显式受理动作，不承担各任务运行状态。"""

    __tablename__ = 'directing_batches'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='prepared')
    created_at: Mapped[datetime] = mapped_column(DateTime().with_variant(DATETIME(fsp=6), 'mysql'), default=revision_created_at, nullable=False)

    __table_args__ = (
        CheckConstraint('version > 0', name='ck_directing_batch_version'),
        CheckConstraint("status IN ('prepared','submitted')", name='ck_directing_batch_status'),
    )


class DirectingBatchItem(Base):
    """一项固定输入与唯一受理任务，失败只记录本项错误。"""

    __tablename__ = 'directing_batch_items'
    batch_id: Mapped[str] = mapped_column(ForeignKey('directing_batches.id', ondelete='CASCADE'), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    prompt_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False)
    review_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False)
    task_id: Mapped[str | None] = mapped_column(ForeignKey('tasks.id', ondelete='RESTRICT'), unique=True)
    error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint('ordinal >= 0', name='ck_directing_batch_item_ordinal'),
        UniqueConstraint('batch_id', 'prompt_revision_id', name='uq_directing_batch_prompt'),
    )


class ActiveCut(Base):
    """最后明确确认的采用版本；新草稿不改变实际连续性依据。"""

    __tablename__ = 'directing_active_cuts'
    sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False)


class CutFrame(Base):
    """从真实采用区间提取的不可变帧，保留原剪辑、Take 与文件引用。"""

    __tablename__ = 'directing_cut_frames'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False, index=True)
    cut_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    take_id: Mapped[str] = mapped_column(ForeignKey('directing_takes.id', ondelete='RESTRICT'), nullable=False)
    file_id: Mapped[str] = mapped_column(ForeignKey('files.id', ondelete='RESTRICT'), nullable=False, unique=True)
    source_in_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    source_out_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    edge: Mapped[str] = mapped_column(String(8), nullable=False)
    __table_args__ = (
        CheckConstraint("edge IN ('start','end')", name='ck_directing_frame_edge'),
        CheckConstraint('source_in_ms >= 0 AND source_out_ms > source_in_ms AND at_ms >= source_in_ms AND at_ms < source_out_ms', name='ck_directing_frame_range'),
    )


class SeamReview(Base):
    """人工真实接缝审查的不可变记录；只在相邻片段与区间未变时复用。"""

    __tablename__ = 'directing_seam_reviews'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False, index=True)
    cut_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False)
    left_frame_id: Mapped[str] = mapped_column(ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False)
    right_frame_id: Mapped[str] = mapped_column(ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False)
    verdict: Mapped[str] = mapped_column(String(8), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime().with_variant(DATETIME(fsp=6), 'mysql'), default=revision_created_at, nullable=False)
    __table_args__ = (CheckConstraint("verdict IN ('pass','revise')", name='ck_directing_seam_verdict'),)


class ChapterTransition(Base):
    """不可变跨场审查固定两端采用和实际帧，顺序改变后仅保留历史。"""

    __tablename__ = 'directing_chapter_transitions'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey('chapters.id', ondelete='RESTRICT'), index=True)
    left_sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'))
    right_sequence_id: Mapped[str] = mapped_column(ForeignKey('directing_sequences.id', ondelete='RESTRICT'))
    left_cut_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'))
    right_cut_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'))
    left_frame_id: Mapped[str] = mapped_column(ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'))
    right_frame_id: Mapped[str] = mapped_column(ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime().with_variant(DATETIME(fsp=6), 'mysql'), default=revision_created_at)


class RepairPlanLink(Base):
    """连接明确返工诊断与派生计划，后续任务和 Take 沿计划身份追溯。"""

    __tablename__ = 'directing_repair_plans'

    repair_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), primary_key=True)
    plan_revision_id: Mapped[str] = mapped_column(ForeignKey('directing_revisions.id', ondelete='RESTRICT'), primary_key=True, unique=True)
