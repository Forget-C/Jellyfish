"""Add frozen chapter excerpts and explicit directing action records."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = "35d9f2b7ca03"
down_revision = "24c8e1a6b902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add source ranges and user action identities without rewriting old design content."""
    if op.get_bind().dialect.name == "mysql":
        op.alter_column("directing_revisions", "created_at", existing_type=sa.DateTime(), type_=DATETIME(fsp=6), existing_nullable=False)
    op.add_column("directing_sequences", sa.Column("source_start", sa.Integer(), nullable=True))
    op.add_column("directing_sequences", sa.Column("source_end", sa.Integer(), nullable=True))
    op.add_column("directing_sequences", sa.Column("source_text", sa.Text(), nullable=False, server_default=""))
    op.create_table("directing_actions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("sequence_id", sa.String(64), sa.ForeignKey("directing_sequences.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("revision_id", sa.String(64), sa.ForeignKey("directing_revisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("displayed_label", sa.String(128), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("review_revision_id", sa.String(64), sa.ForeignKey("directing_revisions.id", ondelete="RESTRICT")),
        sa.Column("request_id", sa.String(64), unique=True),
        sa.Column("task_id", sa.String(64), sa.ForeignKey("tasks.id", ondelete="RESTRICT"), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("action IN ('compile','execute')", name="ck_directing_action_kind"),
    )
    op.create_index("ix_directing_actions_sequence_id", "directing_actions", ["sequence_id"])


def downgrade() -> None:
    """Remove only workspace additions after their data has been backed up."""
    op.drop_table("directing_actions")
    with op.batch_alter_table("directing_sequences") as batch:
        batch.drop_column("source_text")
        batch.drop_column("source_end")
        batch.drop_column("source_start")
