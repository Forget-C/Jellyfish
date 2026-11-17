"""画布归属升级保留场次与文件，旧自由画布只通过显式维护退出。"""
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from tests.directing.test_migration import revision_module


def test_independent_ownership_upgrade_classifies_without_deleting_files():
    engine = sa.create_engine('sqlite://')
    metadata = sa.MetaData()
    canvases = sa.Table('generation_canvases', metadata,
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('project_id', sa.String(64), nullable=False),
        sa.Column('sequence_id', sa.String(64)))
    files = sa.Table('files', metadata, sa.Column('id', sa.String(64), primary_key=True))
    usages = sa.Table('file_usages', metadata,
        sa.Column('id', sa.Integer(), primary_key=True), sa.Column('file_id', sa.String(64)),
        sa.Column('project_id', sa.String(64), nullable=False))
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(canvases.insert(), [
                {'id': 'old-free', 'project_id': 'p', 'sequence_id': None},
                {'id': 'storyboard', 'project_id': 'p', 'sequence_id': 'scene'}])
            connection.execute(files.insert().values(id='keep-file'))
            connection.execute(usages.insert().values(id=1, file_id='keep-file', project_id='p'))
            migration = revision_module('c5e12a6b9f03_independent_canvases.py')
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()
            assert connection.execute(sa.text('SELECT id, kind FROM generation_canvases ORDER BY id')).all() == [
                ('old-free', 'free'), ('storyboard', 'scene')]
            assert sa.inspect(connection).get_columns('generation_canvases')[1]['nullable']
            assert next(c for c in sa.inspect(connection).get_columns('file_usages') if c['name'] == 'project_id')['nullable']
            assert connection.scalar(sa.select(files.c.id)) == 'keep-file'
            connection.execute(sa.text("INSERT INTO generation_canvases (id, kind) VALUES ('new-free', 'free')"))
            connection.execute(sa.text("INSERT INTO file_usages (id,file_id) VALUES (2,'keep-file')"))
    finally:
        engine.dispose()


def test_upgrade_refuses_active_legacy_canvas_before_schema_changes():
    import pytest
    engine = sa.create_engine('sqlite://')
    try:
        with engine.begin() as connection:
            connection.execute(sa.text('CREATE TABLE generation_canvases (id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(64) NOT NULL, sequence_id VARCHAR(64))'))
            connection.execute(sa.text('CREATE TABLE generation_canvas_occupancies (canvas_id VARCHAR(64))'))
            connection.execute(sa.text("INSERT INTO generation_canvases VALUES ('old','p',NULL)"))
            connection.execute(sa.text("INSERT INTO generation_canvas_occupancies VALUES ('old')"))
            migration = revision_module('c5e12a6b9f03_independent_canvases.py')
            migration.op = Operations(MigrationContext.configure(connection))
            with pytest.raises(RuntimeError, match='active tasks'):
                migration.upgrade()
            assert 'kind' not in {column['name'] for column in sa.inspect(connection).get_columns('generation_canvases')}
            assert connection.scalar(sa.text('SELECT COUNT(*) FROM generation_canvases')) == 1
    finally:
        engine.dispose()
