"""add media blobs and storage operation outbox

Revision ID: d9e0f1a2b3c4
Revises: c7d8e9f0a1b2
Create Date: 2026-08-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d9e0f1a2b3c4"
down_revision: str | Sequence[str] | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """以 expand 方式引入 Blob 与可靠存储操作，不切换既有 Artifact 写入路径。"""
    op.create_table(
        "media_blobs",
        sa.Column("id", sa.String(length=64), nullable=False),
        # utf8mb4 下 UNIQUE(VARCHAR(1024)) 会超过 MySQL InnoDB 3072-byte 索引上限。
        sa.Column("storage_key", sa.String(length=700), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("etag", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("retention_until", sa.DateTime(), nullable=True),
        sa.Column("delete_tombstoned_at", sa.DateTime(), nullable=True),
        sa.Column("materialized_at", sa.DateTime(), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_media_blobs_status", "media_blobs", ["status"])
    op.create_index("ix_media_blobs_status_retention", "media_blobs", ["status", "retention_until"])
    op.create_table(
        "storage_operation_outbox",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("blob_id", sa.String(length=64), nullable=False),
        sa.Column("operation_kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_owner", sa.String(length=128), nullable=True),
        sa.Column("lease_epoch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("not_before_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["blob_id"], ["media_blobs.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
        sa.UniqueConstraint("blob_id", "operation_kind", "idempotency_key", name="uq_storage_outbox_blob_operation_key"),
    )
    op.create_index("ix_storage_operation_outbox_blob_id", "storage_operation_outbox", ["blob_id"])
    op.create_index("ix_storage_operation_outbox_status", "storage_operation_outbox", ["status"])
    op.create_index("ix_storage_outbox_status_not_before", "storage_operation_outbox", ["status", "not_before_at", "created_at"])
    op.create_index("ix_storage_outbox_status_lease", "storage_operation_outbox", ["status", "lease_expires_at"])
    op.add_column("generation_artifacts", sa.Column("blob_id", sa.String(length=64), nullable=True))
    op.create_foreign_key("fk_generation_artifacts_blob_id", "generation_artifacts", "media_blobs", ["blob_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_generation_artifacts_blob_id", "generation_artifacts", ["blob_id"])


def downgrade() -> None:
    """回滚 expand 切片；调用方尚未依赖 Blob，因此可先解除可空关联。"""
    op.drop_index("ix_generation_artifacts_blob_id", table_name="generation_artifacts")
    op.drop_constraint("fk_generation_artifacts_blob_id", "generation_artifacts", type_="foreignkey")
    op.drop_column("generation_artifacts", "blob_id")
    op.drop_index("ix_storage_outbox_status_lease", table_name="storage_operation_outbox")
    op.drop_index("ix_storage_outbox_status_not_before", table_name="storage_operation_outbox")
    op.drop_index("ix_storage_operation_outbox_status", table_name="storage_operation_outbox")
    op.drop_index("ix_storage_operation_outbox_blob_id", table_name="storage_operation_outbox")
    op.drop_table("storage_operation_outbox")
    op.drop_index("ix_media_blobs_status_retention", table_name="media_blobs")
    op.drop_index("ix_media_blobs_status", table_name="media_blobs")
    op.drop_table("media_blobs")
