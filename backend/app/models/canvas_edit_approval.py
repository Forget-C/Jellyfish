"""画布自行保存的审批快照与逐组执行回执。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CanvasEditApprovalSnapshot(Base):
    """从申请创建起等待决定，业务快照与原审批版本一起保留。"""

    __tablename__ = 'canvas_edit_approval_snapshots'

    request_id: Mapped[str] = mapped_column(ForeignKey('approval_requests.id', ondelete='CASCADE'), primary_key=True)
    canvas_id: Mapped[str] = mapped_column(String(64))
    project_id: Mapped[str | None] = mapped_column(String(64))
    plan: Mapped[dict] = mapped_column(JSON)
    next_scan_at: Mapped[datetime | None] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), 'mysql'), index=True,
    )


class CanvasEditApprovalExecution(Base):
    """同一个决定和改动组具有唯一的业务执行回执。"""

    __tablename__ = 'canvas_edit_approval_executions'

    decision_id: Mapped[str] = mapped_column(ForeignKey('approval_decisions.id', ondelete='CASCADE'), primary_key=True)
    group_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(
        ForeignKey('canvas_edit_approval_snapshots.request_id', ondelete='CASCADE'), index=True,
    )
    receipt: Mapped[dict] = mapped_column(JSON)
