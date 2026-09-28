"""Persist scoped prompt and candidate labels independently of list ordering."""

import json

from alembic import op
import sqlalchemy as sa

revision = 'a1c4e7b9d205'
down_revision = '9bf5b2f0c813'
branch_labels = None
depends_on = None


def upgrade():
    """Backfill once in the previous display order, without changing frozen payloads."""
    op.add_column('directing_revisions', sa.Column('display_number', sa.Integer(), nullable=True, comment='指令在固定计划与单元内的不可变展示编号'))
    op.add_column('directing_takes', sa.Column('display_number', sa.Integer(), nullable=True, comment='候选在固定计划与单元内的不可变展示编号'))
    connection = op.get_bind()
    numbers = {}
    for row in connection.execute(sa.text("SELECT id, sequence_id, payload FROM directing_revisions WHERE kind='prompt' ORDER BY created_at, id")).mappings():
        payload = json.loads(row['payload']) if isinstance(row['payload'], str) else row['payload']
        key = (row['sequence_id'], payload['plan_revision_id'], payload['unit_id'])
        numbers[key] = numbers.get(key, 0) + 1
        connection.execute(sa.text('UPDATE directing_revisions SET display_number=:number WHERE id=:id'), {'number': numbers[key], 'id': row['id']})
    numbers = {}
    for row in connection.execute(sa.text('SELECT id, sequence_id, plan_revision_id, unit_id FROM directing_takes ORDER BY created_at, id')).mappings():
        key = (row['sequence_id'], row['plan_revision_id'], row['unit_id'])
        numbers[key] = numbers.get(key, 0) + 1
        connection.execute(sa.text('UPDATE directing_takes SET display_number=:number WHERE id=:id'), {'number': numbers[key], 'id': row['id']})


def downgrade():
    """Remove labels only; preserve versions, media and all business associations."""
    op.drop_column('directing_takes', 'display_number')
    op.drop_column('directing_revisions', 'display_number')
