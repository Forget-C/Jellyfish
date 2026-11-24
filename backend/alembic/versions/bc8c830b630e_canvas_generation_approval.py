"""Track approved canvas generation against its original admission."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = 'bc8c830b630e'
down_revision = '4f32717690af'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'canvas_generation_approvals',
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('canvas_id', sa.String(64), nullable=False),
        sa.Column('project_id', sa.String(64)),
        sa.Column('card_id', sa.String(64), nullable=False),
        sa.Column('group_id', sa.String(64), nullable=False),
        sa.Column('basis_hash', sa.String(64), nullable=False),
        sa.Column('preview', sa.JSON(), nullable=False),
        sa.Column('next_scan_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')),
        sa.Column('state', sa.String(16), nullable=False),
        sa.Column('decision_id', sa.String(64)),
        sa.Column('task_id', sa.String(64), unique=True),
        sa.Column('admission', sa.JSON()),
        sa.Column('diagnostic', sa.JSON()),
    )
    op.create_index('ix_canvas_generation_approvals_next_scan_at', 'canvas_generation_approvals', ['next_scan_at'])


def downgrade() -> None:
    op.drop_table('canvas_generation_approvals')
