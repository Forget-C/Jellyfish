"""Persist original cross-canvas reference identities with completed turns."""

import sqlalchemy as sa
from alembic import op

revision = '9f41d1a8ac20'
down_revision = 'de19956eb568'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('canvas_references', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'canvas_references')
