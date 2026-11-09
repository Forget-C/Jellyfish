"""Allow an existing story scene to own multiple generation canvases."""

import sqlalchemy as sa
from alembic import op

revision = 'b3af1a8c924d'
down_revision = 'af032bcf591e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add optional ownership; existing project canvases remain independent."""
    with op.batch_alter_table('generation_canvases') as table:
        table.add_column(sa.Column('sequence_id', sa.String(64), nullable=True))
        table.create_index('ix_generation_canvases_sequence_id', ['sequence_id'])
        table.create_foreign_key('fk_generation_canvas_sequence', 'directing_sequences',
                                 ['sequence_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Remove the scene ownership column and its constraints."""
    with op.batch_alter_table('generation_canvases') as table:
        table.drop_constraint('fk_generation_canvas_sequence', type_='foreignkey')
        table.drop_index('ix_generation_canvases_sequence_id')
        table.drop_column('sequence_id')
