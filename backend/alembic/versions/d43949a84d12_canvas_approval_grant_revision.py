"""Track canvas approval-grant changes while a reviewer is running."""

from alembic import op
import sqlalchemy as sa

revision = 'd43949a84d12'
down_revision = 'd6bf47c2a901'
branch_labels = None
depends_on = None


def upgrade():
    """New installations and upgrades start with a known grant revision."""
    op.add_column('canvas_assistant_sessions', sa.Column(
        'approval_revision', sa.Integer(), server_default='0', nullable=False,
    ))


def downgrade():
    """Remove the monotone grant revision."""
    op.drop_column('canvas_assistant_sessions', 'approval_revision')
