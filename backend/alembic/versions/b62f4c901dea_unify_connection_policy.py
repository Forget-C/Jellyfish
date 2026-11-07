"""Normalize current connection selections without rewriting execution evidence."""
import json
from alembic import op
import sqlalchemy as sa

revision = 'b62f4c901dea'
down_revision = 'a71e92b603cf'
branch_labels = None
depends_on = None


def upgrade():
    """Back up each changed canvas; save receipts and historical runs stay immutable."""
    from app.services.generation_canvas.connection_cleanup import clean_connection_document
    op.create_table('generation_canvas_connection_backup',
                    sa.Column('canvas_id', sa.String(64), primary_key=True),
                    sa.Column('document', sa.JSON(), nullable=False),
                    sa.Column('revision', sa.Integer(), nullable=False))
    connection = op.get_bind()
    table = sa.table('generation_canvases', sa.column('id', sa.String), sa.column('document', sa.JSON), sa.column('revision', sa.Integer))
    backup = sa.table('generation_canvas_connection_backup', sa.column('canvas_id', sa.String), sa.column('document', sa.JSON), sa.column('revision', sa.Integer))
    changed = removed = added = cleared = 0
    for row in connection.execute(sa.select(table.c.id, table.c.document, table.c.revision)).mappings():
        original = json.loads(row['document']) if isinstance(row['document'], str) else row['document']
        document = clean_connection_document(original)
        if document != original:
            connection.execute(backup.insert().values(canvas_id=row['id'], document=original, revision=row['revision']))
            connection.execute(table.update().where(table.c.id == row['id']).values(document=document, revision=row['revision'] + 1))
            changed += 1
            cleared += sum(len(card.get('input_bindings', [])) + len(card.get('examples', [])) for card in original.get('cards', [])) - sum(len(card.get('input_bindings', [])) + len(card.get('examples', [])) for card in document.get('cards', []))
            old_ids = {edge['id'] for edge in original.get('edges', [])}
            new_ids = {edge['id'] for edge in document.get('edges', [])}
            removed += len(old_ids - new_ids)
            added += len(new_ids - old_ids)
    print(f'Connection policy: {changed} documents backed up, {removed} edges removed, {added} edges restored, {cleared} selections cleared')


def downgrade():
    """Never overwrite post-migration edits automatically."""
    raise RuntimeError('Review and restore generation_canvas_connection_backup explicitly')
