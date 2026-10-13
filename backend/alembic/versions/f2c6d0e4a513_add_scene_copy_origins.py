"""Record explicit whole-version copy provenance without duplicating tasks."""
from alembic import op
import sqlalchemy as sa

revision = 'f2c6d0e4a513'
down_revision = 'e1b5c9d3f402'
branch_labels = None
depends_on = None


def upgrade():
    """Existing versions have no inferred copy relationship."""
    op.create_table('directing_scene_copy_origins',
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('source_version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('request', sa.JSON(), nullable=False),
        sa.Column('review_ids', sa.JSON(), nullable=False, server_default='{}'))


def downgrade():
    """Preserve provenance needed by inherited execution evidence."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_copy_origins')).scalar():
        raise RuntimeError('Scene copy origins exist; preserve their data before downgrading')
    op.drop_table('directing_scene_copy_origins')
