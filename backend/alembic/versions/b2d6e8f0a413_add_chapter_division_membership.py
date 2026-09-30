"""Keep historical sequence identities outside the current chapter order."""

from alembic import op
import sqlalchemy as sa

revision = 'b2d6e8f0a413'
down_revision = 'a1c4e7b9d205'
branch_labels = None
depends_on = None


def upgrade():
    """Existing sequences remain current; foreign keys and production records stay intact."""
    with op.batch_alter_table('directing_sequences') as batch:
        batch.add_column(sa.Column('is_current', sa.Boolean(), server_default=sa.text('1'), nullable=False))
        batch.add_column(sa.Column('current_position', sa.Integer(),
            sa.Computed('CASE WHEN is_current THEN position ELSE NULL END', persisted=True), nullable=True))
        batch.create_unique_constraint('uq_directing_sequence_current_position', ['chapter_id', 'current_position'])
        batch.drop_constraint('uq_directing_sequence_position', type_='unique')
    op.create_table('directing_division_commits',
        sa.Column('chapter_id', sa.String(64), sa.ForeignKey('chapters.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('request_id', sa.String(64), primary_key=True),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade():
    """Refuse destructive rollback after any identity exits; never reactivate or renumber history."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_sequences WHERE is_current = 0')).scalar():
        raise RuntimeError('Historical sequences exist; restore a pre-division backup before downgrading')
    with op.batch_alter_table('directing_sequences') as batch:
        batch.create_unique_constraint('uq_directing_sequence_position', ['chapter_id', 'position'])
        batch.drop_constraint('uq_directing_sequence_current_position', type_='unique')
        batch.drop_column('current_position')
        batch.drop_column('is_current')
    op.drop_table('directing_division_commits')
