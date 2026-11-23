"""Persist editable canvas assistant queue entries independently from turns."""

import sqlalchemy as sa
from alembic import op

revision = '646a42e84603'
down_revision = '3f736ca8361d'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('canvas_assistant_queue',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(12), nullable=False),
        sa.Column('turn_id', sa.String(64), nullable=True),
        sa.Column('request_digest', sa.String(64), nullable=False),
        sa.Column('command', sa.JSON(), nullable=False),
        sa.UniqueConstraint('canvas_id', 'turn_id', name='uq_canvas_assistant_queue_turn'),
    )
    op.create_index('ix_canvas_assistant_queue_order', 'canvas_assistant_queue', ('canvas_id', 'state', 'position'))


def downgrade():
    op.drop_index('ix_canvas_assistant_queue_order', table_name='canvas_assistant_queue')
    op.drop_table('canvas_assistant_queue')
