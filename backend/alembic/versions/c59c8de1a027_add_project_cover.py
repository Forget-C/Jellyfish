"""Store project cover identity and mark privately managed file copies."""

from alembic import op
import sqlalchemy as sa

revision = "c59c8de1a027"
down_revision = "a8d42f5e620c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("files", sa.Column("is_project_cover", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("cover_file_id", sa.String(64), nullable=True))
        batch.create_foreign_key("fk_projects_cover_file", "files", ["cover_file_id"], ["id"], ondelete="SET NULL")


def downgrade():
    op.execute(sa.text("UPDATE files SET delete_requested_at = CURRENT_TIMESTAMP "
                       "WHERE is_project_cover = 1 AND delete_requested_at IS NULL"))
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("fk_projects_cover_file", type_="foreignkey")
        batch.drop_column("cover_file_id")
    op.drop_column("files", "is_project_cover")
