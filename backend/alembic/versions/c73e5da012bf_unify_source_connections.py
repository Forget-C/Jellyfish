"""Normalize source connections while retaining current selections and historical evidence."""
import json

from alembic import op
import sqlalchemy as sa

revision = 'c73e5da012bf'
down_revision = 'b62f4c901dea'
branch_labels = None
depends_on = None


def upgrade():
    """Record pre-migration documents before changing live revisions."""
    from app.services.generation_canvas.connection_cleanup import clean_connection_document
    backup = op.create_table('generation_canvas_source_connection_backup',
                             sa.Column('canvas_id', sa.String(64), primary_key=True),
                             sa.Column('document', sa.JSON(), nullable=False),
                             sa.Column('revision', sa.Integer(), nullable=False))
    connection = op.get_bind()
    table = sa.table('generation_canvases', sa.column('id', sa.String), sa.column('document', sa.JSON), sa.column('revision', sa.Integer))
    usages = sa.table('file_usages', sa.column('file_id', sa.String), sa.column('project_id', sa.String),
                      sa.column('usage_kind', sa.String), sa.column('source_ref', sa.String))
    for row in connection.execute(sa.select(table)).mappings():
        original = json.loads(row['document']) if isinstance(row['document'], str) else row['document']
        document = clean_connection_document(original)
        if document == original:
            continue
        connection.execute(backup.insert().values(canvas_id=row['id'], document=original, revision=row['revision']))
        connection.execute(table.update().where(table.c.id == row['id']).values(document=document, revision=row['revision'] + 1))
        original_cards = {card['id']: card for card in original['cards']}
        for card in document['cards']:
            old = original_cards[card['id']]
            kept_examples = {(item['id'], item['file_id']) for item in card.get('examples', [])}
            for example in old.get('examples', []):
                if (example['id'], example['file_id']) not in kept_examples:
                    connection.execute(usages.delete().where(
                        usages.c.project_id == original['project_id'], usages.c.usage_kind == 'canvas_content',
                        usages.c.source_ref == f"{row['id']}:{card['id']}:{example['id']}", usages.c.file_id == example['file_id']))
            kept_bindings = {binding['id'] for binding in card.get('input_bindings', [])}
            dropped = {binding['input_port'] for binding in old.get('input_bindings', []) if binding['id'] not in kept_bindings}
            if dropped:
                print(f"Source connections: {row['id']}/{card['id']} normalized invalid, duplicate or conflicting uses {', '.join(sorted(dropped))}; review remaining selections")
        print(f"Source connections: {row['id']} backed up; edges {len(original.get('edges', []))} → {len(document['edges'])}")


def downgrade():
    """Restoration requires checking edits made after migration."""
    raise RuntimeError('Review and restore generation_canvas_source_connection_backup explicitly')
