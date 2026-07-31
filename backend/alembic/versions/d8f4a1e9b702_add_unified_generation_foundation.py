"""add unified generation contracts storage foundation

Revision ID: d8f4a1e9b702
Revises: c6e2f4a9b301
Create Date: 2026-07-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql.schema import SchemaItem


revision: str = "d8f4a1e9b702"
down_revision: str | Sequence[str] | None = "c6e2f4a9b301"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_EXPECTED_TABLE_COLUMNS = {
    "model_config_revisions": {
        "id", "model_id", "version_id", "model_name", "category", "model_params",
        "provider_key", "endpoint_config", "capability_snapshot", "credential_ref",
        "created_at", "updated_at",
    },
    "generation_artifacts": {
        "id", "task_id", "generation_run_id", "modality", "ordinal", "file_id",
        "text_content", "provider_result", "publish_status", "publish_error", "created_at",
        "updated_at",
    },
    "generation_task_media_references": {
        "id", "task_id", "file_id", "group_path", "ordinal", "media_kind",
        "file_content_version", "file_content_hash", "created_at", "updated_at",
    },
    "generation_dispatch_outbox": {
        "id", "task_id", "payload", "dispatched_at", "attempts", "last_error",
        "created_at", "updated_at",
    },
}

_EXPECTED_UNIQUE_CONSTRAINTS = {
    "model_config_revisions": "uq_model_config_revisions_model_version",
    "generation_artifacts": "uq_generation_artifacts_task_ordinal",
    "generation_task_media_references": "uq_generation_task_media_group_ordinal",
}

_EXPECTED_CHECK_CONSTRAINTS = {
    "generation_artifacts": {
        "ck_generation_artifact_single_content",
        "ck_generation_artifact_publish_status",
    },
}


def _add_column_if_missing(table: str, column: sa.Column[object]) -> None:
    """为开发数据库的可重复前向迁移补齐缺失列。"""
    if column.name not in {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}:
        op.add_column(table, column)


def _create_table_if_missing(table: str, *elements: SchemaItem) -> None:
    """创建缺失表，或校验遗留表可安全继续本次迁移。"""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        op.create_table(table, *elements)
        return

    missing_columns = _EXPECTED_TABLE_COLUMNS[table] - {
        item["name"] for item in inspector.get_columns(table)
    }
    expected_unique = _EXPECTED_UNIQUE_CONSTRAINTS.get(table)
    unique_names = {item["name"] for item in inspector.get_unique_constraints(table)}
    missing_checks = _EXPECTED_CHECK_CONSTRAINTS.get(table, set()) - {
        item["name"] for item in inspector.get_check_constraints(table)
    }
    if missing_columns or (expected_unique and expected_unique not in unique_names) or missing_checks:
        missing_parts = []
        if missing_columns:
            missing_parts.append(f"columns={sorted(missing_columns)}")
        if expected_unique and expected_unique not in unique_names:
            missing_parts.append(f"unique_constraint={expected_unique}")
        if missing_checks:
            missing_parts.append(f"check_constraints={sorted(missing_checks)}")
        raise RuntimeError(f"Existing table {table!r} is incompatible with migration: {', '.join(missing_parts)}")


def _create_index_if_missing(index: str, table: str, columns: list[str]) -> None:
    """仅在索引不存在时创建，配合可重复前向迁移恢复部分执行状态。"""
    index_names = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
    if index not in index_names:
        op.create_index(index, table, columns)


def upgrade() -> None:
    """扩展统一生成基础表，不删除旧 TaskLink 字段或旧 payload。"""
    _add_column_if_missing("generation_tasks", sa.Column("visibility", sa.String(32), nullable=False, server_default="task_center"))
    _add_column_if_missing("generation_tasks", sa.Column("lease_owner", sa.String(128), nullable=True))
    _add_column_if_missing("generation_tasks", sa.Column("lease_epoch", sa.Integer(), nullable=False, server_default="0"))
    _add_column_if_missing("generation_tasks", sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("generation_tasks", sa.Column("heartbeat_at", sa.DateTime(), nullable=True))
    _create_index_if_missing(
        "ix_generation_tasks_visibility_updated_at", "generation_tasks", ["visibility", "updated_at"]
    )

    _add_column_if_missing("models", sa.Column("current_revision_id", sa.String(64), nullable=True))
    _create_index_if_missing("ix_models_current_revision_id", "models", ["current_revision_id"])

    _create_table_if_missing(
        "model_config_revisions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("model_id", sa.String(64), sa.ForeignKey("models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("model_params", sa.JSON(), nullable=False),
        sa.Column("provider_key", sa.String(64), nullable=False),
        sa.Column("endpoint_config", sa.JSON(), nullable=False),
        sa.Column("capability_snapshot", sa.JSON(), nullable=False),
        sa.Column("credential_ref", sa.String(255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("model_id", "version_id", name="uq_model_config_revisions_model_version"),
    )
    _create_index_if_missing(
        "ix_model_config_revisions_model_version", "model_config_revisions", ["model_id", "version_id"]
    )

    for table in ("actor_images", "character_images", "scene_images", "prop_images", "costume_images", "shot_frame_images"):
        _add_column_if_missing(table, sa.Column("version_id", sa.Integer(), nullable=False, server_default="1"))
    _add_column_if_missing("shots", sa.Column("generated_video_version_id", sa.Integer(), nullable=False, server_default="1"))
    _add_column_if_missing("files", sa.Column("content_version", sa.Integer(), nullable=False, server_default="1"))
    _add_column_if_missing("files", sa.Column("content_hash", sa.String(128), nullable=True))

    _create_table_if_missing(
        "generation_artifacts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("task_id", sa.String(64), sa.ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("generation_run_id", sa.String(64), nullable=True),
        sa.Column("modality", sa.String(16), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("files.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("provider_result", sa.JSON(), nullable=False),
        sa.Column("publish_status", sa.String(16), nullable=False),
        sa.Column("publish_error", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("task_id", "ordinal", name="uq_generation_artifacts_task_ordinal"),
        sa.CheckConstraint("(file_id IS NOT NULL AND text_content IS NULL) OR (file_id IS NULL AND text_content IS NOT NULL)", name="ck_generation_artifact_single_content"),
        sa.CheckConstraint("(publish_status = 'published' AND publish_error IS NULL) OR (publish_status = 'conflicted' AND publish_error = 'target_version_conflict') OR (publish_status = 'skipped' AND publish_error IS NOT NULL)", name="ck_generation_artifact_publish_status"),
    )
    _create_index_if_missing("ix_generation_artifacts_task_ordinal", "generation_artifacts", ["task_id", "ordinal"])
    _create_index_if_missing("ix_generation_artifacts_generation_run_id", "generation_artifacts", ["generation_run_id"])

    _create_table_if_missing(
        "generation_task_media_references",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.String(64), sa.ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("files.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("group_path", sa.String(255), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("media_kind", sa.String(16), nullable=False),
        sa.Column("file_content_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("file_content_hash", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("task_id", "group_path", "ordinal", name="uq_generation_task_media_group_ordinal"),
    )
    _create_index_if_missing(
        "ix_generation_task_media_file_task", "generation_task_media_references", ["file_id", "task_id"]
    )

    _create_table_if_missing(
        "generation_dispatch_outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.String(64), sa.ForeignKey("generation_tasks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("dispatched_at", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    _create_index_if_missing(
        "ix_generation_dispatch_outbox_dispatched", "generation_dispatch_outbox", ["dispatched_at", "created_at"]
    )


def downgrade() -> None:
    """回退 P1 expand 表与列，供开发数据库重建时使用。"""
    op.drop_table("generation_dispatch_outbox")
    op.drop_table("generation_task_media_references")
    op.drop_table("generation_artifacts")
    op.drop_table("model_config_revisions")
    with op.batch_alter_table("files") as batch_op:
        batch_op.drop_column("content_hash")
        batch_op.drop_column("content_version")
    with op.batch_alter_table("shots") as batch_op:
        batch_op.drop_column("generated_video_version_id")
    for table in ("actor_images", "character_images", "scene_images", "prop_images", "costume_images", "shot_frame_images"):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column("version_id")
    op.drop_index("ix_models_current_revision_id", table_name="models")
    with op.batch_alter_table("models") as batch_op:
        batch_op.drop_column("current_revision_id")
    op.drop_index("ix_generation_tasks_visibility_updated_at", table_name="generation_tasks")
    with op.batch_alter_table("generation_tasks") as batch_op:
        batch_op.drop_column("heartbeat_at")
        batch_op.drop_column("lease_expires_at")
        batch_op.drop_column("lease_epoch")
        batch_op.drop_column("lease_owner")
        batch_op.drop_column("visibility")
