"""Persist independent generation canvas check reports."""

from alembic import op
import sqlalchemy as sa

revision = '4c68b18ae451'
down_revision = 'e48b7c6f159a'
branch_labels = None
depends_on = None


def upgrade():
    """Create report storage without changing existing canvas documents."""
    op.create_table(
        'generation_canvas_check_reports',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('canvas_id', sa.String(length=64), sa.ForeignKey('generation_canvases.id', ondelete='CASCADE'), nullable=False),
        sa.Column('check_card_id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('report', sa.JSON(), nullable=False),
    )
    op.create_index('ix_generation_canvas_check_reports_canvas_id', 'generation_canvas_check_reports', ['canvas_id'])


def downgrade():
    """Remove independent check history storage."""
    op.drop_table('generation_canvas_check_reports')
