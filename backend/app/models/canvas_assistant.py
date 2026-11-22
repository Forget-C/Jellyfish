"""Persistence for a canvas-scoped assistant conversation."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, String, Text, UniqueConstraint
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
    stopped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CanvasAssistantGeneration(Base):
    """A user-approved quantity for one model card, independent of model replies."""

    __tablename__ = 'canvas_assistant_generations'
    __table_args__ = (
        ForeignKeyConstraint(('canvas_id', 'source_id'),
            ('canvas_assistant_turns.canvas_id', 'canvas_assistant_turns.request_id'), ondelete='CASCADE'),
        Index('ix_canvas_assistant_generation_queue', 'state', 'created_at'),
        Index('ix_canvas_assistant_generation_review', 'review_state', 'created_at'),
    )

    canvas_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    card_id: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_count: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    expected_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    basis_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    review_request: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    review_results: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    review_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    review_lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
