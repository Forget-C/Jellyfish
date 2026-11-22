"""Store model capability declarations separately from provider parameters."""

import sqlalchemy as sa
from alembic import op


revision = "b7326dc40a19"
down_revision = "174afba8895d"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("models", sa.Column("capability_profile", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("models", "capability_profile")
