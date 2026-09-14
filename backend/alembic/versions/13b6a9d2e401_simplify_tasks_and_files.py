"""Consolidate task lifecycle and file identity; old execution history is not migrated.

Revision ID: 13b6a9d2e401
Revises: f2a3b4c5d6e7

Stop API and all old workers before upgrading. This revision removes old task
history, not business records or stored file bytes. Restore a backup to roll back.
"""

from alembic import op
import sqlalchemy as sa

revision = "13b6a9d2e401"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None

OLD_TABLES = (
    "generation_task_links", "generation_dispatch_outbox", "generation_task_media_references",
    "generation_artifacts", "provider_operations", "generation_run_dispatches",
    "generation_runs", "generation_tasks", "storage_operation_outbox", "media_blobs",
)


def _check_file_identity() -> None:
    """在任何 DDL 前拒绝无法保留的对象身份，不截断 key 或合并不同文件记录。"""
    connection = op.get_bind()
    files = sa.table("files", sa.column("storage_key", sa.String()))
    key = files.c.storage_key
    if connection.scalar(sa.select(sa.func.count()).where(sa.func.length(key) > 700)):
        raise RuntimeError("File storage keys exceed 700 characters; resolve before migration")
    binary_key = key.collate("utf8mb4_bin") if connection.dialect.name == "mysql" else key
    duplicate = sa.select(binary_key).group_by(binary_key).having(sa.func.count() > 1).limit(1)
    if connection.execute(duplicate).first() is not None:
        raise RuntimeError("Multiple files share a storage key; resolve before migration")


def _create_tasks() -> None:
    """冻结任务表定义；迁移不导入会随业务变化的 ORM。"""
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("target_type", sa.String(64)),
        sa.Column("target_id", sa.String(64)),
        sa.Column("expected_target_version", sa.Integer()),
        sa.Column("project_id", sa.String(64)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False),
        sa.Column("progress", sa.Integer()),
        sa.Column("execution_mode", sa.String(16), nullable=False),
        sa.Column("worker_instance_id", sa.String(64)),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("provider_id", sa.String(64), sa.ForeignKey("providers.id", ondelete="RESTRICT")),
        sa.Column("provider_task_id", sa.String(255)),
        sa.Column("remote_status", sa.String(64)),
        sa.Column("next_poll_at", sa.DateTime()),
        sa.Column("last_polled_at", sa.DateTime()),
        sa.Column("deadline_at", sa.DateTime()),
        sa.Column("cancel_requested_at", sa.DateTime()),
        sa.Column("cancel_reason", sa.String(255)),
        sa.Column("error_code", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("last_poll_error", sa.Text()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("retry_of_task_id", sa.String(64), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','cancelled')", name="ck_tasks_status"),
        sa.CheckConstraint("execution_mode IN ('direct','remote')", name="ck_tasks_execution_mode"),
        sa.CheckConstraint("progress IS NULL OR (progress >= 0 AND progress <= 100)", name="ck_tasks_progress"),
    )
    for name, columns in {
        "queue": ["status", "created_at", "id"],
        "poll": ["status", "next_poll_at", "id"],
        "deadline": ["status", "deadline_at"],
        "history": ["created_at", "id"],
        "project_history": ["project_id", "created_at", "id"],
        "target": ["target_type", "target_id", "created_at"],
    }.items():
        op.create_index(f"ix_tasks_{name}", "tasks", columns)
    op.create_table(
        "task_inputs",
        sa.Column("task_id", sa.String(64), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_path", sa.String(255), primary_key=True),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("files.id", ondelete="RESTRICT"), nullable=False),
    )
    op.create_index("ix_task_inputs_file", "task_inputs", ["file_id", "task_id"])
    op.create_table(
        "task_outputs",
        sa.Column("task_id", sa.String(64), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("files.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("delivery_status", sa.String(16)),
        sa.Column("delivery_reason", sa.String(128)),
        sa.CheckConstraint("delivery_status IS NULL OR delivery_status IN ('published','conflicted','skipped')", name="ck_task_outputs_delivery"),
        sa.CheckConstraint("ordinal >= 0", name="ck_task_outputs_ordinal"),
    )
    op.create_index("ix_task_outputs_file_id", "task_outputs", ["file_id"])


def upgrade() -> None:
    """保留文件和业务引用，丢弃旧执行历史，新任务统一使用三张任务表。"""
    _check_file_identity()
    # 按外键依赖顺序清理；不改对象存储，不尝试恢复旧任务。
    for table in OLD_TABLES:
        op.drop_table(table)
    key_type = sa.String(700, collation="utf8mb4_bin") if op.get_bind().dialect.name == "mysql" else sa.String(700)
    with op.batch_alter_table("files") as batch:
        batch.drop_column("thumbnail")
        batch.drop_column("content_version")
        batch.alter_column("storage_key", existing_type=sa.String(1024), type_=key_type, existing_nullable=False)
        batch.add_column(sa.Column("thumbnail_key", sa.String(700)))
        batch.add_column(sa.Column("content_type", sa.String(255), nullable=False, server_default="application/octet-stream"))
        batch.add_column(sa.Column("size_bytes", sa.BigInteger()))
        batch.add_column(sa.Column("width", sa.Integer()))
        batch.add_column(sa.Column("height", sa.Integer()))
        batch.add_column(sa.Column("duration_ms", sa.BigInteger()))
        batch.add_column(sa.Column("delete_requested_at", sa.DateTime()))
        batch.add_column(sa.Column("deleted_at", sa.DateTime()))
        batch.create_unique_constraint("uq_files_storage_key", ["storage_key"])
        batch.create_index("ix_files_delete", ["deleted_at", "delete_requested_at"])
    with op.batch_alter_table("files") as batch:
        batch.alter_column("content_type", existing_type=sa.String(255), existing_nullable=False, server_default=None)
    with op.batch_alter_table("file_usages") as batch:
        batch.drop_constraint("uq_file_usages_file_kind_ref", type_="unique")
        batch.create_unique_constraint("uq_file_usages_file_project_kind_ref", ["file_id", "project_id", "usage_kind", "source_ref"])
    _create_tasks()


def downgrade() -> None:
    """删除的旧任务历史不能还原，回退须恢复数据库备份。"""
    raise NotImplementedError("Restore a database backup to roll back task schema simplification")
