"""Separate project ownership from shared-asset associations."""

from alembic import op
import sqlalchemy as sa

revision = "a714d2c98e31"
down_revision = "f2a5d8e71c40"
branch_labels = None
depends_on = None


def upgrade():
    """Keep existing assets shared; scope names independently for future project objects."""
    for table in ("actors", "scenes", "props", "costumes"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("references", sa.JSON(), nullable=True))
            batch.add_column(sa.Column("library_copy_id", sa.String(64), nullable=True))
            batch.add_column(sa.Column("project_id", sa.String(64), nullable=True))
            batch.create_foreign_key(f"fk_{table}_project", "projects", ["project_id"], ["id"], ondelete="CASCADE")
            batch.create_index(f"ix_{table}_project_id", ["project_id"])
        op.execute(sa.text(f"UPDATE {table} SET `references` = '[]'"))
        with op.batch_alter_table(table) as batch:
            batch.alter_column("references", existing_type=sa.JSON(), nullable=False)
            batch.add_column(sa.Column("name_scope", sa.String(64), sa.Computed("coalesce(project_id, '')", persisted=False)))
            batch.drop_constraint(f"uq_{table}_name", type_="unique")
            batch.create_unique_constraint(f"uq_{table}_scope_name", ["name_scope", "name"])
    op.add_column("actors", sa.Column("source_character_id", sa.String(64), nullable=True))
    op.add_column("characters", sa.Column("references", sa.JSON(), nullable=True))
    op.execute(sa.text("UPDATE characters SET `references` = '[]'"))
    with op.batch_alter_table("characters") as batch:
        batch.alter_column("references", existing_type=sa.JSON(), nullable=False)
    op.add_column("characters", sa.Column("library_copy_id", sa.String(64), nullable=True))
    for singular in ("actor", "scene", "prop", "costume", "character"):
        with op.batch_alter_table(f"{singular}_images") as batch:
            batch.drop_constraint(f"uq_{singular}_images_quality_angle", type_="unique")
            if singular != "character":
                batch.add_column(sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()))
        table = f"{singular}_images"
        op.execute(sa.text(f"""UPDATE {table} SET is_primary = (id IN (
            SELECT id FROM (SELECT id, ROW_NUMBER() OVER (
                PARTITION BY {singular}_id ORDER BY is_primary DESC,
                CASE WHEN view_angle = 'FRONT' THEN 1 ELSE 0 END DESC, created_at DESC, id DESC
            ) AS image_rank FROM {table} WHERE file_id IS NOT NULL) AS ranked WHERE image_rank = 1))"""))
    # 仅移除已被统一参考取代的旧组合配置，不修改对象、图片和任务身份。
    op.drop_table("character_prop_links")
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys("characters")
    with op.batch_alter_table("characters", naming_convention={
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    }) as batch:
        for key in foreign_keys:
            if set(key["constrained_columns"]) & {"actor_id", "costume_id"}:
                name = key["name"] or f"fk_characters_{key['constrained_columns'][0]}_{key['referred_table']}"
                batch.drop_constraint(name, type_="foreignkey")
        batch.drop_column("actor_id")
        batch.drop_column("costume_id")
    # 旧场次已明确选定的文件继续保留，仅清除不再成立的动态演员来源标记。
    sequences = sa.table("directing_sequences", sa.column("id", sa.String()), sa.column("object_preparation", sa.JSON()))
    for row in op.get_bind().execute(sa.select(sequences.c.id, sequences.c.object_preparation)):
        preparation = row.object_preparation
        if not isinstance(preparation, dict):
            continue
        changed = False
        for candidate in preparation.get("objects", []):
            if isinstance(candidate, dict) and (candidate.get("reference_source") or {}).get("kind") == "actor":
                candidate["reference_source"] = None
                changed = True
        if changed:
            op.get_bind().execute(sequences.update().where(sequences.c.id == row.id).values(object_preparation=preparation))


def downgrade():
    """Require explicit reconciliation of project objects before restoring global names."""
    raise RuntimeError("Multi-image folders require backup restoration for downgrade")
