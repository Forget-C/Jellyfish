"""Persist fixed batch manifests and per-item task acceptance."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '57f1b4d9ec25'
down_revision = '46e0a3c8db14'
branch_labels = None
depends_on = None


def upgrade():
    """Create batch identities without converting or deleting existing tasks."""
    op.create_table('directing_batches',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('version > 0', name='ck_directing_batch_version'),
        sa.CheckConstraint("status IN ('prepared','submitted')", name='ck_directing_batch_status'))
    op.create_index('ix_directing_batches_sequence_id', 'directing_batches', ['sequence_id'])
    op.create_table('directing_batch_items',
        sa.Column('batch_id', sa.String(64), sa.ForeignKey('directing_batches.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('ordinal', sa.Integer(), primary_key=True),
        sa.Column('prompt_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('review_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('task_id', sa.String(64), sa.ForeignKey('tasks.id', ondelete='RESTRICT'), unique=True),
        sa.Column('error', sa.Text()),
        sa.CheckConstraint('ordinal >= 0', name='ck_directing_batch_item_ordinal'),
        sa.UniqueConstraint('batch_id', 'prompt_revision_id', name='uq_directing_batch_prompt'))


def downgrade():
    """Remove only the new batch records, leaving task and media history intact."""
    op.drop_table('directing_batch_items')
    op.drop_table('directing_batches')
