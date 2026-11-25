"""Persist replayable public trial events independently of a client connection."""
import sqlalchemy as sa
from alembic import op

revision = "d30d780cc104"
down_revision = "e39c7b146a91"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "experiment_session_events",
        sa.Column("cursor", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(64), sa.ForeignKey("experiment_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("turn_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_experiment_events_session_cursor", "experiment_session_events", ["session_id", "cursor"])


def downgrade():
    op.drop_table("experiment_session_events")
