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
        review_source = revision_module("9bf5b2f0c813_add_review_source_task.py")
        review_source.op = migration.op
        review_source.upgrade()
        display_numbers = revision_module("a1c4e7b9d205_add_directing_display_numbers.py")
        display_numbers.op = migration.op
        display_numbers.upgrade()
        division = revision_module("b2d6e8f0a413_add_chapter_division_membership.py")
        division.op = migration.op
        division.upgrade()
        versions = revision_module("c3e7f9a1b524_add_chapter_division_versions.py")
        versions.op = migration.op
        versions.upgrade()
        scene_versions = revision_module('d4f8a2c6e735_add_scene_versions.py')
        scene_versions.op = migration.op
        scene_versions.upgrade()
        instruction_bases = revision_module("e5a9b3d7f846_add_instruction_bases.py")
        instruction_bases.op = migration.op
        instruction_bases.upgrade()
        scene_video = revision_module("f6b0c4e8a957_add_scene_video_execution.py")
        scene_video.op = migration.op
        scene_video.upgrade()
        take_reviews = revision_module('a7d1e5f9b068_add_scene_take_reviews.py')
        take_reviews.op = migration.op
        take_reviews.upgrade()
        cut_reviews = revision_module('b8e2f6a0c179_add_scene_cut_reviews.py')
        cut_reviews.op = migration.op
        cut_reviews.upgrade()
        seam_reviews = revision_module('c9f3a7b1d280_add_scene_seam_reviews.py')
        seam_reviews.op = migration.op
        seam_reviews.upgrade()
        end_frames = revision_module('d0a4b8c2e391_add_scene_end_frames.py')
        end_frames.op = migration.op
        end_frames.upgrade()
        deliveries = revision_module('e1b5c9d3f402_add_scene_deliveries.py')
        deliveries.op = migration.op
        deliveries.upgrade()
        copies = revision_module('f2c6d0e4a513_add_scene_copy_origins.py')
        copies.op = migration.op
        copies.upgrade()
        unit_identities = revision_module('a3d7e1f5b624_add_scene_unit_identities.py')
        unit_identities.op = migration.op
        unit_identities.upgrade()
        review_bases = revision_module('b4e8f2a6c735_index_scene_review_bases.py')
        review_bases.op = migration.op
        review_bases.upgrade()
        seam_bases = revision_module('c5f9a3b7d846_index_scene_seam_review_bases.py')
        seam_bases.op = migration.op
        seam_bases.upgrade()
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert not compare_metadata(context, Base.metadata)
        connection.execute(sa.text("INSERT INTO projects (id,name,description,style,visual_style,seed,unify_style,progress,stats) VALUES ('p','p','','drama','live_action',0,1,0,'{}')"))
        connection.execute(sa.text("INSERT INTO chapters (id,project_id,`index`,title,summary,raw_text,condensed_text,status) VALUES ('ch','p',1,'ch','','','','draft')"))
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
        connection.execute(sa.text("INSERT INTO directing_scene_versions (id,sequence_id,title,revision,source_bases,content,create_request_id) VALUES ('v','seq','v',1,'[]','{}','request')"))
        connection.execute(sa.text("INSERT INTO directing_instruction_bases (id,version_id,unit_id,request_id,request_hash,inputs,instruction) VALUES ('basis','v','unit','confirm','hash','{}','text')"))
        with pytest.raises(RuntimeError, match='Instruction bases exist'):
            instruction_bases.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_instruction_bases")) == 1
        connection.execute(sa.text("DELETE FROM directing_instruction_bases"))
        connection.execute(sa.text("INSERT INTO directing_scene_video_executions (id,version_id,unit_id,request_id,request_hash,preparation) VALUES ('execute','v','unit','video','hash','{}')"))
        with pytest.raises(RuntimeError, match='Scene video executions exist'):
            scene_video.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_video_executions")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_video_executions"))
        connection.execute(sa.text("INSERT INTO directing_scene_take_reviews (id,version_id,revision,take_kind,take_id,content,basis_key) VALUES ('review','v',1,'scene_video','take','{}','fixture')"))
        with pytest.raises(RuntimeError, match='Scene take reviews exist'):
            take_reviews.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_take_reviews")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_take_reviews"))
        take_reviews.downgrade()
        connection.execute(sa.text("INSERT INTO directing_scene_cut_reviews (id,version_id,request_id,review,content,basis_key) VALUES ('cut-review','v','request','{}','{}','fixture')"))
        with pytest.raises(RuntimeError, match='Scene cut reviews exist'):
            cut_reviews.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_cut_reviews")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_cut_reviews"))
        connection.execute(sa.text("INSERT INTO directing_scene_seam_reviews (id,version_id,request_id,review,content,basis_key) VALUES ('seam-review','v','request','{}','{}','fixture')"))
        with pytest.raises(RuntimeError, match='Scene seam reviews exist'):
            seam_reviews.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_seam_reviews")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_seam_reviews"))
        connection.execute(sa.text("INSERT INTO directing_scene_end_frames (id,version_id,request_id,request,clip,file_id,at_ms) VALUES ('frame','v','request','{}','{}','file',0)"))
        with pytest.raises(RuntimeError, match='Scene end frames exist'):
            end_frames.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_end_frames")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_end_frames"))
        end_frames.downgrade()
        connection.execute(sa.text("INSERT INTO directing_scene_deliveries (id,sequence_id,version_id,request_id,revision,version_title,content) VALUES ('delivery','seq','v','request',1,'A','{}')"))
        with pytest.raises(RuntimeError, match='Scene deliveries exist'):
            deliveries.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_deliveries")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_deliveries"))
        deliveries.downgrade()
        connection.execute(sa.text("INSERT INTO directing_scene_copy_origins (version_id,source_version_id,request,review_ids) VALUES ('v','v','{}','{}')"))
        with pytest.raises(RuntimeError, match='Scene copy origins exist'):
            copies.downgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM directing_scene_copy_origins")) == 1
        connection.execute(sa.text("DELETE FROM directing_scene_copy_origins"))
        copies.downgrade()
        seam_bases.downgrade()
        seam_reviews.downgrade()
        cut_reviews.downgrade()
        connection.execute(sa.text("DELETE FROM directing_scene_versions"))
        scene_video.downgrade()
        instruction_bases.downgrade()
        scene_versions.downgrade()
        versions.downgrade()
        division.downgrade()
        display_numbers.downgrade()
        review_source.downgrade()
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
        connection.execute(sa.text("INSERT INTO chapters (id,project_id,`index`,title,summary,raw_text,condensed_text,status) VALUES ('ch','p',1,'ch','','','','draft')"))
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


