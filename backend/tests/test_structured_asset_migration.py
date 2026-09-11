"""验证无历史回填的资产表结构更新及系统模板更新。"""

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


def test_asset_schema_upgrade_drops_description_without_copying_history():
    """在隔离数据库执行真实 revision，验证新结构和模板契约。"""
    path = Path(__file__).parents[1] / 'alembic/versions/f2a3b4c5d6e7_structured_asset_fields.py'
    spec = importlib.util.spec_from_file_location('asset_revision', path)
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)
    metadata = sa.MetaData()
    tables = [sa.Table(name, metadata, sa.Column('id', sa.String, primary_key=True), sa.Column('description', sa.Text, nullable=False)) for name in revision.FIELDS]
    templates = sa.Table('prompt_templates', metadata,
        sa.Column('id', sa.String, primary_key=True), sa.Column('category', sa.String), sa.Column('is_system', sa.Boolean),
        sa.Column('content', sa.Text), sa.Column('variables', sa.JSON), sa.Column('variable_defaults', sa.JSON), sa.Column('version', sa.Integer),
    )
    engine = sa.create_engine('sqlite:///:memory:')
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            for table in tables:
                connection.execute(table.insert().values(id='asset', description='不回填的旧描述'))
            connection.execute(templates.insert(), [
                dict(id='system', category='scene_image_front', is_system=True, content='old', variables=[], variable_defaults={}, version=1),
                dict(id='custom', category='actor_image', is_system=False, content='custom', variables=[], variable_defaults={}, version=2),
            ])
            with Operations.context(MigrationContext.configure(connection)):
                revision.upgrade()
            for name, fields in revision.FIELDS.items():
                actual = {column['name'] for column in sa.inspect(connection).get_columns(name)}
                assert set(fields) <= actual and 'description' not in actual
                assert connection.execute(sa.text(f'SELECT supplementary_info FROM {name}')).scalar_one() == ''
            rows = connection.execute(templates.select()).mappings().all()
            system = next(row for row in rows if row['id'] == 'system')
            assert system['version'] == 2 and '{{ description }}' in system['content']
            assert '不替换为棚拍纯色背景' in system['variable_defaults']['background_instruction']
            assert next(row for row in rows if row['id'] == 'custom')['content'] == 'custom'
    finally:
        engine.dispose()
