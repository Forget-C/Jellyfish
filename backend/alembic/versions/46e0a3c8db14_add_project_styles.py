"""Add project-scoped immutable style revisions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '46e0a3c8db14'
down_revision = '35d9f2b7ca03'
branch_labels = None
depends_on = None


def upgrade():
    """Create project style storage without changing existing design snapshots."""
    op.create_table('directing_project_styles',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('project_id', sa.String(64), sa.ForeignKey('projects.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('parent_id', sa.String(64), sa.ForeignKey('directing_project_styles.id', ondelete='RESTRICT')),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('confirmed_by', sa.String(64)),
        sa.Column('confirmed_at', sa.DateTime()),
        sa.Column('created_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('version > 0', name='ck_directing_style_version'),
        sa.CheckConstraint('(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)', name='ck_directing_style_confirmation'),
    )
    op.create_index('ix_directing_project_styles_project_id', 'directing_project_styles', ['project_id'])


def downgrade():
    """Remove style storage only after dependent project data has been handled."""
    op.drop_table('directing_project_styles')
