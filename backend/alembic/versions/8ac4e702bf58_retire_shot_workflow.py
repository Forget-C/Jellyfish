"""Remove the replaced shot workflow while preserving projects, assets and media."""
from alembic import op
import sqlalchemy as sa

revision = '8ac4e702bf58'
down_revision = '79b3d6f1ae47'
branch_labels = None
depends_on = None

OLD_TABLES = (
    'shot_extracted_dialogue_candidates', 'shot_extracted_candidates',
    'shot_character_links', 'shot_dialog_lines', 'shot_frame_images',
    'shot_details', 'shots', 'timeline_clips',
)
LINKS = {f'project_{kind}_links': kind for kind in ('actor', 'scene', 'prop', 'costume')}


def remove_shot_column(table):
    """Remove named constraints with the retired column, retaining other provenance."""
    inspector = sa.inspect(op.get_bind())
    unique_names = {item['name'] for item in inspector.get_unique_constraints(table)}
    with op.batch_alter_table(table, naming_convention={'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s'}) as batch:
        for key in inspector.get_foreign_keys(table):
            if 'shot_id' in key['constrained_columns']:
                batch.drop_constraint(key['name'] or f'fk_{table}_shot_id_shots', type_='foreignkey')
        for index in inspector.get_indexes(table):
            if 'shot_id' in index['column_names'] and index['name'] not in unique_names:
                batch.drop_index(index['name'])
        for constraint in inspector.get_unique_constraints(table):
            if 'shot_id' in constraint['column_names']:
                batch.drop_constraint(constraint['name'], type_='unique')
        batch.drop_column('shot_id')


def upgrade():
    """Retire only old production data; new directing versions and file bytes remain intact."""
    connection = op.get_bind()
    active = connection.scalar(sa.text("""SELECT count(*) FROM tasks WHERE status IN ('queued','running')
        AND (kind IN ('script_divide','script_extract','script_merge','script_variant')
             OR target_type IN ('shot_video','shot_frame_slot','shot_detail'))"""))
    if active:
        raise RuntimeError('Finish or cancel active retired shot tasks before migration')
    # A legacy usage may have carried only a shot; preserve its chapter before dropping that ID.
    connection.execute(sa.text('''UPDATE file_usages SET chapter_id =
        (SELECT chapter_id FROM shots WHERE shots.id = file_usages.shot_id)
        WHERE chapter_id IS NULL AND shot_id IS NOT NULL'''))
    remove_shot_column('file_usages')
    for table, kind in LINKS.items():
        remove_shot_column(table)
        # Multiple old shots can reference the same asset in one chapter. Preserve one association.
        rows = connection.execute(sa.text(f'SELECT id, {kind}_id, project_id, chapter_id FROM {table} ORDER BY id')).all()
        seen = set()
        for identity, asset, project, chapter in rows:
            key = (asset, project, chapter)
            if key in seen:
                connection.execute(sa.text(f'DELETE FROM {table} WHERE id = :id'), {'id': identity})
            seen.add(key)
        with op.batch_alter_table(table) as batch:
            batch.create_unique_constraint(f'uq_{table}_{kind}_scope', [f'{kind}_id', 'project_id', 'chapter_id'])
    for table in OLD_TABLES:
        op.drop_table(table)
    with op.batch_alter_table('chapters') as batch:
        batch.drop_column('storyboard_count')


def downgrade():
    """Deleted legacy production data cannot be reconstructed; restore a pre-upgrade backup."""
    raise RuntimeError('Retired shot data cannot be restored by downgrade; restore the pre-upgrade backup')
