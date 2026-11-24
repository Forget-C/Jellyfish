"""Persist proposal validation results alongside the assistant transcript."""

from alembic import op
import sqlalchemy as sa

revision = "8b7cdef41210"
down_revision = "d49e93bbca62"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("canvas_assistant_turns", sa.Column("proposal_issues", sa.JSON(), nullable=True))
    op.add_column("canvas_assistant_turns", sa.Column("repairs", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("canvas_assistant_turns", "repairs")
    op.drop_column("canvas_assistant_turns", "proposal_issues")
