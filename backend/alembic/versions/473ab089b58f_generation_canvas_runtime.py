"""Persist canvas runtime and backfill the event mutex for existing documents."""
from alembic import op
import sqlalchemy as sa

revision = '473ab089b58f'
down_revision = 'd6a0b4c8e957'
branch_labels = None
depends_on = None


def upgrade():
    """Create runtime tables without changing editable canvas revisions."""
    op.create_table('generation_canvas_event_heads',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('cursor', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id'))
    op.create_table('generation_canvas_events',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('cursor', sa.Integer(), nullable=False),
        sa.Column('envelope', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'cursor'))
    op.create_table('generation_canvas_previews',
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('token'))
    op.create_index(op.f('ix_generation_canvas_previews_canvas_id'), 'generation_canvas_previews', ['canvas_id'], unique=False)
    op.create_table('generation_canvas_run_receipts',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('request_id', sa.String(length=64), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'request_id'))
    op.create_table('generation_canvas_runs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('lifecycle', sa.String(length=16), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('scope', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_generation_canvas_runs_canvas_id'), 'generation_canvas_runs', ['canvas_id'], unique=False)
    op.create_table('generation_canvas_run_nodes',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('run_id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('stage', sa.String(length=64), nullable=False),
        sa.Column('progress', sa.Integer(), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('basis', sa.JSON(), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('outputs', sa.JSON(), nullable=False),
        sa.Column('result_set_id', sa.String(length=64), nullable=True),
        sa.Column('current_output_updated', sa.Boolean(), nullable=False),
        sa.Column('error_code', sa.String(length=64), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['run_id'], ['generation_canvas_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_generation_canvas_run_nodes_canvas_id'), 'generation_canvas_run_nodes', ['canvas_id'], unique=False)
    op.create_index(op.f('ix_generation_canvas_run_nodes_run_id'), 'generation_canvas_run_nodes', ['run_id'], unique=False)
    op.create_table('generation_canvas_occupancies',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('node_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['generation_canvas_run_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'card_id'))
    op.create_table('generation_canvas_result_sets',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('node_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('basis', sa.JSON(), nullable=False),
        sa.Column('outputs', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['generation_canvas_run_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_generation_canvas_result_sets_canvas_id'), 'generation_canvas_result_sets', ['canvas_id'], unique=False)
    op.create_table('generation_canvas_current_outputs',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('result_set_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['result_set_id'], ['generation_canvas_result_sets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'card_id'))
    op.execute("INSERT INTO generation_canvas_event_heads (canvas_id, `cursor`) SELECT id, 0 FROM generation_canvases")

def downgrade():
    """Remove only canvas runtime tables."""
    op.drop_table('generation_canvas_current_outputs')
    op.drop_table('generation_canvas_result_sets')
    op.drop_table('generation_canvas_occupancies')
    op.drop_table('generation_canvas_run_nodes')
    op.drop_table('generation_canvas_runs')
    op.drop_table('generation_canvas_run_receipts')
    op.drop_table('generation_canvas_previews')
    op.drop_table('generation_canvas_events')
    op.drop_table('generation_canvas_event_heads')
