"""Identify provider configurations independently of their display names."""
from alembic import op
import sqlalchemy as sa


revision = "174afba8895d"
down_revision = "68e14fd0c209"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM providers LIMIT 1")).first():
        raise RuntimeError("Provider configurations require a fresh providers table")
    name_type = sa.String(255, collation="utf8mb4_0900_as_ci").with_variant(
        sa.String(255, collation="NOCASE"), "sqlite"
    )
    with op.batch_alter_table("providers") as table:
        table.add_column(sa.Column("provider_key", sa.String(64), nullable=False))
        table.alter_column("name", type_=name_type, existing_type=sa.String(255),
                           existing_nullable=False, comment="配置名称")
        table.create_index("uq_provider_config_name", ["provider_key", "name"], unique=True)


def downgrade():
    with op.batch_alter_table("providers") as table:
        table.drop_index("uq_provider_config_name")
        table.drop_column("provider_key")
        table.alter_column("name", type_=sa.String(255), existing_type=sa.String(255),
                           existing_nullable=False, comment="供应商名称")
