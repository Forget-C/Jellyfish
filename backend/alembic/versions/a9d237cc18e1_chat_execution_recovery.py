"""Persist active chat tool plans and recovery leases."""
from alembic import op
import sqlalchemy as sa

revision = 'a9d237cc18e1'
down_revision = '77ac04de013a'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('experiment_sessions', sa.Column('chat_execution', sa.JSON(), nullable=True))
    op.add_column('experiment_sessions', sa.Column('chat_lease_until', sa.DateTime(), nullable=True))
    op.create_index('ix_experiment_sessions_chat_lease', 'experiment_sessions', ['chat_lease_until'])


def downgrade():
    op.drop_index('ix_experiment_sessions_chat_lease', table_name='experiment_sessions')
    op.drop_column('experiment_sessions', 'chat_lease_until')
    op.drop_column('experiment_sessions', 'chat_execution')
