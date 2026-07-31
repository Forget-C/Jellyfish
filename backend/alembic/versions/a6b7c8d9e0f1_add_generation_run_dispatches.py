"""add generation run dispatch events

Revision ID: a6b7c8d9e0f1
Revises: f1a2b3c4d5e6
Create Date: 2026-07-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a6b7c8d9e0f1"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建 Celery work_id 到 Run/epoch 的可审计投递事件表。"""
    op.create_table(
        "generation_run_dispatches",
        sa.Column("work_id", sa.String(length=128), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("generation_run_id", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("lease_epoch", sa.Integer(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivery_lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["generation_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["generation_run_id"], ["generation_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("work_id"),
        sa.UniqueConstraint("generation_run_id", "lease_epoch", name="uq_generation_run_dispatches_run_epoch"),
    )
    op.create_index("ix_generation_run_dispatches_task_created", "generation_run_dispatches", ["task_id", "created_at"])
    op.create_index(
        "ix_generation_run_dispatches_status_delivery_lease",
        "generation_run_dispatches",
        ["status", "delivery_lease_expires_at"],
    )
    op.create_index("ix_generation_run_dispatches_run_epoch", "generation_run_dispatches", ["generation_run_id", "lease_epoch"])


def downgrade() -> None:
    """删除可由任务与 Run 重建的投递审计事件。"""
    op.drop_index("ix_generation_run_dispatches_run_epoch", table_name="generation_run_dispatches")
    op.drop_index("ix_generation_run_dispatches_status_delivery_lease", table_name="generation_run_dispatches")
    op.drop_index("ix_generation_run_dispatches_task_created", table_name="generation_run_dispatches")
    op.drop_table("generation_run_dispatches")
