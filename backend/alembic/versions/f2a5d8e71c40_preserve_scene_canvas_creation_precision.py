"""Preserve the admission order of scene canvases created in the same second."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = 'f2a5d8e71c40'
down_revision = 'd34171ab93f2'
branch_labels = None
depends_on = None


def upgrade():
    """Increase only canvas creation precision on MySQL."""
    if op.get_context().dialect.name == 'mysql':
        op.alter_column('generation_canvases', 'created_at', existing_type=sa.DateTime(timezone=True),
                        type_=DATETIME(fsp=6), existing_nullable=False, existing_server_default=sa.func.now())


def downgrade():
    """Restore the old column precision."""
    if op.get_context().dialect.name == 'mysql':
        op.alter_column('generation_canvases', 'created_at', existing_type=DATETIME(fsp=6),
                        type_=sa.DateTime(timezone=True), existing_nullable=False, existing_server_default=sa.func.now())
