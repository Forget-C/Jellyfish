"""Store scene object candidates and explicit reference choices."""

import sqlalchemy as sa
from alembic import op

revision = 'd34171ab93f2'
down_revision = 'b3af1a8c924d'
branch_labels = None
depends_on = None


def upgrade():
    """Add independent preparation without backfilling any scene."""
    op.add_column('directing_sequences', sa.Column('object_preparation', sa.JSON(), nullable=True))


def downgrade():
    """Drop the scene object preparation snapshot."""
    op.drop_column('directing_sequences', 'object_preparation')
