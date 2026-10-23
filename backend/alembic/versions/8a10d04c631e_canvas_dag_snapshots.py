"""Private admission snapshots for waiting canvas nodes."""
from alembic import op
import sqlalchemy as sa

revision = '8a10d04c631e'
down_revision = '473ab089b58f'
branch_labels = None
depends_on = None


def upgrade():
    """Retain old single-card runs; only new admissions need private state."""
    op.add_column('generation_canvas_run_nodes', sa.Column('execution_snapshot', sa.JSON(), nullable=True))
    op.add_column('generation_canvas_previews', sa.Column('kind', sa.String(16), nullable=False, server_default='single'))
    with op.batch_alter_table('generation_canvas_previews') as batch:
        batch.alter_column('kind', server_default=None)


def downgrade():
    """Remove private snapshots after old-version rollback has stopped runs."""
    op.drop_column('generation_canvas_previews', 'kind')
    op.drop_column('generation_canvas_run_nodes', 'execution_snapshot')
