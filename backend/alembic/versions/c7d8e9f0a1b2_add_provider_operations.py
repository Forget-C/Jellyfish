"""add provider operations

Revision ID: c7d8e9f0a1b2
Revises: a6b7c8d9e0f1
Create Date: 2026-07-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: str | Sequence[str] | None = "a6b7c8d9e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """以 expand 方式创建 ProviderOperation，不读取或删除现有 Run checkpoint。"""
    op.create_table(
        "provider_operations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("attempt_id", sa.String(length=64), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("operation_kind", sa.String(length=64), nullable=False),
        sa.Column("provider_key", sa.String(length=64), nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=True),
        sa.Column("route_identity", sa.JSON(), nullable=False),
        sa.Column("capability_version", sa.String(length=64), nullable=True),
        sa.Column("secret_ref", sa.String(length=255), nullable=True),
        sa.Column("request_hash", sa.String(length=128), nullable=True),
        sa.Column("request_summary", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("remote_id", sa.String(length=128), nullable=True),
        sa.Column("remote_status", sa.String(length=64), nullable=True),
        sa.Column("remote_receipt", sa.JSON(), nullable=True),
        sa.Column("create_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("poll_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_poll_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(), nullable=True),
        sa.Column("create_uncertain_at", sa.DateTime(), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("error_class", sa.String(length=64), nullable=True),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["generation_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", "ordinal", name="uq_provider_operations_attempt_ordinal"),
    )
    op.create_index("ix_provider_operations_attempt_id", "provider_operations", ["attempt_id"])
    op.create_index("ix_provider_operations_status", "provider_operations", ["status"])
    op.create_index("ix_provider_operations_status_next_poll", "provider_operations", ["status", "next_poll_at"])
    op.create_index("ix_provider_operations_provider_remote", "provider_operations", ["provider_key", "remote_id"])


def downgrade() -> None:
    """删除尚未承载唯一执行真相的 expand 表。"""
    op.drop_index("ix_provider_operations_provider_remote", table_name="provider_operations")
    op.drop_index("ix_provider_operations_status_next_poll", table_name="provider_operations")
    op.drop_index("ix_provider_operations_status", table_name="provider_operations")
    op.drop_index("ix_provider_operations_attempt_id", table_name="provider_operations")
    op.drop_table("provider_operations")
