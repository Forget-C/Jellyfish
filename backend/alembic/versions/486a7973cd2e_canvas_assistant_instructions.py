"""Persist supplemental instructions independently of the accepted turn text."""

import sqlalchemy as sa
from alembic import op

revision = '486a7973cd2e'
down_revision = '646a42e84603'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('instructions', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'instructions')
