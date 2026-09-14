"""Add scene design, production, Take and cut foundations without converting old data."""

from alembic import op
import sqlalchemy as sa

revision = "24c8e1a6b902"
down_revision = "13b6a9d2e401"
branch_labels = None
depends_on = None

def upgrade() -> None:
    """Create typed document storage and relational identity/reference constraints."""
    op.create_table('directing_sequences',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('chapter_id', sa.String(length=64), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('source', sa.JSON(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint('position >= 0 AND version > 0', name='ck_directing_sequence_numbers'),
    sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('chapter_id', 'position', name='uq_directing_sequence_position')
    )
    op.create_index(op.f('ix_directing_sequences_chapter_id'), 'directing_sequences', ['chapter_id'], unique=False)
    op.create_table('directing_revisions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('sequence_id', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('parent_id', sa.String(length=64), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('confirmed_by', sa.String(length=64), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint("kind IN ('design','plan','prompt','review','cut')", name='ck_directing_revision_kind'),
    sa.CheckConstraint('(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)', name='ck_directing_revision_confirmation'),
    sa.CheckConstraint('version > 0', name='ck_directing_revision_version'),
    sa.ForeignKeyConstraint(['parent_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_directing_revisions_sequence_id'), 'directing_revisions', ['sequence_id'], unique=False)
    op.create_table('directing_revision_dependencies',
    sa.Column('revision_id', sa.String(length=64), nullable=False),
    sa.Column('dependency_id', sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(['dependency_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('revision_id', 'dependency_id')
    )
    op.create_table('directing_takes',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('sequence_id', sa.String(length=64), nullable=False),
    sa.Column('prompt_revision_id', sa.String(length=64), nullable=False),
    sa.Column('plan_revision_id', sa.String(length=64), nullable=False),
    sa.Column('unit_id', sa.String(length=64), nullable=False),
    sa.Column('task_id', sa.String(length=64), nullable=False),
    sa.Column('output_ordinal', sa.Integer(), nullable=False),
    sa.Column('file_id', sa.String(length=64), nullable=False),
    sa.Column('annotation', sa.JSON(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint('version > 0 AND output_ordinal >= 0', name='ck_directing_take_numbers'),
    sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['plan_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['prompt_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['task_id', 'output_ordinal'], ['task_outputs.task_id', 'task_outputs.ordinal'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('task_id', 'output_ordinal', name='uq_directing_take_output')
    )
    op.create_index(op.f('ix_directing_takes_sequence_id'), 'directing_takes', ['sequence_id'], unique=False)
    op.create_table('directing_cut_take_references',
    sa.Column('revision_id', sa.String(length=64), nullable=False),
    sa.Column('take_id', sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['take_id'], ['directing_takes.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('revision_id', 'take_id')
    )

def downgrade() -> None:
    """Remove only the new foundation tables; callers must back up their new content."""
    op.drop_table('directing_cut_take_references')
    op.drop_index(op.f('ix_directing_takes_sequence_id'), table_name='directing_takes')
    op.drop_table('directing_takes')
    op.drop_table('directing_revision_dependencies')
    op.drop_index(op.f('ix_directing_revisions_sequence_id'), table_name='directing_revisions')
    op.drop_table('directing_revisions')
    op.drop_index(op.f('ix_directing_sequences_chapter_id'), table_name='directing_sequences')
    op.drop_table('directing_sequences')
