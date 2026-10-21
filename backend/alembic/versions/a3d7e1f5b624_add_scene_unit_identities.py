"""Reserve saved and historical scene unit identities across removals."""
from alembic import op
import sqlalchemy as sa

revision = 'a3d7e1f5b624'
down_revision = 'f2c6d0e4a513'
branch_labels = None
depends_on = None


def upgrade():
    """Backfill current units and fixed inputs, never unapplied AI results."""
    table = op.create_table('directing_scene_unit_identities',
        sa.Column('version_id', sa.String(64), sa.ForeignKey('directing_scene_versions.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('unit_id', sa.String(64), primary_key=True))
    bind = op.get_bind()
    versions = sa.table('directing_scene_versions', sa.column('id'), sa.column('content', sa.JSON()))
    identities = {row.id: {unit['id'] for unit in row.content.get('units', [])}
                  for row in bind.execute(sa.select(versions.c.id, versions.c.content))}
    tasks = sa.table('tasks', sa.column('input_snapshot', sa.JSON()))
    for snapshot in bind.execute(sa.select(tasks.c.input_snapshot)).scalars():
        for context in snapshot.values():
            if not isinstance(context, dict) or context.get('version_id') not in identities:
                continue
            units = identities[context['version_id']]
            if context.get('unit_id'):
                units.add(context['unit_id'])
            units.update(unit['id'] for unit in context.get('request', {}).get('content', {}).get('units', []))
    for name in ('directing_instruction_bases', 'directing_scene_video_executions'):
        history = sa.table(name, sa.column('version_id'), sa.column('unit_id'))
        for version_id, unit_id in bind.execute(sa.select(history.c.version_id, history.c.unit_id)):
            if version_id in identities:
                identities[version_id].add(unit_id)
    rows = [{'version_id': version_id, 'unit_id': unit_id}
            for version_id, units in identities.items() for unit_id in sorted(units)]
    if rows:
        op.bulk_insert(table, rows)


def downgrade():
    """Do not silently release historical identities on downgrade."""
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM directing_scene_unit_identities')).scalar():
        raise RuntimeError('Scene unit identities exist; preserve their data before downgrading')
    op.drop_table('directing_scene_unit_identities')
