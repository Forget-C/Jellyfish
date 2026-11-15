"""Persist explicit confirmation before editing role-derived actor details."""
from alembic import op
import sqlalchemy as sa
revision = "d714ac930f21"
down_revision = "c6e5a1b8d203"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("actors", sa.Column("details_editable", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("actors", "details_editable")
