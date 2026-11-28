"""持久化审批对象、版本快照引用与决定。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ApprovalSubject(Base):
    """同一资源范围和业务对象的版本切换与决定使用同一行串行化。"""

    __tablename__ = 'approval_subjects'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope_key: Mapped[str] = mapped_column(String(64), index=True)
    scope_kind: Mapped[str] = mapped_column(String(64))
    scope_id: Mapped[str] = mapped_column(String(128))
    object_type: Mapped[str] = mapped_column(String(64))
    object_id: Mapped[str] = mapped_column(String(128))
    active_request_id: Mapped[str | None] = mapped_column(String(64))


class ApprovalRequest(Base):
    """保存提交时的内容，分组决定只更新分组状态。"""

    __tablename__ = 'approval_requests'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey('approval_subjects.id', ondelete='CASCADE'), index=True)
    version: Mapped[str] = mapped_column(String(128))
    submission_key: Mapped[str] = mapped_column(String(64), unique=True)
    submission_hash: Mapped[str] = mapped_column(String(64))
    applicant_id: Mapped[str] = mapped_column(String(128))
    snapshot_ref: Mapped[str] = mapped_column(String(255))
    group_ids: Mapped[list[str]] = mapped_column(JSON)
    group_states: Mapped[dict[str, str]] = mapped_column(JSON)
    supersedes_request_id: Mapped[str | None] = mapped_column(String(64))


class ApprovalDecision(Base):
    """一次决定的原回执，与任何后续执行效果分开。"""

    __tablename__ = 'approval_decisions'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str] = mapped_column(ForeignKey('approval_requests.id', ondelete='CASCADE'), index=True)
    intent_hash: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(8))
    source: Mapped[str] = mapped_column(String(12))
    group_ids: Mapped[list[str]] = mapped_column(JSON)
    decided_at: Mapped[datetime] = mapped_column(DateTime().with_variant(DATETIME(fsp=6), 'mysql'))
