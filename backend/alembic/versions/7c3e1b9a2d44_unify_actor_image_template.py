"""unify actor image template

Revision ID: 7c3e1b9a2d44
Revises: 2a7d9c4f8e31
Create Date: 2026-07-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "7c3e1b9a2d44"
down_revision: str | Sequence[str] | None = "2a7d9c4f8e31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACTOR_TEMPLATE_CONTENT = """Identity portrait of {{ name }}. {{ description }}
View: {{ view_angle }}. {{ reference_instruction }}
{{ framing_instruction }}
{{ visible_detail_instruction }}
{{ background_instruction }}
{{ lighting_instruction }}
{{ negative_prompt }}"""


def upgrade() -> None:
    """Remove retired categories, clear in-flight actor tasks, and add provenance fields."""
    # MySQL 5.7 / early 8.0 rejects defaults on JSON columns. Add nullable
    # columns first, backfill explicit JSON objects, then enforce NOT NULL.
    bind = op.get_bind()
    prompt_columns = {column["name"] for column in sa.inspect(bind).get_columns("prompt_templates")}
    actor_image_columns = {column["name"] for column in sa.inspect(bind).get_columns("actor_images")}
    if "variable_defaults" not in prompt_columns:
        op.add_column("prompt_templates", sa.Column("variable_defaults", sa.JSON(), nullable=True))
    if "version" not in prompt_columns:
        op.add_column("prompt_templates", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    if "prompt_overrides" not in actor_image_columns:
        op.add_column("actor_images", sa.Column("prompt_overrides", sa.JSON(), nullable=True))
    op.execute(
        sa.text("UPDATE prompt_templates SET variable_defaults = :empty WHERE variable_defaults IS NULL").bindparams(empty="{}")
    )
    op.execute(
        sa.text("UPDATE actor_images SET prompt_overrides = :empty WHERE prompt_overrides IS NULL").bindparams(empty="{}")
    )
    op.alter_column("prompt_templates", "variable_defaults", existing_type=sa.JSON(), nullable=False)
    op.alter_column("actor_images", "prompt_overrides", existing_type=sa.JSON(), nullable=False)
    op.execute(sa.text("""
        DELETE FROM generation_tasks WHERE id IN (
            SELECT task_id FROM generation_task_links WHERE relation_type = 'actor_image'
        ) AND status IN ('pending', 'running', 'streaming')
    """))
    op.execute(sa.text("DELETE FROM prompt_templates WHERE category IN ('actor_image_front', 'actor_image_other', 'actor_image')"))
    prompt_templates = sa.table(
        "prompt_templates", sa.column("id", sa.String), sa.column("category", sa.String),
        sa.column("name", sa.String), sa.column("preview", sa.Text), sa.column("content", sa.Text),
        sa.column("variables", sa.JSON), sa.column("variable_defaults", sa.JSON), sa.column("version", sa.Integer),
        sa.column("is_default", sa.Boolean), sa.column("is_system", sa.Boolean),
    )
    op.bulk_insert(prompt_templates, [{
        "id": "system_actor_image", "category": "actor_image", "name": "演员设定图 / 身份肖像",
        "preview": "单一干净背景的人物身份肖像；通过视角变量生成正面、侧面和背面。",
        "content": _ACTOR_TEMPLATE_CONTENT,
        "variables": ["name", "description", "view_angle", "reference_instruction", "framing_instruction", "visible_detail_instruction", "background_instruction", "lighting_instruction", "negative_prompt"],
        "variable_defaults": {
            "framing_instruction": "Full-body or three-quarter identity portrait, neutral standing pose, centered composition.",
            "visible_detail_instruction": "Show facial features, hairstyle, body proportions and clothing details clearly.",
            "background_instruction": "Plain seamless studio background with no scenery, props, text or narrative action.",
            "lighting_instruction": "Soft even studio lighting, accurate skin tone and clear fabric texture.",
            "negative_prompt": "cinematic still, movie scene, complex background, crowd, props, text, logo, watermark, blur, distorted anatomy",
        },
        "version": 1, "is_default": True, "is_system": True,
    }])
    op.alter_column("prompt_templates", "version", existing_type=sa.Integer(), existing_nullable=False, server_default=None)


def downgrade() -> None:
    """Remove new storage; retired categories are intentionally not restored."""
    op.drop_column("actor_images", "prompt_overrides")
    op.drop_column("prompt_templates", "version")
    op.drop_column("prompt_templates", "variable_defaults")
