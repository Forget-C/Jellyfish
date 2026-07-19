"""unify character, prop and costume image templates

Revision ID: 9d4f2a8c6b15
Revises: 7c3e1b9a2d44
Create Date: 2026-07-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "9d4f2a8c6b15"
down_revision: str | Sequence[str] | None = "7c3e1b9a2d44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TEMPLATES = (
    ("system_character_image", "character_image", "角色设定图", "Character identity design for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}"),
    ("system_prop_image", "prop_image", "道具展示图", "Product design presentation for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}"),
    ("system_costume_image", "costume_image", "服装展示图", "Costume design presentation for {{ name }}. {{ description }}\nView: {{ view_angle }}. {{ reference_instruction }}\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ negative_prompt }}"),
)

_VARIABLES = ["name", "description", "view_angle", "reference_instruction", "framing_instruction", "background_instruction", "lighting_instruction", "negative_prompt"]
_DEFAULTS = {
    "framing_instruction": "Centered studio presentation with the full subject clearly visible and details unobstructed.",
    "background_instruction": "Plain seamless studio background with no scenery, story action, text, logo or watermark.",
    "lighting_instruction": "Soft even studio lighting with accurate material, color and texture detail.",
    "negative_prompt": "cinematic still, movie scene, complex background, crowd, narrative action, text, logo, watermark, blur, distorted anatomy",
}


def _add_prompt_overrides(table_name: str) -> None:
    """Add and backfill an image-level JSON override column in a MySQL-safe way."""
    bind = op.get_bind()
    column_names = {column["name"] for column in sa.inspect(bind).get_columns(table_name)}
    if "prompt_overrides" not in column_names:
        op.add_column(table_name, sa.Column("prompt_overrides", sa.JSON(), nullable=True))
    op.execute(sa.text(f"UPDATE {table_name} SET prompt_overrides = :empty WHERE prompt_overrides IS NULL").bindparams(empty="{}"))
    op.alter_column(table_name, "prompt_overrides", existing_type=sa.JSON(), nullable=False)


def upgrade() -> None:
    """Replace split image-template categories and preserve only completed image results."""
    for table_name in ("character_images", "prop_images", "costume_images", "scene_images"):
        _add_prompt_overrides(table_name)
    op.execute(sa.text("""
        DELETE FROM generation_tasks WHERE id IN (
            SELECT task_id FROM generation_task_links
            WHERE relation_type IN ('character_image', 'prop_image', 'costume_image')
        ) AND status IN ('pending', 'running', 'streaming')
    """))
    op.execute(sa.text("""
        DELETE FROM prompt_templates
        WHERE category IN (
            'character_image_front', 'character_image_other', 'character_image',
            'prop_image_front', 'prop_image_other', 'prop_image',
            'costume_image_front', 'costume_image_other', 'costume_image'
        )
    """))
    prompt_templates = sa.table(
        "prompt_templates", sa.column("id", sa.String), sa.column("category", sa.String),
        sa.column("name", sa.String), sa.column("preview", sa.Text), sa.column("content", sa.Text),
        sa.column("variables", sa.JSON), sa.column("variable_defaults", sa.JSON), sa.column("version", sa.Integer),
        sa.column("is_default", sa.Boolean), sa.column("is_system", sa.Boolean),
    )
    op.bulk_insert(prompt_templates, [
        {"id": template_id, "category": category, "name": name, "preview": f"单一干净背景的{name}，通过视角变量生成不同角度。", "content": content, "variables": _VARIABLES, "variable_defaults": _DEFAULTS, "version": 1, "is_default": True, "is_system": True}
        for template_id, category, name, content in _TEMPLATES
    ])


def downgrade() -> None:
    """Remove image-level override columns; retired template categories are not restored."""
    for table_name in ("scene_images", "costume_images", "prop_images", "character_images"):
        op.drop_column(table_name, "prompt_overrides")
