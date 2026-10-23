"""Persist exact selected scope in precheck credentials."""
from alembic import op
import sqlalchemy as sa

revision = '9b11d05c742f'
down_revision = '8a10d04c631e'
branch_labels = None
depends_on = None


def upgrade():
    """Old single/target previews retain their existing behavior."""
    op.add_column('generation_canvas_previews', sa.Column('card_ids', sa.JSON(), nullable=True))


def downgrade():
    """Discard selected scope only after stopping new-version admissions."""
    op.drop_column('generation_canvas_previews', 'card_ids')
