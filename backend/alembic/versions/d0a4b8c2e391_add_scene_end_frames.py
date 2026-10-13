"""Preserve extracted actual end frames independently of later timeline edits."""
from alembic import op
import sqlalchemy as sa

revision = 'd0a4b8c2e391'
down_revision = 'c9f3a7b1d280'
branch_labels = None
depends_on = None


def upgrade():
    """Create an empty ledger without inferring any dependency binding."""
    op.create_table('directing_scene_end_frames',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('request', sa.JSON(), nullable=False),
        sa.Column('clip', sa.JSON(), nullable=False),
        sa.Column('file_id', sa.String(64), nullable=False),
        sa.Column('at_ms', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'request_id', name='uq_scene_end_frame_request'))


def downgrade():
    """Existing reference evidence must be preserved before a downgrade."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_end_frames')).scalar():
        raise RuntimeError('Scene end frames exist; preserve their data before downgrading')
    op.drop_table('directing_scene_end_frames')
