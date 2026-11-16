"""Persist confirmed detail editing for uploaded scenes, props and costumes."""
from alembic import op
import sqlalchemy as sa

revision = "e82cfa190b64"
down_revision = "d714ac930f21"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("scenes", "props", "costumes"):
        op.add_column(table, sa.Column("details_editable", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    for table in ("scenes", "props", "costumes"):
        op.drop_column(table, "details_editable")
