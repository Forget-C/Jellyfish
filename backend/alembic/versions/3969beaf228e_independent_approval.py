"""Create the independent versioned approval ledger."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '3969beaf228e'
down_revision = '8b7cdef41210'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'approval_subjects',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('scope_key', sa.String(64), nullable=False),
        sa.Column('scope_kind', sa.String(64), nullable=False),
        sa.Column('scope_id', sa.String(128), nullable=False),
        sa.Column('object_type', sa.String(64), nullable=False),
        sa.Column('object_id', sa.String(128), nullable=False),
        sa.Column('active_request_id', sa.String(64)),
    )
    op.create_index('ix_approval_subjects_scope_key', 'approval_subjects', ['scope_key'])
    op.create_table(
        'approval_requests',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('subject_id', sa.String(64), sa.ForeignKey('approval_subjects.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('version', sa.String(128), nullable=False),
        sa.Column('submission_key', sa.String(64), nullable=False, unique=True),
        sa.Column('submission_hash', sa.String(64), nullable=False),
        sa.Column('applicant_id', sa.String(128), nullable=False),
        sa.Column('snapshot_ref', sa.String(255), nullable=False),
        sa.Column('group_ids', sa.JSON(), nullable=False),
        sa.Column('group_states', sa.JSON(), nullable=False),
        sa.Column('supersedes_request_id', sa.String(64)),
    )
    op.create_index('ix_approval_requests_subject_id', 'approval_requests', ['subject_id'])
    op.create_table(
        'approval_decisions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('request_id', sa.String(64), sa.ForeignKey('approval_requests.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('intent_hash', sa.String(64), nullable=False),
        sa.Column('actor_id', sa.String(128), nullable=False),
        sa.Column('action', sa.String(8), nullable=False),
        sa.Column('source', sa.String(12), nullable=False),
        sa.Column('group_ids', sa.JSON(), nullable=False),
        sa.Column('decided_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False),
    )
    op.create_index('ix_approval_decisions_request_id', 'approval_decisions', ['request_id'])


def downgrade() -> None:
    op.drop_table('approval_decisions')
    op.drop_table('approval_requests')
    op.drop_table('approval_subjects')
