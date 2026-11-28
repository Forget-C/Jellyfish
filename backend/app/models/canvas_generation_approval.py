"""固定画布生成依据及审批决定对应的原受理。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CanvasGenerationApproval(Base):
    """一个审批组明确授权一次单卡生成。"""

    __tablename__ = 'canvas_generation_approvals'

    request_id: Mapped[str] = mapped_column(ForeignKey('approval_requests.id', ondelete='CASCADE'), primary_key=True)
    canvas_id: Mapped[str] = mapped_column(String(64))
    project_id: Mapped[str | None] = mapped_column(String(64))
    card_id: Mapped[str] = mapped_column(String(64))
    group_id: Mapped[str] = mapped_column(String(64))
    basis_hash: Mapped[str] = mapped_column(String(64))
    preview: Mapped[dict] = mapped_column(JSON)
    next_scan_at: Mapped[datetime | None] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), 'mysql'), index=True,
    )
    state: Mapped[str] = mapped_column(String(16), default='pending')
    decision_id: Mapped[str | None] = mapped_column(String(64))
    task_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    admission: Mapped[dict | None] = mapped_column(JSON)
    diagnostic: Mapped[dict | None] = mapped_column(JSON)
