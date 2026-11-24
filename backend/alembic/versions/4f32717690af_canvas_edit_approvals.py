"""Persist canvas approval snapshots and atomic edit execution receipts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '4f32717690af'
down_revision = '3969beaf228e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'canvas_edit_approval_snapshots',
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64)),
        sa.Column('plan', sa.JSON(), nullable=False),
        sa.Column('next_scan_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')),
    )
    op.create_index('ix_canvas_edit_approval_snapshots_next_scan_at', 'canvas_edit_approval_snapshots', ['next_scan_at'])
    op.create_table(
        'canvas_edit_approval_executions',
        sa.Column('decision_id', sa.String(64), sa.ForeignKey('approval_decisions.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('group_key', sa.String(64), primary_key=True),
        sa.Column('group_id', sa.String(64), nullable=False),
        sa.Column('request_id', sa.String(64), sa.ForeignKey('canvas_edit_approval_snapshots.request_id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('receipt', sa.JSON(), nullable=False),
    )
    op.create_index('ix_canvas_edit_approval_executions_request_id', 'canvas_edit_approval_executions', ['request_id'])


def downgrade() -> None:
    op.drop_table('canvas_edit_approval_executions')
    op.drop_table('canvas_edit_approval_snapshots')
