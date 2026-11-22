"""Persistence for a canvas-scoped assistant conversation."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CanvasAssistantSession(Base):
    """One session per persisted canvas. Its row serializes conversation turns."""

    __tablename__ = 'canvas_assistant_sessions'

    canvas_id: Mapped[str] = mapped_column(
        ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pending_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pending_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approval_mode: Mapped[str] = mapped_column(String(12), nullable=False, server_default='manual')


class CanvasAssistantTurn(Base):
    """A completed user-and-assistant exchange doubles as its replay receipt."""

    __tablename__ = 'canvas_assistant_turns'
    __table_args__ = (
        UniqueConstraint('canvas_id', 'sequence', name='uq_canvas_assistant_turn_sequence'),
    )

    canvas_id: Mapped[str] = mapped_column(
        ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'), primary_key=True,
    )
    request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    reply: Mapped[str] = mapped_column(Text().with_variant(MEDIUMTEXT(), 'mysql'), nullable=False)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    proposal: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    proposal_receipt: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revises: Mapped[str | None] = mapped_column(String(64), nullable=True)
    skills: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    attachments: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    approval_audit: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
