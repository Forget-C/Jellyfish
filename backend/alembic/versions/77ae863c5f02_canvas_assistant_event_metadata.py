"""Persist assistant event time and durable generation publication state."""

from alembic import op
import sqlalchemy as sa

revision = '77ae863c5f02'
down_revision = '9e40d80439be'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('canvas_assistant_events', sa.Column('created_at', sa.DateTime(), nullable=True))
    op.add_column('canvas_assistant_generations', sa.Column('event_digest', sa.String(64), nullable=True))
    op.add_column('canvas_assistant_generations', sa.Column('events_closed', sa.Boolean(), nullable=False, server_default='0'))


def downgrade():
    op.drop_column('canvas_assistant_generations', 'events_closed')
    op.drop_column('canvas_assistant_generations', 'event_digest')
    op.drop_column('canvas_assistant_events', 'created_at')
