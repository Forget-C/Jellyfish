"""Persist independent project canvas documents and atomic save receipts."""
from alembic import op
import sqlalchemy as sa

revision = 'd6a0b4c8e957'
down_revision = 'c5f9a3b7d846'
branch_labels = None
depends_on = None


def upgrade():
    """Create editable documents separately from runtime and local layout."""
    op.create_table('generation_canvases',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('project_id', sa.String(64), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('document', sa.JSON(), nullable=False),
        sa.Column('card_types', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_generation_canvases_project_id', 'generation_canvases', ['project_id'])
    op.create_table('generation_canvas_save_receipts',
        sa.Column('canvas_id', sa.String(64), sa.ForeignKey('generation_canvases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False))


def downgrade():
    """Remove only generation canvas storage."""
    op.drop_table('generation_canvas_save_receipts')
    op.drop_table('generation_canvases')
