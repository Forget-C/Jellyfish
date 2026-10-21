"""显式升级旧审片数据，普通版本读取不承担历史正文回填。"""
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from tests.directing.test_migration import revision_module
from tests.directing.samples import editable_design_sample


def test_review_basis_upgrade_backfills_old_json_and_downgrades_without_losing_evidence():
    engine = sa.create_engine('sqlite://')
    old = {'basis': {'source': {'kind': 'chapter', 'reference': 'c', 'version': '1'}, 'text': '原文'},
        'design': editable_design_sample(),
        'units': [{'id': 'u', 'ratio': '16:9', 'parameters': {'seed': 1}, 'coverage': [{'id': 'coverage', 'shot_id': 's1'}]}]}
    equivalent = {**old, 'units': [{'coverage': [{'id': 'coverage', 'shot_id': 's1'}], 'parameters': {'seed': 1.0}, 'ratio': '16:9', 'id': 'u'}], 'timeline': {'items': []}}
    metadata = sa.MetaData()
    tables = [sa.Table(name, metadata, sa.Column('id', sa.String(64), primary_key=True), sa.Column('version_id', sa.String(64)),
        sa.Column('take_kind', sa.String(32)), sa.Column('take_id', sa.String(64)), sa.Column('content', sa.JSON()))
        for name in ['directing_scene_take_reviews', 'directing_scene_cut_reviews']]
    with engine.begin() as connection:
        metadata.create_all(connection)
        historical = [{'id': f'old-{index:03}', 'version_id': 'v', 'take_kind': 'scene_video', 'take_id': 't', 'content': old if index % 2 else equivalent} for index in range(70)]
        for table in tables:
            connection.execute(table.insert(), historical + [{'id': 'a', 'version_id': 'v', 'take_kind': 'scene_video', 'take_id': 't', 'content': old},
                {'id': 'b', 'version_id': 'v', 'take_kind': 'scene_video', 'take_id': 't', 'content': equivalent}])
        migration = revision_module('b4e8f2a6c735_index_scene_review_bases.py')
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        for table in tables:
            columns = {column['name']: column for column in sa.inspect(connection).get_columns(table.name)}
            assert columns['basis_key']['nullable'] is False
            keys = connection.execute(sa.text(f'SELECT basis_key FROM {table.name} ORDER BY id')).scalars().all()
            assert len(keys) == 72 and len(keys[0]) == 64 and len(set(keys)) == 1
        migration.downgrade()
        for table in tables:
            assert connection.execute(sa.select(table.c.content).where(table.c.id.in_(['a', 'b'])).order_by(table.c.id)).scalars().all() == [old, equivalent]
            assert connection.scalar(sa.select(sa.func.count()).select_from(table)) == 72
            assert 'basis_key' not in {column['name'] for column in sa.inspect(connection).get_columns(table.name)}
