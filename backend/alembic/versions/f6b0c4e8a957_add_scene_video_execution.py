"""Preserve scene video executions and their independent candidate outputs."""
from alembic import op
import sqlalchemy as sa

revision = 'f6b0c4e8a957'
down_revision = 'e5a9b3d7f846'
branch_labels = None
depends_on = None


def upgrade():
    """New execution history starts empty; no legacy prompt or take is reassigned."""
    op.create_table('directing_scene_video_executions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('unit_id', sa.String(64), nullable=False),
        sa.Column('request_id', sa.String(64), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('preparation', sa.JSON(), nullable=False),
        sa.Column('task_id', sa.String(64), sa.ForeignKey('tasks.id', ondelete='RESTRICT'), unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('version_id', 'unit_id', 'request_id', name='uq_scene_video_request'))
    op.create_table('directing_scene_takes',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('execution_id', sa.String(64), sa.ForeignKey('directing_scene_video_executions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('task_id', sa.String(64), nullable=False),
        sa.Column('output_ordinal', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(64), sa.ForeignKey('files.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('annotation', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['task_id', 'output_ordinal'], ['task_outputs.task_id', 'task_outputs.ordinal'], ondelete='RESTRICT'),
        sa.UniqueConstraint('task_id', 'output_ordinal', name='uq_scene_take_output'))


def downgrade():
    """Refuse to discard populated execution or candidate history."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_video_executions')).scalar():
        raise RuntimeError('Scene video executions exist; preserve their data before downgrading')
    op.drop_table('directing_scene_takes')
    op.drop_table('directing_scene_video_executions')
