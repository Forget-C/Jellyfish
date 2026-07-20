"""add experiment sessions

Revision ID: b4d7f1a8c2e0
Revises: 9d4f2a8c6b15
Create Date: 2026-07-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "b4d7f1a8c2e0"
down_revision: str | Sequence[str] | None = "9d4f2a8c6b15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建实验会话与用户可见消息历史表，并允许 MySQL DDL 失败后安全重试。"""
    inspector = sa.inspect(op.get_bind())
    has_sessions = inspector.has_table("experiment_sessions")
    if not has_sessions:
        op.create_table(
            "experiment_sessions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("lab_type", sa.String(length=16), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="新会话"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_experiment_sessions_lab_updated", "experiment_sessions", ["lab_type", "updated_at"])
    elif "ix_experiment_sessions_lab_updated" not in {index["name"] for index in inspector.get_indexes("experiment_sessions")}:
        op.create_index("ix_experiment_sessions_lab_updated", "experiment_sessions", ["lab_type", "updated_at"])

    has_messages = inspector.has_table("experiment_messages")
    if not has_messages:
        op.create_table(
            "experiment_messages",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("session_id", sa.String(length=64), sa.ForeignKey("experiment_sessions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("task_id", sa.String(length=64), nullable=True, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_experiment_messages_session_created", "experiment_messages", ["session_id", "created_at"])
    elif "ix_experiment_messages_session_created" not in {index["name"] for index in inspector.get_indexes("experiment_messages")}:
        op.create_index("ix_experiment_messages_session_created", "experiment_messages", ["session_id", "created_at"])


def downgrade() -> None:
    """删除实验会话与消息表。"""
    op.drop_index("ix_experiment_messages_session_created", table_name="experiment_messages")
    op.drop_table("experiment_messages")
    op.drop_index("ix_experiment_sessions_lab_updated", table_name="experiment_sessions")
    op.drop_table("experiment_sessions")
