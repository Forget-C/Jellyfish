"""Persist explicitly authorized follow-up reviews and stops."""

from alembic import op
import sqlalchemy as sa

revision = '75b9c41ac8df'
down_revision = '42bc9d2e706f'
branch_labels = None
depends_on = None

_GENERATIONS = 'canvas_assistant_generations'


def upgrade():
    op.add_column('canvas_assistant_turns', sa.Column('stopped', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column(_GENERATIONS, sa.Column('review_request', sa.Text(), nullable=True))
    op.add_column(_GENERATIONS, sa.Column('review_state', sa.String(16), nullable=True))
    op.add_column(_GENERATIONS, sa.Column('review_results', sa.JSON(), nullable=True))
    op.add_column(_GENERATIONS, sa.Column('review_token', sa.String(32), nullable=True))
    op.add_column(_GENERATIONS, sa.Column('review_lease_until', sa.DateTime(), nullable=True))
    op.create_index('ix_canvas_assistant_generation_review', _GENERATIONS, ['review_state', 'created_at'])


def downgrade():
    op.drop_index('ix_canvas_assistant_generation_review', table_name=_GENERATIONS)
    for name in ('review_lease_until', 'review_token', 'review_results', 'review_state', 'review_request'):
        op.drop_column(_GENERATIONS, name)
    op.drop_column('canvas_assistant_turns', 'stopped')
