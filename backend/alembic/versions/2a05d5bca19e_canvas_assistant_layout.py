"""Persist approved browser layout proposals and receipts."""

import sqlalchemy as sa
from alembic import op

revision = '2a05d5bca19e'
down_revision = '75b9c41ac8df'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('layout', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'layout')
