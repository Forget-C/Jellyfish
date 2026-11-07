"""Retire editable dialogue revisions and sound production classifications."""
import copy
import json
from alembic import op
import sqlalchemy as sa

revision = 'a71e92b603cf'
down_revision = '9b11d05c742f'
branch_labels = None
depends_on = None


def upgrade():
    """Back up changed documents; leave execution evidence and save receipts untouched."""
    op.create_table('generation_canvas_sound_metadata_backup',
                    sa.Column('canvas_id', sa.String(64), primary_key=True),
                    sa.Column('document', sa.JSON(), nullable=False))
    connection = op.get_bind()
    table = sa.table('generation_canvases', sa.column('id', sa.String), sa.column('document', sa.JSON))
    backup = sa.table('generation_canvas_sound_metadata_backup', sa.column('canvas_id', sa.String), sa.column('document', sa.JSON))
    count = 0
    for row in connection.execute(sa.select(table.c.id, table.c.document)).mappings():
        original = json.loads(row['document']) if isinstance(row['document'], str) else row['document']
        document = copy.deepcopy(original)
        for card in document.get('cards', []):
            if card.get('type') == 'direction.dialogue':
                card.pop('version', None)
            if card.get('type') == 'direction.sound':
                card.pop('production', None)
        if document != original:
            connection.execute(backup.insert().values(canvas_id=row['id'], document=original))
            connection.execute(table.update().where(table.c.id == row['id']).values(document=document))
            count += 1
    print(f'Retired sound metadata: {count} canvas documents backed up and migrated')


def downgrade():
    """Require deliberate restore to avoid overwriting edits made after migration."""
    raise RuntimeError('Restore canvas documents from generation_canvas_sound_metadata_backup after reviewing subsequent edits')
