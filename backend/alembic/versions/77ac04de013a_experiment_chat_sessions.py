"""Persist multimodal chat selection and active turn."""
from alembic import op
import sqlalchemy as sa

revision = '77ac04de013a'
down_revision = 'd30d780cc104'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('experiment_sessions', sa.Column('chat_models', sa.JSON(), nullable=True))
    op.add_column('experiment_sessions', sa.Column('active_turn', sa.String(64), nullable=True))


def downgrade():
    op.drop_column('experiment_sessions', 'active_turn')
    op.drop_column('experiment_sessions', 'chat_models')
