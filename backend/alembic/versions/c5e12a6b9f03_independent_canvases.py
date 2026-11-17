"""Separate independent canvas ownership from project/scene ownership."""
from alembic import op
import sqlalchemy as sa

revision = 'c5e12a6b9f03'
down_revision = 'b4d91ea7c203'
branch_labels = None
depends_on = None


def upgrade():
    """Classify existing records explicitly; retirement is a separate maintenance action."""
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    checks = []
    if {'generation_canvas_occupancies', 'generation_canvases'} <= tables:
        checks.append("SELECT COUNT(*) FROM generation_canvas_occupancies o JOIN generation_canvases c ON c.id=o.canvas_id WHERE c.sequence_id IS NULL AND c.project_id IS NOT NULL")
    if {'tasks', 'generation_canvas_run_nodes', 'generation_canvases'} <= tables:
        checks.append("SELECT COUNT(*) FROM tasks t JOIN generation_canvas_run_nodes n ON n.task_id=t.id OR (t.target_type='canvas_node' AND t.target_id=n.id) JOIN generation_canvases c ON c.id=n.canvas_id WHERE c.sequence_id IS NULL AND c.project_id IS NOT NULL AND t.status NOT IN ('succeeded','failed','cancelled')")
    if {'tasks', 'generation_canvas_check_reports', 'generation_canvases'} <= tables:
        checks.append("SELECT COUNT(*) FROM tasks t JOIN generation_canvas_check_reports r ON t.target_type='canvas_check_report' AND t.target_id=r.id JOIN generation_canvases c ON c.id=r.canvas_id WHERE c.sequence_id IS NULL AND c.project_id IS NOT NULL AND t.status NOT IN ('succeeded','failed','cancelled')")
    if {'tasks', 'generation_canvas_result_sets', 'generation_canvases'} <= tables:
        checks.append("SELECT COUNT(*) FROM tasks t JOIN generation_canvas_result_sets r ON t.target_type='canvas_result_set' AND t.target_id=r.id JOIN generation_canvases c ON c.id=r.canvas_id WHERE c.sequence_id IS NULL AND c.project_id IS NOT NULL AND t.status NOT IN ('succeeded','failed','cancelled')")
    if any(bind.scalar(sa.text(query)) for query in checks):
        raise RuntimeError('Old free canvases have active tasks; finish them before upgrading')
    op.add_column('generation_canvases', sa.Column('kind', sa.String(16), nullable=False, server_default='free'))
    op.execute("UPDATE generation_canvases SET kind = 'scene' WHERE sequence_id IS NOT NULL")
    with op.batch_alter_table('generation_canvases') as batch:
        batch.alter_column('project_id', existing_type=sa.String(64), nullable=True)
    with op.batch_alter_table('file_usages') as batch:
        batch.alter_column('project_id', existing_type=sa.String(64), nullable=True)


def downgrade():
    """Independent records cannot be assigned a project without inventing ownership."""
    raise RuntimeError('Independent canvas ownership requires restoring a pre-upgrade backup')
