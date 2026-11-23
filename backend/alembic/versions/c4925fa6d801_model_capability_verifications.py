"""Record the tested capability and connection snapshot for each model probe."""

import sqlalchemy as sa
from alembic import op


revision = "c4925fa6d801"
down_revision = "f81ab631903c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "model_capability_verifications",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("model_id", sa.String(64), sa.ForeignKey("models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("configuration_hash", sa.String(64), nullable=False),
        sa.Column("provider_id", sa.String(64), nullable=False),
        sa.Column("provider_name", sa.String(255), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        sa.Column("endpoint", sa.Text, nullable=False),
        sa.Column("capability", sa.String(32), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_capability_verifications_model_id", "model_capability_verifications", ["model_id"])


def downgrade():
    op.drop_table("model_capability_verifications")
