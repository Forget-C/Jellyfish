"""Add stable per-angle image defaults without changing concrete references."""
from alembic import op
import sqlalchemy as sa

revision = 'b8e4d1a9f602'
down_revision = 'a714d2c98e31'
branch_labels = None
depends_on = None


def upgrade():
    """Prefer an existing primary in each angle, then the oldest available member."""
    for kind in ('actor', 'character', 'scene', 'prop', 'costume'):
        table = f'{kind}_images'
        op.add_column(table, sa.Column('is_view_default', sa.Boolean(), nullable=False, server_default=sa.false()))
        op.execute(sa.text(f'''UPDATE {table} SET is_view_default = (id IN (
            SELECT id FROM (SELECT i.id, ROW_NUMBER() OVER (
                PARTITION BY i.{kind}_id, i.view_angle
                ORDER BY i.is_primary DESC, i.created_at, i.id
            ) AS image_rank FROM {table} i JOIN files f ON f.id = i.file_id
            WHERE f.type = 'image' AND f.delete_requested_at IS NULL AND f.deleted_at IS NULL
            ) AS ranked WHERE image_rank = 1))'''))


def downgrade():
    """Drop only the default selection, preserving all images and references."""
    for kind in ('actor', 'character', 'scene', 'prop', 'costume'):
        op.drop_column(f'{kind}_images', 'is_view_default')
