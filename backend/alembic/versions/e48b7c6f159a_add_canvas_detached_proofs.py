"""Retain verified result detachments across document deletion and undo."""

from alembic import op
import sqlalchemy as sa

revision = 'e48b7c6f159a'
down_revision = 'c73e5da012bf'
branch_labels = None
depends_on = None


def upgrade():
    """Add private proof storage without changing saved document revisions."""
    op.add_column('generation_canvases', sa.Column('detached_proofs', sa.JSON(), nullable=True))


def downgrade():
    """Remove the undo proof ledger."""
    op.drop_column('generation_canvases', 'detached_proofs')
