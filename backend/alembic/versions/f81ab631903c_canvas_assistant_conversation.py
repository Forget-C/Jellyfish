"""Persist a conversation for each canvas assistant."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import MEDIUMTEXT

revision = 'f81ab631903c'
down_revision = 'b7326dc40a19'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'canvas_assistant_sessions',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('generation_canvases.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('pending_token', sa.String(32), nullable=True),
        sa.Column('pending_until', sa.DateTime(), nullable=True),
    )
    op.create_table(
        'canvas_assistant_turns',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('canvas_assistant_sessions.canvas_id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.String(64), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('reply', sa.Text().with_variant(MEDIUMTEXT(), 'mysql'), nullable=False),
        sa.UniqueConstraint('canvas_id', 'sequence', name='uq_canvas_assistant_turn_sequence'),
    )


def downgrade():
    op.drop_table('canvas_assistant_turns')
    op.drop_table('canvas_assistant_sessions')
