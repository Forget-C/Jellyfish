"""Track image-based creation without changing existing objects."""
from alembic import op
import sqlalchemy as sa
revision = 'c6e5a1b8d203'
down_revision = 'b8e4d1a9f602'
branch_labels = None
depends_on = None


def upgrade():
    """Existing objects retain their established created/legacy permissions."""
    for table in ('actors', 'characters', 'scenes', 'props', 'costumes'):
        op.add_column(table, sa.Column('origin', sa.String(16), nullable=False, server_default='created'))
        for name, length in (('source_kind', 16), ('source_id', 64), ('source_request_hash', 64)):
            op.add_column(table, sa.Column(name, sa.String(length), nullable=True))


def downgrade():
    """Remove source metadata only; object/image records remain."""
    for table in ('actors', 'characters', 'scenes', 'props', 'costumes'):
        if op.get_bind().scalar(sa.text(f"SELECT COUNT(*) FROM {table} WHERE origin <> 'created'")):
            raise RuntimeError("Cannot remove origins while image-source resources exist; restore a backup to roll back")
    for table in ('actors', 'characters', 'scenes', 'props', 'costumes'):
        for name in ('source_request_hash', 'source_id', 'source_kind', 'origin'):
            op.drop_column(table, name)
