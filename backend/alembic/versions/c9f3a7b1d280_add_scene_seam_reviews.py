"""Preserve scene seam review decisions and the actual reviewed content."""
from alembic import op
import sqlalchemy as sa

revision = 'c9f3a7b1d280'
down_revision = 'b8e2f6a0c179'
branch_labels = None
depends_on = None


def upgrade():
    """Create an empty ledger; never infer historical acceptance."""
    op.create_table('directing_scene_seam_reviews',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('review', sa.JSON(), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'request_id', name='uq_scene_seam_review_request'))


def downgrade():
    """Refuse to erase existing acceptance evidence."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_seam_reviews')).scalar():
        raise RuntimeError('Scene seam reviews exist; preserve their data before downgrading')
    op.drop_table('directing_scene_seam_reviews')
