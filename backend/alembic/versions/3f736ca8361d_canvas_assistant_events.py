"""Persist ordered, replayable assistant events for already-published turns."""

import sqlalchemy as sa
from alembic import op

revision = '3f736ca8361d'
down_revision = '4a7c406c8f39'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_sessions', sa.Column('event_cursor', sa.Integer(), server_default='0', nullable=False))
    op.execute('UPDATE canvas_assistant_sessions SET event_cursor = sequence')
    op.create_table('canvas_assistant_events',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('cursor', sa.Integer(), primary_key=True),
        sa.Column('source_id', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(40), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table('canvas_assistant_events')
    op.drop_column('canvas_assistant_sessions', 'event_cursor')
