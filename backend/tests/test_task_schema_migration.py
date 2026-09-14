"""任务收敛迁移保留文件身份，拒绝不能无损建立新约束的数据。"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.task import Task, TaskInput, TaskOutput


def load_revision():
    """加载冻结的迁移脚本，不依赖运行环境数据库。"""
    path = Path(__file__).parents[1] / "alembic/versions/13b6a9d2e401_simplify_tasks_and_files.py"
    spec = importlib.util.spec_from_file_location("simplify_task_schema", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def old_schema(connection, migration):
    """创建收缩迁移需要的旧文件和任务结构，保存一条已有文件供升级检查。"""
    metadata = sa.MetaData()
    sa.Table("providers", metadata, sa.Column("id", sa.String(64), primary_key=True))
    files = sa.Table("files", metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("storage_key", sa.String(1024), nullable=False),
        sa.Column("thumbnail", sa.String(1024), nullable=False),
        sa.Column("content_version", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(128)),
    )
    sa.Table("file_usages", metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("file_id", sa.String(64), sa.ForeignKey("files.id"), nullable=False),
        sa.Column("project_id", sa.String(64), nullable=False),
        sa.Column("usage_kind", sa.String(32), nullable=False),
        sa.Column("source_ref", sa.String(128), nullable=False),
        sa.UniqueConstraint("file_id", "usage_kind", "source_ref", name="uq_file_usages_file_kind_ref"),
    )
    for table in migration.OLD_TABLES:
        sa.Table(table, metadata, sa.Column("id", sa.String(64), primary_key=True))
    metadata.create_all(connection)
    connection.execute(files.insert().values(id="old-file", storage_key="files/original.png", thumbnail="", content_version=1))


def test_upgrade_preserves_files_and_creates_current_task_contract():
    """新表列、索引及约束匹配运行模型；旧文件可跨项目引用且对象 key 唯一。"""
    migration = load_revision()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            old_schema(connection, migration)
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()
            inspector = sa.inspect(connection)
            assert not set(migration.OLD_TABLES) & set(inspector.get_table_names())
            for model in (Task, TaskInput, TaskOutput):
                actual_columns = {column["name"] for column in inspector.get_columns(model.__tablename__)}
                assert actual_columns == set(model.__table__.columns.keys())
                assert {index["name"] for index in inspector.get_indexes(model.__tablename__)} == {index.name for index in model.__table__.indexes}
            assert connection.execute(sa.text("SELECT storage_key, content_type FROM files WHERE id='old-file'")).one() == ("files/original.png", "application/octet-stream")
            for project in ("p1", "p2"):
                connection.execute(sa.text("INSERT INTO file_usages (file_id,project_id,usage_kind,source_ref) VALUES ('old-file',:project,'reference','slot')"), {"project": project})
            with pytest.raises(sa.exc.IntegrityError):
                connection.execute(sa.text("INSERT INTO files (id,storage_key,content_type) VALUES ('duplicate','files/original.png','image/png')"))
            with pytest.raises(NotImplementedError):
                migration.downgrade()
    finally:
        engine.dispose()


@pytest.mark.parametrize("key", ["files/original.png", "x" * 701])
def test_invalid_existing_keys_fail_before_schema_changes(key):
    """重复或过长 key 在删表前报错，不自动合并或截断文件身份。"""
    migration = load_revision()
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            old_schema(connection, migration)
            connection.execute(sa.text("INSERT INTO files (id,storage_key,thumbnail,content_version) VALUES ('bad',:key,'',1)"), {"key": key})
            migration.op = Operations(MigrationContext.configure(connection))
            with pytest.raises(RuntimeError):
                migration.upgrade()
            assert set(migration.OLD_TABLES) <= set(sa.inspect(connection).get_table_names())
            assert "tasks" not in sa.inspect(connection).get_table_names()
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_initializer_rejects_unversioned_existing_database(tmp_path, monkeypatch):
    """非空旧库不能自动 stamp；空库和已有版本的库允许交给迁移链处理。"""
    from app.scripts.migrate_database import _check_database_version, settings
    path = tmp_path / "database.sqlite"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{path}")
    await _check_database_version()
    engine = sa.create_engine(f"sqlite:///{path}")
    try:
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE files (id INTEGER PRIMARY KEY)"))
        with pytest.raises(RuntimeError, match="no Alembic version"):
            await _check_database_version()
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        await _check_database_version()
    finally:
        engine.dispose()
