"""Retain assistant model selection and send-time canvas scope."""

from alembic import op
import sqlalchemy as sa

revision = '64d201eb47a0'
down_revision = 'c4925fa6d801'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_sessions', sa.Column('model_id', sa.String(64), nullable=True))
    op.add_column('canvas_assistant_turns', sa.Column('context', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('canvas_assistant_turns', 'context')
    op.drop_column('canvas_assistant_sessions', 'model_id')
