"""Preserve the actual basis of each saved scene Take review."""
from alembic import op
import sqlalchemy as sa

revision = 'a7d1e5f9b068'
down_revision = 'f6b0c4e8a957'
branch_labels = None
depends_on = None


def upgrade():
    """Start an empty review ledger without inventing historical review evidence."""
    op.create_table('directing_scene_take_reviews',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('take_kind', sa.String(32), nullable=False),
        sa.Column('take_id', sa.String(64), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'revision', 'take_kind', 'take_id', name='uq_scene_take_review_revision'))


def downgrade():
    """Refuse to erase existing human review evidence."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_take_reviews')).scalar():
        raise RuntimeError('Scene take reviews exist; preserve their data before downgrading')
    op.drop_table('directing_scene_take_reviews')
