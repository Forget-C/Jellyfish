"""Persist immutable chapter division versions and their current pointer."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = 'c3e7f9a1b524'
down_revision = 'b2d6e8f0a413'
branch_labels = None
depends_on = None


def upgrade():
    """Keep existing tasks, receipts and production identities; data import is explicit."""
    op.create_table('directing_division_versions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('chapter_id', sa.String(64), sa.ForeignKey('chapters.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column('origin', sa.String(16), nullable=False),
        sa.Column('source_version', sa.String(64), nullable=False),
        sa.Column('sequence_count', sa.Integer(), nullable=False),
        sa.Column('source_task_id', sa.String(64), sa.ForeignKey('tasks.id', ondelete='RESTRICT')),
        sa.Column('source_revision_id', sa.String(64), sa.ForeignKey('directing_division_versions.id', ondelete='RESTRICT')),
        sa.Column('base_revision_id', sa.String(64), sa.ForeignKey('directing_division_versions.id', ondelete='RESTRICT')),
        sa.Column('request_id', sa.String(64)),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('mapping', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(DATETIME(fsp=6), 'mysql'), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('chapter_id', 'number', name='uq_division_version_number'),
        sa.UniqueConstraint('chapter_id', 'id', name='uq_division_version_chapter_identity'),
        sa.UniqueConstraint('chapter_id', 'request_id', name='uq_division_version_request'),
        sa.CheckConstraint('number > 0 AND sequence_count >= 0', name='ck_division_version_numbers'),
        sa.CheckConstraint("origin IN ('manual','ai','restore','imported','baseline')", name='ck_division_version_origin'))
    op.create_table('directing_division_heads',
        sa.Column('chapter_id', sa.String(64), sa.ForeignKey('chapters.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('revision_id', sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id', 'revision_id'],
            ['directing_division_versions.chapter_id', 'directing_division_versions.id'],
            name='fk_division_head_version', ondelete='RESTRICT'))


def downgrade():
    """Refuse to discard saved history or enable older unversioned writers over it."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_division_versions')).scalar():
        raise RuntimeError('Division versions exist; restore a pre-version backup before downgrading')
    op.drop_table('directing_division_heads')
    op.drop_table('directing_division_versions')
