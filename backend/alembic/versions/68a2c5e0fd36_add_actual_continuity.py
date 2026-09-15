"""Record adopted-cut evidence and versioned continuity dependencies."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '68a2c5e0fd36'
down_revision = '57f1b4d9ec25'
branch_labels = None
depends_on = None


def upgrade():
    """Create immutable evidence and preserve unresolved old dependencies as versioned identities."""
    op.create_table('directing_active_cuts',
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False))
    op.create_table('directing_cut_frames',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('cut_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('item_id', sa.String(64), nullable=False),
        sa.Column('take_id', sa.String(64), sa.ForeignKey('directing_takes.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('file_id', sa.String(64), sa.ForeignKey('files.id', ondelete='RESTRICT'), nullable=False, unique=True),
        sa.Column('source_in_ms', sa.Integer(), nullable=False),
        sa.Column('source_out_ms', sa.Integer(), nullable=False),
        sa.Column('at_ms', sa.Integer(), nullable=False),
        sa.Column('edge', sa.String(8), nullable=False),
        sa.CheckConstraint("edge IN ('start','end')", name='ck_directing_frame_edge'),
        sa.CheckConstraint('source_in_ms >= 0 AND source_out_ms > source_in_ms AND at_ms >= source_in_ms AND at_ms < source_out_ms', name='ck_directing_frame_range'))
    op.create_index('ix_directing_cut_frames_sequence_id', 'directing_cut_frames', ['sequence_id'])
    op.create_table('directing_seam_reviews',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('sequence_id', sa.String(64), sa.ForeignKey('directing_sequences.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('cut_revision_id', sa.String(64), sa.ForeignKey('directing_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('left_frame_id', sa.String(64), sa.ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('right_frame_id', sa.String(64), sa.ForeignKey('directing_cut_frames.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('verdict', sa.String(8), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=False),
        sa.Column('actor_id', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.CheckConstraint("verdict IN ('pass','revise')", name='ck_directing_seam_verdict'))
    op.create_index('ix_directing_seam_reviews_sequence_id', 'directing_seam_reviews', ['sequence_id'])
    connection = op.get_bind()
    revisions = sa.table('directing_revisions', sa.column('id', sa.String), sa.column('sequence_id', sa.String),
        sa.column('kind', sa.String), sa.column('payload', sa.JSON), sa.column('confirmed_at', sa.DateTime), sa.column('created_at', sa.DateTime))
    # Older confirmed cuts have no explicit active pointer; initialize deterministically once.
    active = {}
    for row in connection.execute(sa.select(revisions).where(revisions.c.kind == 'cut', revisions.c.confirmed_at.is_not(None))
                                  .order_by(revisions.c.confirmed_at, revisions.c.created_at, revisions.c.id)).mappings():
        active[row['sequence_id']] = row['id']
    table = sa.table('directing_active_cuts', sa.column('sequence_id', sa.String), sa.column('revision_id', sa.String))
    for sequence_id, revision_id in active.items():
        connection.execute(table.insert().values(sequence_id=sequence_id, revision_id=revision_id))
    for row in connection.execute(sa.select(revisions).where(revisions.c.kind == 'plan')).mappings():
        payload = row['payload']
        for unit in payload['units']:
            unit['dependencies'] = [{'plan_revision_id': row['id'], 'unit_id': identity, 'frame_id': None, 'reference_id': None}
                                    for identity in unit.pop('depends_on_unit_ids', [])]
        connection.execute(revisions.update().where(revisions.c.id == row['id']).values(payload=payload))


def downgrade():
    """Refuse lossy downgrade once cross-version evidence is used; empty foundation can roll back."""
    connection = op.get_bind()
    revisions = sa.table('directing_revisions', sa.column('id', sa.String), sa.column('kind', sa.String), sa.column('payload', sa.JSON))
    plans = list(connection.execute(sa.select(revisions).where(revisions.c.kind == 'plan')).mappings())
    if any(link.get('frame_id') or link['plan_revision_id'] != row['id']
           for row in plans for unit in row['payload']['units'] for link in unit.get('dependencies', [])):
        raise RuntimeError('Cannot downgrade versioned continuity dependencies without losing evidence')
    for row in plans:
        payload = row['payload']
        for unit in payload['units']:
            unit['depends_on_unit_ids'] = [link['unit_id'] for link in unit.pop('dependencies', [])]
        connection.execute(revisions.update().where(revisions.c.id == row['id']).values(payload=payload))
    op.drop_table('directing_seam_reviews')
    op.drop_table('directing_cut_frames')
    op.drop_table('directing_active_cuts')
