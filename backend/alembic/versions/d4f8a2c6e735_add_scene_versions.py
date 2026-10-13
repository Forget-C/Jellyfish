"""Add editable scene versions without migrating or rewriting existing history."""

from alembic import op
import sqlalchemy as sa

revision = 'd4f8a2c6e735'
down_revision = 'c3e7f9a1b524'
branch_labels = None
depends_on = None


def upgrade():
    """Only explicit creation fills this table; old revision selection is not inferred."""
    op.create_table('directing_scene_versions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('source_bases', sa.JSON(), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('create_request_id', sa.String(64), nullable=False),
        sa.Column('last_save_request_id', sa.String(64)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('sequence_id', 'create_request_id', name='uq_scene_version_create_request'),
        sa.CheckConstraint('revision > 0', name='ck_scene_version_revision'))
    op.create_index('ix_directing_scene_versions_sequence_id', 'directing_scene_versions', ['sequence_id'])


def downgrade():
    """Do not discard explicit user-created schemes when rolling back the schema."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_versions')).scalar():
        raise RuntimeError('Scene versions exist; preserve their data before downgrading')
    op.drop_index('ix_directing_scene_versions_sequence_id', table_name='directing_scene_versions')
    op.drop_table('directing_scene_versions')
