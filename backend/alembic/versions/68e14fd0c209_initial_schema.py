"""Create the application schema for a fresh database."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "68e14fd0c209"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the initial tables, constraints and indexes in dependency order."""
    creation_time = "CURRENT_TIMESTAMP(6)" if op.get_context().dialect.name == "mysql" else "CURRENT_TIMESTAMP"

    op.create_table(
        'experiment_sessions',
        sa.Column('id', sa.String(length=64), nullable=False, comment='会话 ID'),
        sa.Column('lab_type', sa.String(length=16), nullable=False, comment='实验室类型：text/image/video'),
        sa.Column('title', sa.String(length=255), nullable=False, comment='用户可见会话标题'),
        sa.Column('message_sequence', sa.Integer(), server_default=sa.text('0'), nullable=False, comment='会话内已分配的最大消息序号'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_experiment_sessions_lab_type', 'experiment_sessions', ['lab_type'], unique=False)
    op.create_index('ix_experiment_sessions_lab_updated', 'experiment_sessions', ['lab_type', 'updated_at'], unique=False)

    op.create_table(
        'files',
        sa.Column('id', sa.String(length=64), nullable=False, comment='文件 ID（UUID）'),
        sa.Column('type', sa.String(length=16), nullable=False, comment='文件类型'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='文件名/标题'),
        sa.Column('thumbnail_key', sa.String(length=700), nullable=True, comment='缩略图存储 key'),
        sa.Column('tags', sa.JSON(), nullable=False, comment='标签（JSON 数组）'),
        sa.Column('storage_key', sa.String(length=700, collation='utf8mb4_bin').with_variant(sa.String(length=700), 'sqlite'), nullable=False, comment='不可变对象的唯一存储 key'),
        sa.Column('content_type', sa.String(length=255), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.BigInteger(), nullable=True),
        sa.Column('is_project_cover', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('delete_requested_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('content_hash', sa.String(length=128), nullable=True, comment='文件内容哈希'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('storage_key'),
    )
    op.create_index('ix_files_delete', 'files', ['deleted_at', 'delete_requested_at'], unique=False)
    op.create_index('ix_files_type', 'files', ['type'], unique=False)
    op.create_index('ix_files_updated_at', 'files', ['updated_at'], unique=False)

    op.create_table(
        'prompt_templates',
        sa.Column('id', sa.String(length=64), nullable=False, comment='模板 ID（UUID）'),
        sa.Column('category', sa.String(length=32), nullable=False, comment='模板类别'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='模板名称'),
        sa.Column('preview', sa.Text(), nullable=False, comment='预览文案'),
        sa.Column('content', sa.Text(), nullable=False, comment='模板内容'),
        sa.Column('variables', sa.JSON(), nullable=False, comment='变量名列表（JSON 数组）'),
        sa.Column('variable_defaults', sa.JSON(), nullable=False, comment='可配置变量的默认值（JSON 对象）'),
        sa.Column('version', sa.Integer(), nullable=False, comment='模板内容版本号（每次内容或变量修改递增）'),
        sa.Column('is_default', sa.Boolean(), nullable=False, comment='是否为默认提示词（同类别唯一，应用层保证）'),
        sa.Column('is_system', sa.Boolean(), nullable=False, comment='是否为系统预置（仅初始化脚本写入，接口层禁止删改）'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_prompt_templates_category', 'prompt_templates', ['category'], unique=False)
    op.create_index('ix_prompt_templates_name', 'prompt_templates', ['name'], unique=False)

    op.create_table(
        'providers',
        sa.Column('id', sa.String(length=64), nullable=False, comment='供应商 ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='供应商名称'),
        sa.Column('base_url', sa.String(length=1024), nullable=False, comment='文本/通用 API Base URL'),
        sa.Column('image_base_url', sa.String(length=1024), nullable=True, comment='图片能力 API Base URL（可选覆盖）'),
        sa.Column('video_base_url', sa.String(length=1024), nullable=True, comment='视频能力 API Base URL（可选覆盖）'),
        sa.Column('api_key', sa.String(length=4096), nullable=False, comment='API Key（敏感）'),
        sa.Column('api_secret', sa.String(length=4096), nullable=False, comment='API Secret（敏感）'),
        sa.Column('description', sa.Text(), nullable=False, comment='说明'),
        sa.Column('status', sa.String(length=32), nullable=False, comment='状态'),
        sa.Column('created_by', sa.String(length=64), nullable=False, comment='创建人'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_providers_name', 'providers', ['name'], unique=False)
    op.create_index('ix_providers_status', 'providers', ['status'], unique=False)
    op.create_index('ix_providers_updated_at', 'providers', ['updated_at'], unique=False)

    op.create_table(
        'experiment_messages',
        sa.Column('id', sa.String(length=64), nullable=False, comment='消息 ID'),
        sa.Column('session_id', sa.String(length=64), nullable=False, comment='所属会话 ID'),
        sa.Column('sequence', sa.Integer(), nullable=False, comment='会话内消息顺序，从 1 单调递增'),
        sa.Column('role', sa.String(length=16), nullable=False, comment='展示角色：user/assistant/task'),
        sa.Column('content', sa.Text(), nullable=False, comment='展示文本'),
        sa.Column('status', sa.String(length=16), nullable=True, comment='异步任务状态'),
        sa.Column('payload', sa.JSON(), nullable=False, comment='实验室特定展示数据'),
        sa.Column('task_id', sa.String(length=64), nullable=True, comment='关联异步任务 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['experiment_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_experiment_messages_session_created', 'experiment_messages', ['session_id', 'created_at'], unique=False)
    op.create_index('ix_experiment_messages_session_id', 'experiment_messages', ['session_id'], unique=False)
    op.create_index('ix_experiment_messages_task_id', 'experiment_messages', ['task_id'], unique=True)
    op.create_index('ux_experiment_messages_session_sequence', 'experiment_messages', ['session_id', 'sequence'], unique=True)

    op.create_table(
        'models',
        sa.Column('id', sa.String(length=64), nullable=False, comment='模型 ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='模型名称'),
        sa.Column('category', sa.String(length=16), nullable=False, comment='模型类别'),
        sa.Column('provider_id', sa.String(length=64), nullable=False, comment='所属供应商 ID'),
        sa.Column('params', sa.JSON(), nullable=False, comment='模型参数（JSON）'),
        sa.Column('description', sa.Text(), nullable=False, comment='说明'),
        sa.Column('created_by', sa.String(length=64), nullable=False, comment='创建人'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_models_category', 'models', ['category'], unique=False)
    op.create_index('ix_models_name', 'models', ['name'], unique=False)
    op.create_index('ix_models_provider_id', 'models', ['provider_id'], unique=False)
    op.create_index('ix_models_updated_at', 'models', ['updated_at'], unique=False)

    op.create_table(
        'projects',
        sa.Column('id', sa.String(length=64), nullable=False, comment='项目 ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='项目名称'),
        sa.Column('description', sa.Text(), nullable=False, comment='项目简介'),
        sa.Column('style', sa.String(length=32), nullable=False, comment='题材/风格'),
        sa.Column('visual_style', sa.String(length=16), nullable=False, comment='画面表现形式（真人/动漫等）'),
        sa.Column('cover_file_id', sa.String(length=64), nullable=True),
        sa.Column('seed', sa.Integer(), nullable=False, comment='随机种子'),
        sa.Column('unify_style', sa.Boolean(), nullable=False, comment='是否统一风格（跨章节）'),
        sa.Column('progress', sa.Integer(), nullable=False, comment='进度百分比（0-100）'),
        sa.Column('default_video_ratio', sa.String(length=16), nullable=True, comment='项目级默认视频比例（可为空；分镜未覆盖时使用）'),
        sa.Column('stats', sa.JSON(), nullable=False, comment='聚合统计（JSON）'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['cover_file_id'], ['files.id'], name='fk_projects_cover_file', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_projects_style', 'projects', ['style'], unique=False)
    op.create_index('ix_projects_updated_at', 'projects', ['updated_at'], unique=False)
    op.create_index('ix_projects_visual_style', 'projects', ['visual_style'], unique=False)

    op.create_table(
        'tasks',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('kind', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('target_type', sa.String(length=64), nullable=True),
        sa.Column('target_id', sa.String(length=64), nullable=True),
        sa.Column('expected_target_version', sa.Integer(), nullable=True),
        sa.Column('project_id', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('stage', sa.String(length=32), nullable=False),
        sa.Column('progress', sa.Integer(), nullable=True),
        sa.Column('execution_mode', sa.String(length=16), nullable=False),
        sa.Column('worker_instance_id', sa.String(length=64), nullable=True),
        sa.Column('input_snapshot', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('provider_id', sa.String(length=64), nullable=True),
        sa.Column('provider_task_id', sa.String(length=255), nullable=True),
        sa.Column('remote_status', sa.String(length=64), nullable=True),
        sa.Column('next_poll_at', sa.DateTime(), nullable=True),
        sa.Column('last_polled_at', sa.DateTime(), nullable=True),
        sa.Column('deadline_at', sa.DateTime(), nullable=True),
        sa.Column('cancel_requested_at', sa.DateTime(), nullable=True),
        sa.Column('cancel_reason', sa.String(length=255), nullable=True),
        sa.Column('error_code', sa.String(length=128), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('last_poll_error', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('retry_of_task_id', sa.String(length=64), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("execution_mode IN ('direct','remote')", name='ck_tasks_execution_mode'),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','cancelled')", name='ck_tasks_status'),
        sa.CheckConstraint('progress IS NULL OR (progress >= 0 AND progress <= 100)', name='ck_tasks_progress'),
        sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['retry_of_task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tasks_deadline', 'tasks', ['status', 'deadline_at'], unique=False)
    op.create_index('ix_tasks_history', 'tasks', ['created_at', 'id'], unique=False)
    op.create_index('ix_tasks_poll', 'tasks', ['status', 'next_poll_at', 'id'], unique=False)
    op.create_index('ix_tasks_project_history', 'tasks', ['project_id', 'created_at', 'id'], unique=False)
    op.create_index('ix_tasks_queue', 'tasks', ['status', 'created_at', 'id'], unique=False)
    op.create_index('ix_tasks_target', 'tasks', ['target_type', 'target_id', 'created_at'], unique=False)

    op.create_table(
        'actors',
        sa.Column('id', sa.String(length=64), nullable=False, comment='ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='名称'),
        sa.Column('age_appearance', sa.Text(), nullable=True, comment='外观年龄'),
        sa.Column('gender', sa.Text(), nullable=True, comment='性别设定'),
        sa.Column('build', sa.Text(), nullable=True, comment='体型'),
        sa.Column('facial_features', sa.Text(), nullable=True, comment='五官特征'),
        sa.Column('skin_tone', sa.Text(), nullable=True, comment='肤色'),
        sa.Column('hair', sa.Text(), nullable=True, comment='发型发色'),
        sa.Column('style', sa.String(length=32), nullable=True, comment='题材/风格'),
        sa.Column('view_count', sa.Integer(), nullable=False, comment='计划为该演员形象生成的视角图片数量（不含分镜帧）'),
        sa.Column('tags', sa.JSON(), nullable=False, comment='标签'),
        sa.Column('prompt_template_id', sa.String(length=64), nullable=True, comment='提示词模板 ID'),
        sa.Column('visual_style', sa.String(length=16), nullable=True, comment='画面表现形式（现实/动漫等）'),
        sa.Column('project_id', sa.String(length=64), nullable=True, comment='所属项目；空值表示共享资产'),
        sa.Column('name_scope', sa.String(length=64), sa.Computed("coalesce(project_id, '')", persisted=False), nullable=False),
        sa.Column('origin', sa.String(length=16), server_default='created', nullable=False),
        sa.Column('details_editable', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('source_request_hash', sa.String(length=64), nullable=True),
        sa.Column('references', sa.JSON(), nullable=False),
        sa.Column('library_copy_id', sa.String(length=64), nullable=True),
        sa.Column('supplementary_info', sa.Text(), nullable=False, comment='补充信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_template_id'], ['prompt_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name_scope', 'name', name='uq_actors_scope_name'),
    )
    op.create_index('ix_actors_name', 'actors', ['name'], unique=False)
    op.create_index('ix_actors_project_id', 'actors', ['project_id'], unique=False)
    op.create_index('ix_actors_prompt_template_id', 'actors', ['prompt_template_id'], unique=False)

    op.create_table(
        'chapters',
        sa.Column('id', sa.String(length=64), nullable=False, comment='章节 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='所属项目 ID'),
        sa.Column('index', sa.Integer(), nullable=False, comment='章节序号（项目内唯一）'),
        sa.Column('title', sa.String(length=255), nullable=False, comment='章节标题'),
        sa.Column('summary', sa.Text(), nullable=False, comment='章节摘要'),
        sa.Column('raw_text', sa.Text(), nullable=False, comment='章节原文（未清洗/可较长）'),
        sa.Column('source_explanations', sa.JSON(), nullable=True),
        sa.Column('condensed_text', sa.Text(), nullable=False, comment='由模型精简后的原文（用于抽取/提示词）'),
        sa.Column('status', sa.String(length=32), nullable=False, comment='章节状态'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'index', name='uq_chapters_project_index'),
    )
    op.create_index('ix_chapters_project_id', 'chapters', ['project_id'], unique=False)
    op.create_index('ix_chapters_project_title', 'chapters', ['project_id', 'title'], unique=False)
    op.create_index('ix_chapters_status', 'chapters', ['status'], unique=False)
    op.create_index('ix_chapters_updated_at', 'chapters', ['updated_at'], unique=False)

    op.create_table(
        'characters',
        sa.Column('details_editable', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('origin', sa.String(length=16), server_default='created', nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('source_request_hash', sa.String(length=64), nullable=True),
        sa.Column('references', sa.JSON(), nullable=False),
        sa.Column('library_copy_id', sa.String(length=64), nullable=True),
        sa.Column('id', sa.String(length=64), nullable=False, comment='角色 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='所属项目 ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='角色名称'),
        sa.Column('description', sa.Text(), nullable=False, comment='角色描述'),
        sa.Column('style', sa.String(length=32), nullable=True, comment='题材/风格'),
        sa.Column('visual_style', sa.String(length=16), nullable=True, comment='画面表现形式（现实/动漫等）'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'name', name='uq_characters_project_name'),
    )
    op.create_index('ix_characters_name', 'characters', ['name'], unique=False)
    op.create_index('ix_characters_project_id', 'characters', ['project_id'], unique=False)

    op.create_table(
        'costumes',
        sa.Column('id', sa.String(length=64), nullable=False, comment='ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='名称'),
        sa.Column('costume_type', sa.Text(), nullable=True, comment='服装类型'),
        sa.Column('structure', sa.Text(), nullable=True, comment='款式层次'),
        sa.Column('materials', sa.Text(), nullable=True, comment='材质'),
        sa.Column('colors', sa.Text(), nullable=True, comment='颜色'),
        sa.Column('patterns_accessories', sa.Text(), nullable=True, comment='纹样与附属配饰'),
        sa.Column('style', sa.String(length=32), nullable=True, comment='题材/风格'),
        sa.Column('view_count', sa.Integer(), nullable=False, comment='计划为该服装生成的视角图片数量（不含分镜帧）'),
        sa.Column('tags', sa.JSON(), nullable=False, comment='标签'),
        sa.Column('prompt_template_id', sa.String(length=64), nullable=True, comment='提示词模板 ID'),
        sa.Column('visual_style', sa.String(length=16), nullable=True, comment='画面表现形式（现实/动漫等）'),
        sa.Column('project_id', sa.String(length=64), nullable=True, comment='所属项目；空值表示共享资产'),
        sa.Column('name_scope', sa.String(length=64), sa.Computed("coalesce(project_id, '')", persisted=False), nullable=False),
        sa.Column('origin', sa.String(length=16), server_default='created', nullable=False),
        sa.Column('details_editable', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('source_request_hash', sa.String(length=64), nullable=True),
        sa.Column('references', sa.JSON(), nullable=False),
        sa.Column('library_copy_id', sa.String(length=64), nullable=True),
        sa.Column('supplementary_info', sa.Text(), nullable=False, comment='补充信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_template_id'], ['prompt_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name_scope', 'name', name='uq_costumes_scope_name'),
    )
    op.create_index('ix_costumes_name', 'costumes', ['name'], unique=False)
    op.create_index('ix_costumes_project_id', 'costumes', ['project_id'], unique=False)
    op.create_index('ix_costumes_prompt_template_id', 'costumes', ['prompt_template_id'], unique=False)

    op.create_table(
        'directing_project_styles',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('project_id', sa.String(length=64), nullable=False),
        sa.Column('parent_id', sa.String(length=64), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('confirmed_by', sa.String(length=64), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)', name='ck_directing_style_confirmation'),
        sa.CheckConstraint('version > 0', name='ck_directing_style_version'),
        sa.ForeignKeyConstraint(['parent_id'], ['directing_project_styles.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_directing_project_styles_project_id', 'directing_project_styles', ['project_id'], unique=False)

    op.create_table(
        'model_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='设置行 ID（通常为 1）'),
        sa.Column('default_text_model_id', sa.String(length=64), nullable=True, comment='默认文本模型 ID'),
        sa.Column('default_image_model_id', sa.String(length=64), nullable=True, comment='默认图片模型 ID'),
        sa.Column('default_video_model_id', sa.String(length=64), nullable=True, comment='默认视频模型 ID'),
        sa.Column('api_timeout', sa.Integer(), nullable=False, comment='API 超时（秒）'),
        sa.Column('log_level', sa.String(length=16), nullable=False, comment='日志级别'),
        sa.ForeignKeyConstraint(['default_image_model_id'], ['models.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['default_text_model_id'], ['models.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['default_video_model_id'], ['models.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'props',
        sa.Column('id', sa.String(length=64), nullable=False, comment='ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='名称'),
        sa.Column('prop_type', sa.Text(), nullable=True, comment='道具类型'),
        sa.Column('shape', sa.Text(), nullable=True, comment='外形结构'),
        sa.Column('size_description', sa.Text(), nullable=True, comment='尺寸或相对尺度'),
        sa.Column('materials', sa.Text(), nullable=True, comment='材质'),
        sa.Column('colors', sa.Text(), nullable=True, comment='颜色'),
        sa.Column('style', sa.String(length=32), nullable=True, comment='题材/风格'),
        sa.Column('view_count', sa.Integer(), nullable=False, comment='计划为该道具生成的视角图片数量（不含分镜帧）'),
        sa.Column('tags', sa.JSON(), nullable=False, comment='标签'),
        sa.Column('prompt_template_id', sa.String(length=64), nullable=True, comment='提示词模板 ID'),
        sa.Column('visual_style', sa.String(length=16), nullable=True, comment='画面表现形式（现实/动漫等）'),
        sa.Column('project_id', sa.String(length=64), nullable=True, comment='所属项目；空值表示共享资产'),
        sa.Column('name_scope', sa.String(length=64), sa.Computed("coalesce(project_id, '')", persisted=False), nullable=False),
        sa.Column('origin', sa.String(length=16), server_default='created', nullable=False),
        sa.Column('details_editable', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('source_request_hash', sa.String(length=64), nullable=True),
        sa.Column('references', sa.JSON(), nullable=False),
        sa.Column('library_copy_id', sa.String(length=64), nullable=True),
        sa.Column('supplementary_info', sa.Text(), nullable=False, comment='补充信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_template_id'], ['prompt_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name_scope', 'name', name='uq_props_scope_name'),
    )
    op.create_index('ix_props_name', 'props', ['name'], unique=False)
    op.create_index('ix_props_project_id', 'props', ['project_id'], unique=False)
    op.create_index('ix_props_prompt_template_id', 'props', ['prompt_template_id'], unique=False)

    op.create_table(
        'scenes',
        sa.Column('id', sa.String(length=64), nullable=False, comment='ID'),
        sa.Column('name', sa.String(length=255), nullable=False, comment='名称'),
        sa.Column('scene_type', sa.Text(), nullable=True, comment='场所类型'),
        sa.Column('spatial_layout', sa.Text(), nullable=True, comment='空间布局'),
        sa.Column('environment_features', sa.Text(), nullable=True, comment='环境特征'),
        sa.Column('materials', sa.Text(), nullable=True, comment='主要材质'),
        sa.Column('color_palette', sa.Text(), nullable=True, comment='色彩'),
        sa.Column('style', sa.String(length=32), nullable=True, comment='题材/风格'),
        sa.Column('view_count', sa.Integer(), nullable=False, comment='计划为该场景生成的视角图片数量（不含分镜帧）'),
        sa.Column('tags', sa.JSON(), nullable=False, comment='标签'),
        sa.Column('prompt_template_id', sa.String(length=64), nullable=True, comment='提示词模板 ID'),
        sa.Column('visual_style', sa.String(length=16), nullable=True, comment='画面表现形式（现实/动漫等）'),
        sa.Column('project_id', sa.String(length=64), nullable=True, comment='所属项目；空值表示共享资产'),
        sa.Column('name_scope', sa.String(length=64), sa.Computed("coalesce(project_id, '')", persisted=False), nullable=False),
        sa.Column('origin', sa.String(length=16), server_default='created', nullable=False),
        sa.Column('details_editable', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=True),
        sa.Column('source_id', sa.String(length=64), nullable=True),
        sa.Column('source_request_hash', sa.String(length=64), nullable=True),
        sa.Column('references', sa.JSON(), nullable=False),
        sa.Column('library_copy_id', sa.String(length=64), nullable=True),
        sa.Column('supplementary_info', sa.Text(), nullable=False, comment='补充信息'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_template_id'], ['prompt_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name_scope', 'name', name='uq_scenes_scope_name'),
    )
    op.create_index('ix_scenes_name', 'scenes', ['name'], unique=False)
    op.create_index('ix_scenes_project_id', 'scenes', ['project_id'], unique=False)
    op.create_index('ix_scenes_prompt_template_id', 'scenes', ['prompt_template_id'], unique=False)

    op.create_table(
        'task_inputs',
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('role_path', sa.String(length=255), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'role_path', 'ordinal'),
    )
    op.create_index('ix_task_inputs_file', 'task_inputs', ['file_id', 'task_id'], unique=False)

    op.create_table(
        'task_outputs',
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(length=64), nullable=False),
        sa.Column('delivery_status', sa.String(length=16), nullable=True),
        sa.Column('delivery_reason', sa.String(length=128), nullable=True),
        sa.CheckConstraint("delivery_status IS NULL OR delivery_status IN ('published','conflicted','skipped')", name='ck_task_outputs_delivery'),
        sa.CheckConstraint('ordinal >= 0', name='ck_task_outputs_ordinal'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('task_id', 'ordinal'),
    )
    op.create_index('ix_task_outputs_file_id', 'task_outputs', ['file_id'], unique=False)

    op.create_table(
        'actor_images',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='图片行 ID'),
        sa.Column('actor_id', sa.String(length=64), nullable=False, comment='所属演员 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=True, comment='关联的文件 ID（FileItem，可空，支持先创建槽位后填充）'),
        sa.Column('quality_level', sa.String(length=16), nullable=False, comment='精度等级'),
        sa.Column('view_angle', sa.String(length=32), nullable=False, comment='视角'),
        sa.Column('width', sa.Integer(), nullable=True, comment='宽（px）'),
        sa.Column('height', sa.Integer(), nullable=True, comment='高（px）'),
        sa.Column('format', sa.String(length=32), nullable=False, comment='格式'),
        sa.Column('prompt_overrides', sa.JSON(), nullable=False, comment='此图片的展示提示词变量覆盖；不影响同一演员的其他视角'),
        sa.Column('version_id', sa.Integer(), nullable=False, comment='槽位 CAS 版本'),
        sa.Column('is_view_default', sa.Boolean(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['actors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_actor_images_actor_id', 'actor_images', ['actor_id'], unique=False)
    op.create_index('ix_actor_images_file_id', 'actor_images', ['file_id'], unique=False)
    op.create_index('ix_actor_images_quality_level', 'actor_images', ['quality_level'], unique=False)
    op.create_index('ix_actor_images_view_angle', 'actor_images', ['view_angle'], unique=False)

    op.create_table(
        'character_images',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='图片行 ID'),
        sa.Column('character_id', sa.String(length=64), nullable=False, comment='所属角色 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=True, comment='关联的文件 ID（FileItem，可空，支持先创建槽位后填充）'),
        sa.Column('quality_level', sa.String(length=16), nullable=False, comment='精度等级'),
        sa.Column('view_angle', sa.String(length=32), nullable=False, comment='视角'),
        sa.Column('width', sa.Integer(), nullable=True, comment='宽（px）'),
        sa.Column('height', sa.Integer(), nullable=True, comment='高（px）'),
        sa.Column('format', sa.String(length=32), nullable=True, comment='格式'),
        sa.Column('prompt_overrides', sa.JSON(), nullable=False, comment='此图片的展示提示词变量覆盖'),
        sa.Column('version_id', sa.Integer(), nullable=False, comment='槽位 CAS 版本'),
        sa.Column('is_view_default', sa.Boolean(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_character_images_character_id', 'character_images', ['character_id'], unique=False)
    op.create_index('ix_character_images_file_id', 'character_images', ['file_id'], unique=False)
    op.create_index('ix_character_images_quality_level', 'character_images', ['quality_level'], unique=False)
    op.create_index('ix_character_images_view_angle', 'character_images', ['view_angle'], unique=False)

    op.create_table(
        'costume_images',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='图片行 ID'),
        sa.Column('costume_id', sa.String(length=64), nullable=False, comment='所属服装 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=True, comment='关联的文件 ID（FileItem，可空，支持先创建槽位后填充）'),
        sa.Column('quality_level', sa.String(length=16), nullable=False),
        sa.Column('view_angle', sa.String(length=32), nullable=False),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('format', sa.String(length=32), nullable=False),
        sa.Column('prompt_overrides', sa.JSON(), nullable=False, comment='此图片的展示提示词变量覆盖'),
        sa.Column('version_id', sa.Integer(), nullable=False, comment='槽位 CAS 版本'),
        sa.Column('is_view_default', sa.Boolean(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['costume_id'], ['costumes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_costume_images_costume_id', 'costume_images', ['costume_id'], unique=False)
    op.create_index('ix_costume_images_file_id', 'costume_images', ['file_id'], unique=False)
    op.create_index('ix_costume_images_quality_level', 'costume_images', ['quality_level'], unique=False)
    op.create_index('ix_costume_images_view_angle', 'costume_images', ['view_angle'], unique=False)

    op.create_table(
        'directing_chapter_shooting_explanations',
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('source_version', sa.String(length=64), nullable=False),
        sa.Column('raw_text', sa.Text().with_variant(mysql.MEDIUMTEXT(), 'mysql'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('preparation', sa.JSON(), nullable=False),
        sa.Column('last_request_id', sa.String(length=64), nullable=True),
        sa.Column('last_request_hash', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), 'mysql'), server_default=sa.text(creation_time), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('chapter_id', 'source_version'),
    )

    op.create_table(
        'directing_division_commits',
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('request_id', sa.String(length=64), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('chapter_id', 'request_id'),
    )

    op.create_table(
        'directing_division_versions',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column('origin', sa.String(length=16), nullable=False),
        sa.Column('source_version', sa.String(length=64), nullable=False),
        sa.Column('sequence_count', sa.Integer(), nullable=False),
        sa.Column('source_task_id', sa.String(length=64), nullable=True),
        sa.Column('source_revision_id', sa.String(length=64), nullable=True),
        sa.Column('base_revision_id', sa.String(length=64), nullable=True),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('mapping', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), 'mysql'), server_default=sa.text(creation_time), nullable=False),
        sa.CheckConstraint("origin IN ('manual','ai','restore')", name='ck_division_version_origin'),
        sa.CheckConstraint('number > 0 AND sequence_count >= 0', name='ck_division_version_numbers'),
        sa.ForeignKeyConstraint(['base_revision_id'], ['directing_division_versions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['source_revision_id'], ['directing_division_versions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['source_task_id'], ['tasks.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chapter_id', 'id', name='uq_division_version_chapter_identity'),
        sa.UniqueConstraint('chapter_id', 'number', name='uq_division_version_number'),
    )

    op.create_table(
        'directing_sequences',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('is_current', sa.Boolean(), server_default=sa.text('1'), nullable=False),
        sa.Column('current_position', sa.Integer(), sa.Computed('CASE WHEN is_current THEN position ELSE NULL END', persisted=True), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('source', sa.JSON(), nullable=False),
        sa.Column('source_start', sa.Integer(), nullable=True),
        sa.Column('source_end', sa.Integer(), nullable=True),
        sa.Column('source_text', sa.Text(), server_default=sa.text("('')"), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('object_preparation', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('position >= 0 AND version > 0', name='ck_directing_sequence_numbers'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chapter_id', 'current_position', name='uq_directing_sequence_current_position'),
    )
    op.create_index('ix_directing_sequences_chapter_id', 'directing_sequences', ['chapter_id'], unique=False)

    op.create_table(
        'file_usages',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='行 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=False, comment='文件 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=True, comment='项目 ID（独立画布可空）'),
        sa.Column('chapter_id', sa.String(length=64), nullable=True, comment='章节 ID（可空）'),
        sa.Column('usage_kind', sa.String(length=32), nullable=False, comment='用途类型'),
        sa.Column('source_ref', sa.String(length=128), nullable=False, comment='幂等键（如同一槽位 upsert；无则空串）'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('file_id', 'project_id', 'usage_kind', 'source_ref', name='uq_file_usages_file_project_kind_ref'),
    )
    op.create_index('ix_file_usages_chapter_id', 'file_usages', ['chapter_id'], unique=False)
    op.create_index('ix_file_usages_file_id', 'file_usages', ['file_id'], unique=False)
    op.create_index('ix_file_usages_project_id', 'file_usages', ['project_id'], unique=False)
    op.create_index('ix_file_usages_usage_kind', 'file_usages', ['usage_kind'], unique=False)

    op.create_table(
        'project_actor_links',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='关联行 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='项目 ID'),
        sa.Column('chapter_id', sa.String(length=64), nullable=True, comment='章节 ID'),
        sa.Column('actor_id', sa.String(length=64), nullable=False, comment='演员 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['actors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('actor_id', 'project_id', 'chapter_id', name='uq_project_actor_links_actor_scope'),
    )
    op.create_index('ix_project_actor_links_actor_id', 'project_actor_links', ['actor_id'], unique=False)
    op.create_index('ix_project_actor_links_chapter_id', 'project_actor_links', ['chapter_id'], unique=False)
    op.create_index('ix_project_actor_links_project_id', 'project_actor_links', ['project_id'], unique=False)

    op.create_table(
        'project_costume_links',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='关联行 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='项目 ID'),
        sa.Column('chapter_id', sa.String(length=64), nullable=True, comment='章节 ID'),
        sa.Column('costume_id', sa.String(length=64), nullable=False, comment='服装 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['costume_id'], ['costumes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('costume_id', 'project_id', 'chapter_id', name='uq_project_costume_links_costume_scope'),
    )
    op.create_index('ix_project_costume_links_chapter_id', 'project_costume_links', ['chapter_id'], unique=False)
    op.create_index('ix_project_costume_links_costume_id', 'project_costume_links', ['costume_id'], unique=False)
    op.create_index('ix_project_costume_links_project_id', 'project_costume_links', ['project_id'], unique=False)

    op.create_table(
        'project_prop_links',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='关联行 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='项目 ID'),
        sa.Column('chapter_id', sa.String(length=64), nullable=True, comment='章节 ID'),
        sa.Column('prop_id', sa.String(length=64), nullable=False, comment='道具 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prop_id'], ['props.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('prop_id', 'project_id', 'chapter_id', name='uq_project_prop_links_prop_scope'),
    )
    op.create_index('ix_project_prop_links_chapter_id', 'project_prop_links', ['chapter_id'], unique=False)
    op.create_index('ix_project_prop_links_project_id', 'project_prop_links', ['project_id'], unique=False)
    op.create_index('ix_project_prop_links_prop_id', 'project_prop_links', ['prop_id'], unique=False)

    op.create_table(
        'project_scene_links',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='关联行 ID'),
        sa.Column('project_id', sa.String(length=64), nullable=False, comment='项目 ID'),
        sa.Column('chapter_id', sa.String(length=64), nullable=True, comment='章节 ID'),
        sa.Column('scene_id', sa.String(length=64), nullable=False, comment='场景 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scene_id', 'project_id', 'chapter_id', name='uq_project_scene_links_scene_scope'),
    )
    op.create_index('ix_project_scene_links_chapter_id', 'project_scene_links', ['chapter_id'], unique=False)
    op.create_index('ix_project_scene_links_project_id', 'project_scene_links', ['project_id'], unique=False)
    op.create_index('ix_project_scene_links_scene_id', 'project_scene_links', ['scene_id'], unique=False)

    op.create_table(
        'prop_images',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='图片行 ID'),
        sa.Column('prop_id', sa.String(length=64), nullable=False, comment='所属道具 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=True, comment='关联的文件 ID（FileItem，可空，支持先创建槽位后填充）'),
        sa.Column('quality_level', sa.String(length=16), nullable=False),
        sa.Column('view_angle', sa.String(length=32), nullable=False),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('format', sa.String(length=32), nullable=False),
        sa.Column('prompt_overrides', sa.JSON(), nullable=False, comment='此图片的展示提示词变量覆盖'),
        sa.Column('version_id', sa.Integer(), nullable=False, comment='槽位 CAS 版本'),
        sa.Column('is_view_default', sa.Boolean(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prop_id'], ['props.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_prop_images_file_id', 'prop_images', ['file_id'], unique=False)
    op.create_index('ix_prop_images_prop_id', 'prop_images', ['prop_id'], unique=False)
    op.create_index('ix_prop_images_quality_level', 'prop_images', ['quality_level'], unique=False)
    op.create_index('ix_prop_images_view_angle', 'prop_images', ['view_angle'], unique=False)

    op.create_table(
        'scene_images',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, comment='图片行 ID'),
        sa.Column('scene_id', sa.String(length=64), nullable=False, comment='所属场景 ID'),
        sa.Column('file_id', sa.String(length=64), nullable=True, comment='关联的文件 ID（FileItem，可空，支持先创建槽位后填充）'),
        sa.Column('quality_level', sa.String(length=16), nullable=False, comment='精度等级'),
        sa.Column('view_angle', sa.String(length=32), nullable=False, comment='视角'),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('format', sa.String(length=32), nullable=False),
        sa.Column('prompt_overrides', sa.JSON(), nullable=False, comment='此图片的展示提示词变量覆盖'),
        sa.Column('version_id', sa.Integer(), nullable=False, comment='槽位 CAS 版本'),
        sa.Column('is_view_default', sa.Boolean(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scene_images_file_id', 'scene_images', ['file_id'], unique=False)
    op.create_index('ix_scene_images_quality_level', 'scene_images', ['quality_level'], unique=False)
    op.create_index('ix_scene_images_scene_id', 'scene_images', ['scene_id'], unique=False)
    op.create_index('ix_scene_images_view_angle', 'scene_images', ['view_angle'], unique=False)

    op.create_table(
        'directing_batches',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(mysql.DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status IN ('prepared','submitted')", name='ck_directing_batch_status'),
        sa.CheckConstraint('version > 0', name='ck_directing_batch_version'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_directing_batches_sequence_id', 'directing_batches', ['sequence_id'], unique=False)

    op.create_table(
        'directing_division_heads',
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('revision_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id', 'revision_id'], ['directing_division_versions.chapter_id', 'directing_division_versions.id'], name='fk_division_head_version', ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('chapter_id'),
    )

    op.create_table(
        'directing_revisions',
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), 'mysql'), server_default=sa.text(creation_time), nullable=False),
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('parent_id', sa.String(length=64), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('display_number', sa.Integer(), nullable=True, comment='指令在固定计划与单元内的不可变展示编号'),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('source_key', sa.String(length=64), nullable=True),
        sa.Column('source_task_id', sa.String(length=64), nullable=True),
        sa.Column('confirmed_by', sa.String(length=64), nullable=True),
        sa.Column('confirmed_at', sa.DateTime().with_variant(mysql.DATETIME(fsp=6), 'mysql'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("kind IN ('design','plan','prompt','review','cut','cut_review','repair','knowledge')", name='ck_directing_revision_kind'),
        sa.CheckConstraint('(confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)', name='ck_directing_revision_confirmation'),
        sa.CheckConstraint('version > 0', name='ck_directing_revision_version'),
        sa.ForeignKeyConstraint(['parent_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['source_task_id'], ['tasks.id'], name='fk_directing_revision_source_task', ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_task_id', name='uq_directing_revision_source_task'),
    )
    op.create_index('ix_directing_revisions_sequence_id', 'directing_revisions', ['sequence_id'], unique=False)

    op.create_table(
        'generation_canvases',
        sa.Column('created_at', sa.DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), 'mysql'), server_default=sa.text(creation_time), nullable=False),
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('project_id', sa.String(length=64), nullable=True),
        sa.Column('kind', sa.String(length=16), server_default='free', nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('document', sa.JSON(), nullable=False),
        sa.Column('card_types', sa.JSON(), nullable=False),
        sa.Column('check_edge_revisions', sa.JSON(), nullable=True),
        sa.Column('detached_proofs', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], name='fk_generation_canvas_sequence', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_generation_canvases_project_id', 'generation_canvases', ['project_id'], unique=False)
    op.create_index('ix_generation_canvases_sequence_id', 'generation_canvases', ['sequence_id'], unique=False)

    op.create_table(
        'directing_actions',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('revision_id', sa.String(length=64), nullable=False),
        sa.Column('action', sa.String(length=16), nullable=False),
        sa.Column('actor_id', sa.String(length=64), nullable=False),
        sa.Column('displayed_label', sa.String(length=128), nullable=False),
        sa.Column('unit_id', sa.String(length=64), nullable=False),
        sa.Column('review_revision_id', sa.String(length=64), nullable=True),
        sa.Column('request_id', sa.String(length=64), nullable=True),
        sa.Column('task_id', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("action IN ('compile','execute')", name='ck_directing_action_kind'),
        sa.ForeignKeyConstraint(['review_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('request_id'),
        sa.UniqueConstraint('task_id'),
    )
    op.create_index('ix_directing_actions_sequence_id', 'directing_actions', ['sequence_id'], unique=False)

    op.create_table(
        'directing_active_cuts',
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('revision_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('sequence_id'),
    )

    op.create_table(
        'directing_batch_items',
        sa.Column('batch_id', sa.String(length=64), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('prompt_revision_id', sa.String(length=64), nullable=False),
        sa.Column('review_revision_id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.CheckConstraint('ordinal >= 0', name='ck_directing_batch_item_ordinal'),
        sa.ForeignKeyConstraint(['batch_id'], ['directing_batches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['review_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('batch_id', 'ordinal'),
        sa.UniqueConstraint('batch_id', 'prompt_revision_id', name='uq_directing_batch_prompt'),
        sa.UniqueConstraint('task_id'),
    )

    op.create_table(
        'directing_repair_plans',
        sa.Column('repair_revision_id', sa.String(length=64), nullable=False),
        sa.Column('plan_revision_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['plan_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['repair_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('repair_revision_id', 'plan_revision_id'),
        sa.UniqueConstraint('plan_revision_id'),
    )

    op.create_table(
        'directing_revision_dependencies',
        sa.Column('revision_id', sa.String(length=64), nullable=False),
        sa.Column('dependency_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['dependency_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('revision_id', 'dependency_id'),
    )

    op.create_table(
        'directing_takes',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('prompt_revision_id', sa.String(length=64), nullable=False),
        sa.Column('plan_revision_id', sa.String(length=64), nullable=False),
        sa.Column('unit_id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('output_ordinal', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(length=64), nullable=False),
        sa.Column('annotation', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('display_number', sa.Integer(), nullable=True, comment='候选在固定计划与单元内的不可变展示编号'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('version > 0 AND output_ordinal >= 0', name='ck_directing_take_numbers'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['plan_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['prompt_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['task_id', 'output_ordinal'], ['task_outputs.task_id', 'task_outputs.ordinal'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'output_ordinal', name='uq_directing_take_output'),
    )
    op.create_index('ix_directing_takes_sequence_id', 'directing_takes', ['sequence_id'], unique=False)

    op.create_table(
        'generation_canvas_check_reports',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('check_card_id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('report', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_generation_canvas_check_reports_canvas_id', 'generation_canvas_check_reports', ['canvas_id'], unique=False)

    op.create_table(
        'generation_canvas_event_heads',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('cursor', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id'),
    )

    op.create_table(
        'generation_canvas_events',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('cursor', sa.Integer(), nullable=False),
        sa.Column('envelope', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'cursor'),
    )

    op.create_table(
        'generation_canvas_previews',
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('token'),
    )
    op.create_index('ix_generation_canvas_previews_canvas_id', 'generation_canvas_previews', ['canvas_id'], unique=False)

    op.create_table(
        'generation_canvas_run_receipts',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('request_id', sa.String(length=64), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'request_id'),
    )

    op.create_table(
        'generation_canvas_runs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('lifecycle', sa.String(length=16), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_generation_canvas_runs_canvas_id', 'generation_canvas_runs', ['canvas_id'], unique=False)

    op.create_table(
        'generation_canvas_save_receipts',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('request_id', sa.String(length=64), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'request_id'),
    )

    op.create_table(
        'directing_cut_frames',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('cut_revision_id', sa.String(length=64), nullable=False),
        sa.Column('item_id', sa.String(length=64), nullable=False),
        sa.Column('take_id', sa.String(length=64), nullable=False),
        sa.Column('file_id', sa.String(length=64), nullable=False),
        sa.Column('source_in_ms', sa.Integer(), nullable=False),
        sa.Column('source_out_ms', sa.Integer(), nullable=False),
        sa.Column('at_ms', sa.Integer(), nullable=False),
        sa.Column('edge', sa.String(length=8), nullable=False),
        sa.CheckConstraint("edge IN ('start','end')", name='ck_directing_frame_edge'),
        sa.CheckConstraint('source_in_ms >= 0 AND source_out_ms > source_in_ms AND at_ms >= source_in_ms AND at_ms < source_out_ms', name='ck_directing_frame_range'),
        sa.ForeignKeyConstraint(['cut_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['take_id'], ['directing_takes.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('file_id'),
    )
    op.create_index('ix_directing_cut_frames_sequence_id', 'directing_cut_frames', ['sequence_id'], unique=False)

    op.create_table(
        'directing_cut_take_references',
        sa.Column('revision_id', sa.String(length=64), nullable=False),
        sa.Column('take_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['revision_id'], ['directing_revisions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['take_id'], ['directing_takes.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('revision_id', 'take_id'),
    )

    op.create_table(
        'generation_canvas_run_nodes',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('run_id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=True),
        sa.Column('execution_snapshot', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('stage', sa.String(length=64), nullable=False),
        sa.Column('progress', sa.Integer(), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('basis', sa.JSON(), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('outputs', sa.JSON(), nullable=False),
        sa.Column('result_set_id', sa.String(length=64), nullable=True),
        sa.Column('current_output_updated', sa.Boolean(), nullable=False),
        sa.Column('error_code', sa.String(length=64), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['run_id'], ['generation_canvas_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_generation_canvas_run_nodes_canvas_id', 'generation_canvas_run_nodes', ['canvas_id'], unique=False)
    op.create_index('ix_generation_canvas_run_nodes_run_id', 'generation_canvas_run_nodes', ['run_id'], unique=False)

    op.create_table(
        'directing_chapter_transitions',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('chapter_id', sa.String(length=64), nullable=False),
        sa.Column('left_sequence_id', sa.String(length=64), nullable=False),
        sa.Column('right_sequence_id', sa.String(length=64), nullable=False),
        sa.Column('left_cut_revision_id', sa.String(length=64), nullable=False),
        sa.Column('right_cut_revision_id', sa.String(length=64), nullable=False),
        sa.Column('left_frame_id', sa.String(length=64), nullable=False),
        sa.Column('right_frame_id', sa.String(length=64), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('actor_id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(mysql.DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['left_cut_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['left_frame_id'], ['directing_cut_frames.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['left_sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['right_cut_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['right_frame_id'], ['directing_cut_frames.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['right_sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_directing_chapter_transitions_chapter_id', 'directing_chapter_transitions', ['chapter_id'], unique=False)

    op.create_table(
        'directing_seam_reviews',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('sequence_id', sa.String(length=64), nullable=False),
        sa.Column('cut_revision_id', sa.String(length=64), nullable=False),
        sa.Column('left_frame_id', sa.String(length=64), nullable=False),
        sa.Column('right_frame_id', sa.String(length=64), nullable=False),
        sa.Column('verdict', sa.String(length=8), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=False),
        sa.Column('actor_id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime().with_variant(mysql.DATETIME(fsp=6), 'mysql'), nullable=False),
        sa.CheckConstraint("verdict IN ('pass','revise')", name='ck_directing_seam_verdict'),
        sa.ForeignKeyConstraint(['cut_revision_id'], ['directing_revisions.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['left_frame_id'], ['directing_cut_frames.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['right_frame_id'], ['directing_cut_frames.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['sequence_id'], ['directing_sequences.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_directing_seam_reviews_sequence_id', 'directing_seam_reviews', ['sequence_id'], unique=False)

    op.create_table(
        'generation_canvas_occupancies',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('node_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['generation_canvas_run_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'card_id'),
    )

    op.create_table(
        'generation_canvas_result_sets',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('node_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('basis_hash', sa.String(length=64), nullable=False),
        sa.Column('basis', sa.JSON(), nullable=False),
        sa.Column('outputs', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['node_id'], ['generation_canvas_run_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_generation_canvas_result_sets_canvas_id', 'generation_canvas_result_sets', ['canvas_id'], unique=False)

    op.create_table(
        'generation_canvas_current_outputs',
        sa.Column('canvas_id', sa.String(length=64), nullable=False),
        sa.Column('card_id', sa.String(length=64), nullable=False),
        sa.Column('result_set_id', sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(['canvas_id'], ['generation_canvases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['result_set_id'], ['generation_canvas_result_sets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('canvas_id', 'card_id'),
    )


def downgrade() -> None:
    """Require an explicit database restore before removing the baseline."""
    raise RuntimeError("Restore the database from backup to revert the initial schema")
