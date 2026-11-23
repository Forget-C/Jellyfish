"""Publish specialist receipts with their originating assistant turns."""

import sqlalchemy as sa
from alembic import op

revision = 'de19956eb568'
down_revision = '5ed6809eb96d'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('subtasks', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'subtasks')
