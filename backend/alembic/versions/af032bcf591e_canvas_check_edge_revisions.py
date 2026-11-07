"""Remember invalidated generation-to-check relationships for admitted work."""
import sqlalchemy as sa
from alembic import op

revision = 'af032bcf591e'
down_revision = '4c68b18ae451'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Existing relationships start without an invalidating revision."""
    op.add_column('generation_canvases', sa.Column('check_edge_revisions', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Remove private check-relationship history."""
    op.drop_column('generation_canvases', 'check_edge_revisions')
