"""Persist a canvas approval mode and the approval source on assistant turns."""

import sqlalchemy as sa
from alembic import op

revision = '42bc9d2e706f'
down_revision = 'e7f421506a8c'
branch_labels = None
depends_on = None


def upgrade():
    """Default existing canvases to manual approval."""
    op.add_column('canvas_assistant_sessions', sa.Column('approval_mode', sa.String(12),
                                                        nullable=False, server_default='manual'))
    op.add_column('canvas_assistant_turns', sa.Column('approval_audit', sa.JSON(), nullable=True))


def downgrade():
    """Remove the canvas setting and audit records."""
    op.drop_column('canvas_assistant_turns', 'approval_audit')
    op.drop_column('canvas_assistant_sessions', 'approval_mode')
