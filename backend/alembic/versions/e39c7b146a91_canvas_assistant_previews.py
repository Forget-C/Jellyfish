"""Keep exact canvas previews separate from approvals until explicit submission."""

from alembic import op
import sqlalchemy as sa

revision = 'e39c7b146a91'
down_revision = 'd43949a84d12'
branch_labels = None
depends_on = None


def upgrade():
    """Add a preview store that can also hold an unsaved canvas's candidates."""
    op.create_table(
        'canvas_assistant_previews',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64), nullable=True),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('model_id', sa.String(64), nullable=False),
        sa.Column('basis', sa.String(64), nullable=False),
        sa.Column('draft', sa.Boolean(), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('submitted_source', sa.String(64), nullable=True),
    )


def downgrade():
    """Remove previews; existing approvals hold their independent snapshots."""
    op.drop_table('canvas_assistant_previews')
