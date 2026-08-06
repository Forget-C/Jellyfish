"""allow pending blob artifacts

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-08-05
"""

from collections.abc import Sequence

from alembic import op


revision: str = "e0f1a2b3c4d5"
down_revision: str | Sequence[str] | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """允许媒体 Artifact 在物化期间仅绑定 Blob，物化后可同时绑定 FileItem。"""
    op.drop_constraint("ck_generation_artifact_single_content", "generation_artifacts", type_="check")
    op.create_check_constraint(
        "ck_generation_artifact_single_content",
        "generation_artifacts",
        "(text_content IS NOT NULL AND file_id IS NULL AND blob_id IS NULL) "
        "OR (text_content IS NULL AND (file_id IS NOT NULL OR blob_id IS NOT NULL))",
    )


def downgrade() -> None:
    """仅在没有 pending Blob Artifact 时恢复旧的单内容约束。"""
    op.drop_constraint("ck_generation_artifact_single_content", "generation_artifacts", type_="check")
    op.create_check_constraint(
        "ck_generation_artifact_single_content",
        "generation_artifacts",
        "(file_id IS NOT NULL AND text_content IS NULL) OR (file_id IS NULL AND text_content IS NOT NULL)",
    )
