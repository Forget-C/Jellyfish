"""Persist multimodal chat selection, active turn and event cursor."""
from alembic import op
import sqlalchemy as sa

revision = '77ac04de013a'
down_revision = 'e39c7b146a91'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('experiment_sessions', sa.Column('chat_models', sa.JSON(), nullable=True))
    op.add_column('experiment_sessions', sa.Column('active_turn', sa.String(64), nullable=True))
    op.create_table('experiment_chat_events',
                    sa.Column('cursor', sa.Integer(), primary_key=True, autoincrement=True),
                    sa.Column('session_id', sa.String(64), sa.ForeignKey('experiment_sessions.id', ondelete='CASCADE'), nullable=False),
                    sa.Column('turn_id', sa.String(64), nullable=False),
                    sa.Column('type', sa.String(48), nullable=False),
                    sa.Column('payload', sa.JSON(), nullable=False))
    op.create_index('ix_experiment_chat_events_session_id', 'experiment_chat_events', ['session_id'])


def downgrade():
    op.drop_table('experiment_chat_events')
    op.drop_column('experiment_sessions', 'active_turn')
    op.drop_column('experiment_sessions', 'chat_models')
