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


def revision_module(filename="24c8e1a6b902_add_directing_foundation.py"):
    """加载独立版本脚本，不从运行模型生成迁移内容。"""
    path = Path(__file__).parents[2] / "alembic/versions" / filename
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
        workspace = revision_module("35d9f2b7ca03_add_directing_workspace.py")
        workspace.op = migration.op
        workspace.upgrade()
        styles = revision_module("46e0a3c8db14_add_project_styles.py")
        styles.op = migration.op
        styles.upgrade()
        batches = revision_module("57f1b4d9ec25_add_directing_batches.py")
        batches.op = migration.op
        batches.upgrade()
        continuity = revision_module("68a2c5e0fd36_add_actual_continuity.py")
        continuity.op = migration.op
        continuity.upgrade()
        feedback = revision_module("79b3d6f1ae47_add_directing_feedback.py")
        feedback.op = migration.op
        feedback.upgrade()
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
        feedback.downgrade()
        continuity.downgrade()
        batches.downgrade()
        styles.downgrade()
        workspace.downgrade()
        migration.downgrade()
        assert "directing_sequences" not in sa.inspect(connection).get_table_names()
        assert connection.scalar(sa.text("SELECT title FROM chapters WHERE id='ch'")) == "ch"
    engine.dispose()


def test_continuity_migration_preserves_unresolved_dependencies_and_confirmed_cut():
    """有数据升级保留旧依赖身份和确认时间，绝不把计划状态提升为真实证据。"""
    from datetime import datetime
    from copy import deepcopy
    from app.models.directing import DirectingRevision
    from tests.directing.samples import plan_sample

    engine = sa.create_engine('sqlite://')
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        migration = revision_module('68a2c5e0fd36_add_actual_continuity.py')
        migration.op = Operations(MigrationContext.configure(connection))
        migration.downgrade()
        connection.execute(sa.text("INSERT INTO projects (id,name,description,style,visual_style,seed,unify_style,progress,stats) VALUES ('p','p','','drama','live_action',0,1,0,'{}')"))
        connection.execute(sa.text("INSERT INTO chapters (id,project_id,`index`,title,summary,raw_text,condensed_text,storyboard_count,status) VALUES ('ch','p',1,'ch','','','',0,'draft')"))
        connection.execute(sa.text("INSERT INTO directing_sequences (id,chapter_id,position,title,source,version) VALUES ('seq','ch',0,'scene','{}',1)"))
        payload = plan_sample('design')
        payload['units'][1]['depends_on_unit_ids'] = ['u1']
        before = deepcopy(payload)
        table = DirectingRevision.__table__
        moment = datetime(2026, 1, 1)
        connection.execute(table.insert().values(id='plan', sequence_id='seq', kind='plan', payload=payload,
            version=2, confirmed_at=moment, confirmed_by='author'))
        connection.execute(table.insert().values(id='cut', sequence_id='seq', kind='cut', payload={'items': []},
            version=2, confirmed_at=moment, confirmed_by='author'))
        migration.upgrade()
        row = connection.execute(sa.select(table).where(table.c.id == 'plan')).mappings().one()
        assert row['confirmed_at'] == moment and row['version'] == 2
        assert row['payload']['units'][1]['dependencies'] == [{'plan_revision_id': 'plan', 'unit_id': 'u1', 'frame_id': None, 'reference_id': None}]
        assert connection.scalar(sa.text('SELECT revision_id FROM directing_active_cuts')) == 'cut'
        assert connection.scalar(sa.text('SELECT count(*) FROM directing_cut_frames')) == 0
        migration.downgrade()
        restored = connection.scalar(sa.select(table.c.payload).where(table.c.id == 'plan'))
        # 缺省空列表可显式化，但原依赖和覆盖内容不得丢失。
        assert restored['units'][1]['depends_on_unit_ids'] == before['units'][1]['depends_on_unit_ids']
        assert restored['units'][0]['coverage'] == before['units'][0]['coverage']
    engine.dispose()
