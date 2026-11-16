"""Persist confirmed detail editing for directly uploaded project characters."""
from alembic import op
import sqlalchemy as sa

revision = "b4d91ea7c203"
down_revision = "e82cfa190b64"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("characters", sa.Column("details_editable", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("characters", "details_editable")
