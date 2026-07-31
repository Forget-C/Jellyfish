"""add generation execution runs

Revision ID: f1a2b3c4d5e6
Revises: e2b7c6d9f4a3
Create Date: 2026-07-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "e2b7c6d9f4a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建执行尝试表，并将既有产物归入每任务的 legacy Run。"""
    op.create_table(
        "generation_runs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("lease_owner", sa.String(length=128), nullable=True),
        sa.Column("lease_epoch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("provider_idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("provider_task_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("callback_payload", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["generation_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_idempotency_key"),
        sa.UniqueConstraint("task_id", "attempt_no", name="uq_generation_runs_task_attempt"),
    )
    op.create_index("ix_generation_runs_task_created", "generation_runs", ["task_id", "created_at"])
    op.create_index("ix_generation_runs_status_lease", "generation_runs", ["status", "lease_expires_at"])

    # 旧产物没有 attempt 归属。为每个关联任务建立 attempt 0 的终态 legacy Run，
    # 让历史审计记录在新增外键后仍可追溯；新 Executor 的 attempt 从 1 开始。
    op.execute(
        sa.text(
            """
            INSERT INTO generation_runs (
                id, task_id, attempt_no, status, lease_epoch, created_at, updated_at, finished_at
            )
            SELECT artifact.task_id, artifact.task_id, 0, 'terminal', 0,
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM generation_artifacts AS artifact
            WHERE artifact.task_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM generation_runs AS run WHERE run.id = artifact.task_id
              )
            GROUP BY artifact.task_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE generation_artifacts
            SET generation_run_id = task_id
            WHERE task_id IS NOT NULL
            """
        )
    )
    with op.batch_alter_table("generation_artifacts") as batch_op:
        batch_op.drop_constraint("uq_generation_artifacts_task_ordinal", type_="unique")
        batch_op.create_foreign_key(
            "fk_generation_artifacts_generation_run_id",
            "generation_runs",
            ["generation_run_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_unique_constraint(
            "uq_generation_artifacts_run_ordinal",
            ["generation_run_id", "ordinal"],
        )


def downgrade() -> None:
    """回滚 L1 expand 表，并恢复既有 Artifact 的无 Run 归属状态。"""
    with op.batch_alter_table("generation_artifacts") as batch_op:
        batch_op.drop_constraint("uq_generation_artifacts_run_ordinal", type_="unique")
        batch_op.drop_constraint("fk_generation_artifacts_generation_run_id", type_="foreignkey")
        batch_op.create_unique_constraint("uq_generation_artifacts_task_ordinal", ["task_id", "ordinal"])
    op.execute(sa.text("UPDATE generation_artifacts SET generation_run_id = NULL"))
    op.drop_index("ix_generation_runs_status_lease", table_name="generation_runs")
    op.drop_index("ix_generation_runs_task_created", table_name="generation_runs")
    op.drop_table("generation_runs")