@pytest.mark.parametrize('active', [False, True])
def test_retirement_preserves_assets_and_blocks_active_legacy_tasks(active):
    """旧引用收缩保留章节来源并去重；运行中的旧任务阻止任何结构删除。"""
    migration = revision_module('8ac4e702bf58_retire_shot_workflow.py')
    engine = sa.create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(sa.text('CREATE TABLE tasks (status TEXT, kind TEXT, target_type TEXT)'))
        connection.execute(sa.text('CREATE TABLE chapters (id TEXT PRIMARY KEY, storyboard_count INTEGER)'))
        connection.execute(sa.text("INSERT INTO chapters VALUES ('ch', 2)"))
        connection.execute(sa.text('CREATE TABLE shots (id TEXT PRIMARY KEY, chapter_id TEXT)'))
        connection.execute(sa.text("INSERT INTO shots VALUES ('s1','ch'),('s2','ch')"))
        for table in migration.OLD_TABLES:
            if table != 'shots':
                connection.execute(sa.text(f'CREATE TABLE {table} (id TEXT PRIMARY KEY)'))
        connection.execute(sa.text('CREATE TABLE file_usages (id TEXT PRIMARY KEY, file_id TEXT, chapter_id TEXT, shot_id TEXT REFERENCES shots(id))'))
        connection.execute(sa.text("INSERT INTO file_usages VALUES ('usage','file',NULL,'s1')"))
        for table, kind in migration.LINKS.items():
            connection.execute(sa.text(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY, {kind}_id TEXT, project_id TEXT, chapter_id TEXT, shot_id TEXT REFERENCES shots(id), CONSTRAINT uq_{table}_{kind}_scope UNIQUE ({kind}_id,project_id,chapter_id,shot_id))'))
            connection.execute(sa.text(f"INSERT INTO {table} VALUES (1,'asset','p','ch','s1'),(2,'asset','p','ch','s2')"))
        connection.execute(sa.text('CREATE TABLE directing_takes (id TEXT PRIMARY KEY, content TEXT)'))
        connection.execute(sa.text("INSERT INTO directing_takes VALUES ('take','retained')"))
        migration.op = Operations(MigrationContext.configure(connection))
        if active:
            connection.execute(sa.text("INSERT INTO tasks VALUES ('running','video_generation','shot_video')"))
            with pytest.raises(RuntimeError, match='active retired shot tasks'):
                migration.upgrade()
            assert 'shots' in sa.inspect(connection).get_table_names()
            assert connection.scalar(sa.text('SELECT count(*) FROM project_actor_links')) == 2
        else:
            migration.upgrade()
            assert not set(migration.OLD_TABLES) & set(sa.inspect(connection).get_table_names())
            assert connection.execute(sa.text('SELECT file_id,chapter_id FROM file_usages')).one() == ('file','ch')
            for table in migration.LINKS:
                assert connection.scalar(sa.text(f'SELECT count(*) FROM {table}')) == 1
                assert 'shot_id' not in {c['name'] for c in sa.inspect(connection).get_columns(table)}
            assert 'storyboard_count' not in {c['name'] for c in sa.inspect(connection).get_columns('chapters')}
        assert connection.scalar(sa.text('SELECT content FROM directing_takes')) == 'retained'
    engine.dispose()


def test_display_number_backfill_keeps_payloads_and_groups():
    """历史编号只在原排序上分配一次，计划和单元分别计数，降级保留原数据。"""
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE directing_revisions (id TEXT PRIMARY KEY, sequence_id TEXT, kind TEXT, payload TEXT, created_at TEXT)"))
        connection.execute(sa.text("CREATE TABLE directing_takes (id TEXT PRIMARY KEY, sequence_id TEXT, plan_revision_id TEXT, unit_id TEXT, created_at TEXT)"))
        payload = '{"plan_revision_id":"p1","unit_id":"u1","text":"same"}'
        for identity, content in [('z', payload), ('a', payload), ('b', payload.replace('u1', 'u2')), ('c', payload.replace('p1', 'p2'))]:
            connection.execute(sa.text("INSERT INTO directing_revisions VALUES (:id,'s','prompt',:payload,'2026-01-01')"), {'id': identity, 'payload': content})
        for identity, unit in [('z', 'u1'), ('a', 'u1'), ('b', 'u2')]:
            connection.execute(sa.text("INSERT INTO directing_takes VALUES (:id,'s','p1',:unit,'2026-01-01')"), {'id': identity, 'unit': unit})
        migration = revision_module("a1c4e7b9d205_add_directing_display_numbers.py")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert dict(connection.execute(sa.text('SELECT id, display_number FROM directing_revisions')).tuples().all()) == {'a': 1, 'b': 1, 'c': 1, 'z': 2}
        assert dict(connection.execute(sa.text('SELECT id, display_number FROM directing_takes')).tuples().all()) == {'a': 1, 'b': 1, 'z': 2}
        assert connection.scalar(sa.text("SELECT payload FROM directing_revisions WHERE id='a'")) == payload
        migration.downgrade()
        assert connection.scalar(sa.text('SELECT COUNT(*) FROM directing_takes')) == 3
        assert connection.scalar(sa.text("SELECT payload FROM directing_revisions WHERE id='a'")) == payload


def test_scene_copy_migration_has_no_json_literal_default():
    """实际迁移生成的 MySQL DDL 不得含 JSON 字面量默认值。"""
    import io

    output = io.StringIO()
    migration = revision_module('f2c6d0e4a513_add_scene_copy_origins.py')
    migration.op = Operations(MigrationContext.configure(dialect_name='mysql', opts={
        'as_sql': True, 'output_buffer': output,
    }))
    migration.upgrade()
    ddl = output.getvalue()
    assert 'review_ids JSON NOT NULL' in ddl
    assert "review_ids JSON NOT NULL DEFAULT" not in ddl, ddl


def test_unit_identity_migration_preserves_current_and_removed_history():
    """升级登记旧数据中的单元，并保留未采用建议不占用正式身份的边界。"""
    from app.models.studio import Project, Chapter
    from app.models.directing import Sequence, SceneVersionRecord, InstructionBasisRecord, SceneVideoExecution
    from app.models.task import Task

    engine = sa.create_engine('sqlite://')
    with engine.begin() as connection:
        Base.metadata.create_all(connection, tables=[table for table in Base.metadata.sorted_tables
            if table.name != 'directing_scene_unit_identities'])
        connection.execute(Project.__table__.insert().values(id='p', name='project', style='drama'))
        connection.execute(Chapter.__table__.insert().values(id='ch', project_id='p', index=1, title='chapter'))
        connection.execute(Sequence.__table__.insert().values(id='seq', chapter_id='ch', position=0, title='scene', source={}))
        connection.execute(SceneVersionRecord.__table__.insert().values(id='version', sequence_id='seq', title='version',
            source_bases=[], create_request_id='create', content={'units': [{'id': 'current'}]}))
        connection.execute(Task.__table__.insert().values(id='task', kind='directing_unit_design',
            status='succeeded', input_snapshot={'scene_unit_design': {'version_id': 'version',
                'request': {'content': {'units': [{'id': 'removed'}]}}}}, result={'units': [{'id': 'unapplied'}]}))
        connection.execute(InstructionBasisRecord.__table__.insert().values(id='basis', version_id='version',
            unit_id='basis-only', request_id='basis-request', request_hash='basis-hash', inputs={}, instruction='old'))
        connection.execute(SceneVideoExecution.__table__.insert().values(id='execution', version_id='version',
            unit_id='video-only', request_id='video-request', request_hash='video-hash', preparation={}))
        migration = revision_module('a3d7e1f5b624_add_scene_unit_identities.py')
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert set(connection.execute(sa.text('SELECT unit_id FROM directing_scene_unit_identities')).scalars()) == {
            'current', 'removed', 'basis-only', 'video-only'}
        with pytest.raises(RuntimeError, match='preserve'):
            migration.downgrade()
