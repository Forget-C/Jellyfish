"""Freeze explicitly delivered scene content and its current chapter use."""
from alembic import op
import sqlalchemy as sa

revision = 'e1b5c9d3f402'
down_revision = 'd0a4b8c2e391'
branch_labels = None
depends_on = None


def upgrade():
    """No editable version is implicitly delivered by migration."""
    op.create_table('directing_scene_deliveries',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('version_title', sa.String(255), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('review_id', sa.String(64), sa.ForeignKey('directing_scene_cut_reviews.id', ondelete='RESTRICT')),
        sa.Column('review', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'request_id', name='uq_scene_delivery_request'))
    op.create_table('directing_scene_delivery_uses',
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('delivery_id', sa.String(64), sa.ForeignKey('directing_scene_deliveries.id', ondelete='RESTRICT'), nullable=False))


def downgrade():
    """Never erase delivery evidence as a schema rollback side effect."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_deliveries')).scalar():
        raise RuntimeError('Scene deliveries exist; preserve their data before downgrading')
    op.drop_table('directing_scene_delivery_uses')
    op.drop_table('directing_scene_deliveries')
