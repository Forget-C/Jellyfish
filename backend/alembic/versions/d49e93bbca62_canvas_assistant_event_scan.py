"""Persist an ordered sweep position for generation events."""

from alembic import op
import sqlalchemy as sa

revision = 'd49e93bbca62'
down_revision = '77ae863c5f02'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_generations', sa.Column('event_checked_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_generations', 'event_checked_at')
