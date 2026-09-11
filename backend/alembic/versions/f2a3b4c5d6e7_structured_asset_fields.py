"""Replace asset descriptions with structured facts; no historical data backfill.

Revision ID: f2a3b4c5d6e7
Revises: e0f1a2b3c4d5
"""
from alembic import op
import sqlalchemy as sa

revision = "f2a3b4c5d6e7"
down_revision = "e0f1a2b3c4d5"
branch_labels = None
depends_on = None

FIELDS = {'actors': ['age_appearance', 'gender', 'build', 'facial_features', 'skin_tone', 'hair'], 'scenes': ['scene_type', 'spatial_layout', 'environment_features', 'materials', 'color_palette'], 'props': ['prop_type', 'shape', 'size_description', 'materials', 'colors'], 'costumes': ['costume_type', 'structure', 'materials', 'colors', 'patterns_accessories']}


TEMPLATE_CONTENT = '用途：{{ purpose }}\n主体名称：{{ name }}\n主体设定（保留已确认特征，不擅自补充身份信息）：\n{{ description }}\n画面表现：{{ visual_style }}；题材：{{ style }}。\n视角：{{ view_angle }}。\n{{ framing_instruction }}\n{{ background_instruction }}\n{{ lighting_instruction }}\n{{ visible_detail_instruction }}\n{{ reference_instruction }}\n仅应用与主体设定及当前视角一致的本次展示要求：{{ additional_instruction }}\n排除：{{ negative_prompt }}'
TEMPLATE_VARIABLES = ['additional_instruction', 'background_instruction', 'description', 'framing_instruction', 'lighting_instruction', 'name', 'negative_prompt', 'purpose', 'reference_instruction', 'style', 'view_angle', 'visible_detail_instruction', 'visual_style']
TEMPLATE_DEFAULTS = {'framing_instruction': '主体完整、清晰可见，构图居中。', 'background_instruction': '干净中性背景。', 'lighting_instruction': '均匀柔和照明，准确呈现颜色与材质。', 'visible_detail_instruction': '仅展示当前视角可见的特征，不为展示被遮挡细节改变视角。', 'negative_prompt': '非用户要求的文字、水印、标志及额外主体。'}

def upgrade() -> None:
    """新增分类设定并移除旧描述存储，不迁移历史内容。"""
    for table, fields in FIELDS.items():
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("supplementary_info", sa.Text(), nullable=True))
            for field in fields:
                batch.add_column(sa.Column(field, sa.Text(), nullable=True))
            batch.drop_column("description")
        op.execute(sa.text(f"UPDATE {table} SET supplementary_info = '' WHERE supplementary_info IS NULL"))
        with op.batch_alter_table(table) as batch:
            batch.alter_column("supplementary_info", existing_type=sa.Text(), nullable=False)

    templates = sa.table("prompt_templates", sa.column("category", sa.String), sa.column("is_system", sa.Boolean),
                         sa.column("content", sa.Text), sa.column("variables", sa.JSON),
                         sa.column("variable_defaults", sa.JSON), sa.column("version", sa.Integer))
    for category in ("actor_image", "character_image", "prop_image", "costume_image", "scene_image_front", "scene_image_other"):
        defaults = dict(TEMPLATE_DEFAULTS)
        if category.startswith("scene_"):
            defaults.update(background_instruction="保留场景的建筑和环境，不替换为棚拍纯色背景。", framing_instruction="清晰展示空间关系与完整布局。")
        op.execute(templates.update().where(templates.c.category == category, templates.c.is_system.is_(True)).values(
            content=TEMPLATE_CONTENT, variables=TEMPLATE_VARIABLES, variable_defaults=defaults, version=templates.c.version + 1,
        ))


def downgrade() -> None:
    """恢复旧表结构；不尝试重建已经移除的资产设定。"""
    for table, fields in FIELDS.items():
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("description", sa.Text(), nullable=True))
            for field in fields:
                batch.drop_column(field)
            batch.drop_column("supplementary_info")
        op.execute(sa.text(f"UPDATE {table} SET description = '' WHERE description IS NULL"))
        with op.batch_alter_table(table) as batch:
            batch.alter_column("description", existing_type=sa.Text(), nullable=False)
