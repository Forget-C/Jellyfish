"""GenerationRun 与 Artifact 归属迁移的 SQLite 验证。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration(filename: str, module_name: str):
    """按文件名加载迁移模块，使结构测试不依赖 Alembic 命令行环境。"""

    migration_path = Path(__file__).parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(module_name, migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_expand_schema(engine: sa.Engine) -> None:
    """建立统一生成 expand 迁移所需的最小旧库结构。"""

    metadata = sa.MetaData()
    sa.Table("generation_tasks", metadata, sa.Column("id", sa.String(64), primary_key=True), sa.Column("updated_at", sa.DateTime(), nullable=False))
    sa.Table("models", metadata, sa.Column("id", sa.String(64), primary_key=True))
    sa.Table("files", metadata, sa.Column("id", sa.String(64), primary_key=True))
    sa.Table("shots", metadata, sa.Column("id", sa.String(64), primary_key=True))
    for table_name in ("actor_images", "character_images", "scene_images", "prop_images", "costume_images", "shot_frame_images"):
        sa.Table(table_name, metadata, sa.Column("id", sa.Integer(), primary_key=True))
    metadata.create_all(engine)


def test_generation_run_migration_backfills_artifact_ownership_and_constraints(tmp_path) -> None:
    """升级时应为历史 Artifact 建 legacy Run，并约束后续 Run 归属。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'generation-runs.db'}", future=True)
    expand = _load_migration("d8f4a1e9b702_add_unified_generation_foundation.py", "generation_expand")
    run_migration = _load_migration("f1a2b3c4d5e6_add_generation_runs.py", "generation_runs")
    _create_pre_expand_schema(engine)

    with engine.begin() as connection:
        expand.op = Operations(MigrationContext.configure(connection))
        expand.upgrade()
        connection.execute(sa.text("INSERT INTO generation_tasks (id, updated_at, visibility) VALUES ('task-1', CURRENT_TIMESTAMP, 'task_center')"))
        connection.execute(
            sa.text(
                """INSERT INTO generation_artifacts (
                    id, task_id, generation_run_id, modality, ordinal, text_content,
                    provider_result, publish_status, publish_error, created_at, updated_at
                ) VALUES (
                    'artifact-1', 'task-1', NULL, 'image', 0, 'legacy artifact',
                    '{}', 'skipped', 'no_target_slot', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )"""
            )
        )

        run_migration.op = Operations(MigrationContext.configure(connection))
        run_migration.upgrade()

        inspector = sa.inspect(connection)
        assert "generation_runs" in inspector.get_table_names()
        assert connection.execute(sa.text("SELECT generation_run_id FROM generation_artifacts WHERE id = 'artifact-1'")).scalar_one() == "task-1"
        assert connection.execute(sa.text("SELECT task_id, attempt_no, status FROM generation_runs WHERE id = 'task-1'")).one() == ("task-1", 0, "terminal")
        run_fk = next(foreign_key for foreign_key in inspector.get_foreign_keys("generation_artifacts") if foreign_key["name"] == "fk_generation_artifacts_generation_run_id")
        assert run_fk["constrained_columns"] == ["generation_run_id"]
        unique_constraints = {item["name"] for item in inspector.get_unique_constraints("generation_artifacts")}
        assert "uq_generation_artifacts_run_ordinal" in unique_constraints
        assert "uq_generation_artifacts_task_ordinal" not in unique_constraints

        run_migration.downgrade()
        assert connection.execute(sa.text("SELECT generation_run_id FROM generation_artifacts WHERE id = 'artifact-1'")).scalar_one() is None
        assert "generation_runs" not in sa.inspect(connection).get_table_names()

    engine.dispose()


def test_generation_run_dispatch_migration_creates_auditable_work_id_table(tmp_path) -> None:
    """Run 级投递事件应保留 task、Run、epoch 与工作消息的关联。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'generation-run-dispatches.db'}", future=True)
    expand = _load_migration("d8f4a1e9b702_add_unified_generation_foundation.py", "generation_dispatch_expand")
    run_migration = _load_migration("f1a2b3c4d5e6_add_generation_runs.py", "generation_dispatch_runs")
    dispatch_migration = _load_migration(
        "a6b7c8d9e0f1_add_generation_run_dispatches.py",
        "generation_dispatch_events",
    )
    _create_pre_expand_schema(engine)

    with engine.begin() as connection:
        expand.op = Operations(MigrationContext.configure(connection))
        expand.upgrade()
        run_migration.op = Operations(MigrationContext.configure(connection))
        run_migration.upgrade()
        dispatch_migration.op = Operations(MigrationContext.configure(connection))
        dispatch_migration.upgrade()

        inspector = sa.inspect(connection)
        assert "generation_run_dispatches" in inspector.get_table_names()
        assert {index["name"] for index in inspector.get_indexes("generation_run_dispatches")} >= {
            "ix_generation_run_dispatches_run_epoch",
            "ix_generation_run_dispatches_status_delivery_lease",
            "ix_generation_run_dispatches_task_created",
        }
        foreign_keys = inspector.get_foreign_keys("generation_run_dispatches")
        assert {foreign_key["referred_table"] for foreign_key in foreign_keys} == {
            "generation_tasks",
            "generation_runs",
        }

        dispatch_migration.downgrade()
        assert "generation_run_dispatches" not in sa.inspect(connection).get_table_names()

    engine.dispose()
