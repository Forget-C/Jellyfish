"""冻结迁移与 ORM 的一致性、外键、唯一约束及后续升级路径。"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.db import Base
import app.models


def revision_module():
    """加载独立版本脚本，不从运行模型生成迁移内容。"""
    path = Path(__file__).parents[2] / "alembic/versions/24c8e1a6b902_add_directing_foundation.py"
    spec = importlib.util.spec_from_file_location("directing_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_foundation_migration_and_next_upgrade():
    """在旧模型空库上执行新迁移，再带数据运行独立后继升级并校验约束。"""
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(connection, tables=[t for t in Base.metadata.sorted_tables if not t.name.startswith("directing_")])
        migration = revision_module()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert not compare_metadata(context, Base.metadata)
        connection.execute(sa.text("INSERT INTO projects (id,name,description,style,visual_style,seed,unify_style,progress,stats) VALUES ('p','p','','drama','live_action',0,1,0,'{}')"))
        connection.execute(sa.text("INSERT INTO chapters (id,project_id,`index`,title,summary,raw_text,condensed_text,storyboard_count,status) VALUES ('ch','p',1,'ch','','','',0,'draft')"))
        connection.execute(sa.text("INSERT INTO directing_sequences (id,chapter_id,position,title,source,version) VALUES ('seq','ch',0,'scene','{}',1)"))
        for statement in (
            "INSERT INTO directing_sequences (id,chapter_id,position,title,source,version) VALUES ('bad','missing',1,'scene','{}',1)",
            "INSERT INTO directing_sequences (id,chapter_id,position,title,source,version) VALUES ('bad','ch',0,'scene','{}',1)",
            "INSERT INTO directing_sequences (id,chapter_id,position,title,source,version) VALUES ('bad','ch',1,'scene','{}',0)",
        ):
            with pytest.raises(sa.exc.IntegrityError):
                connection.execute(sa.text(statement))
        # A real follow-on ALTER through Alembic must preserve existing scene data.
        migration.op.add_column("directing_sequences", sa.Column("migration_probe", sa.String(16), nullable=True))
        assert connection.scalar(sa.text("SELECT title FROM directing_sequences WHERE id='seq'")) == "scene"
        migration.op.drop_column("directing_sequences", "migration_probe")
        assert not compare_metadata(context, Base.metadata)
        migration.downgrade()
        assert "directing_sequences" not in sa.inspect(connection).get_table_names()
        assert connection.scalar(sa.text("SELECT title FROM chapters WHERE id='ch'")) == "ch"
    engine.dispose()
