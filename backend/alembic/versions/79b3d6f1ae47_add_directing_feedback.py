"""Add typed review/repair/knowledge revisions and immutable chapter transitions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '79b3d6f1ae47'
down_revision = '68a2c5e0fd36'
branch_labels = None
depends_on = None


def change_kinds(values):
    """Replace the fixed kind check without relying on runtime ORM definitions."""
    with op.batch_alter_table('directing_revisions') as batch:
        batch.drop_constraint('ck_directing_revision_kind', type_='check')
        batch.create_check_constraint('ck_directing_revision_kind', 'kind IN (' + values + ')')


def upgrade():
    """Keep existing revisions intact while adding feedback and cross-scene evidence."""
    change_kinds("'design','plan','prompt','review','cut','cut_review','repair','knowledge'")
    if op.get_bind().dialect.name == 'mysql':
        op.alter_column('directing_revisions', 'confirmed_at', existing_type=sa.DateTime(), type_=DATETIME(fsp=6), existing_nullable=True)
    op.create_table('directing_chapter_transitions',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('chapter_id', sa.String(64), sa.ForeignKey('chapters.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('left_sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('right_sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('left_cut_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('right_cut_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('left_frame_id', sa.String(64), sa.ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('right_frame_id', sa.String(64), sa.ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('actor_id', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False))
    op.create_index('ix_directing_chapter_transitions_chapter_id', 'directing_chapter_transitions', ['chapter_id'])
    op.create_table('directing_repair_plans',
        sa.Column('repair_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('plan_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), primary_key=True, unique=True))


def downgrade():
    """Refuse to discard completed reviews or learning records during rollback."""
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT COUNT(*) FROM directing_revisions WHERE kind IN ('cut_review','repair','knowledge')")) or connection.scalar(sa.text('SELECT COUNT(*) FROM directing_chapter_transitions')):
        raise RuntimeError('Cannot downgrade while directing feedback records exist')
    if connection.dialect.name == 'mysql':
        op.alter_column('directing_revisions', 'confirmed_at', existing_type=DATETIME(fsp=6), type_=sa.DateTime(), existing_nullable=True)
    op.drop_table('directing_repair_plans')
    op.drop_table('directing_chapter_transitions')
    change_kinds("'design','plan','prompt','review','cut'")
