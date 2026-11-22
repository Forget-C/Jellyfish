"""Persist leased assistant requests and their resumable graph checkpoints."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import MEDIUMBLOB

revision = 'a17efb08f62d'
down_revision = '2a05d5bca19e'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_sessions', sa.Column('pending_request', sa.JSON(), nullable=True))
    op.add_column('canvas_assistant_sessions', sa.Column(
        'pending_checkpoint', sa.LargeBinary().with_variant(MEDIUMBLOB(), 'mysql'), nullable=True,
    ))


def downgrade():
    op.drop_column('canvas_assistant_sessions', 'pending_checkpoint')
    op.drop_column('canvas_assistant_sessions', 'pending_request')
