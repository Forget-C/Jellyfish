"""统一生成 P1 expand 迁移的 SQLite 升降级测试。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration_module():
    """直接加载迁移版本文件，避免测试依赖 Alembic 目录包结构。"""

    migration_path = (
        Path(__file__).parents[1]
        / "alembic/versions/d8f4a1e9b702_add_unified_generation_foundation.py"
    )
    spec = importlib.util.spec_from_file_location("unified_generation_expand_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_revision_cleanup_migration():
    """加载 revision 收缩迁移，验证旧库可安全升级到当前结构。"""

    migration_path = (
        Path(__file__).parents[1]
        / "alembic/versions/e2b7c6d9f4a3_remove_model_config_revisions.py"
    )
    spec = importlib.util.spec_from_file_location("remove_model_config_revisions_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_expand_schema(engine: sa.Engine) -> None:
    """创建 P1 迁移所需的最小旧版表结构。"""

    metadata = sa.MetaData()
    sa.Table(
        "generation_tasks",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    sa.Table("models", metadata, sa.Column("id", sa.String(64), primary_key=True))
    sa.Table("files", metadata, sa.Column("id", sa.String(64), primary_key=True))
    sa.Table("shots", metadata, sa.Column("id", sa.String(64), primary_key=True))
    for table_name in (
        "actor_images",
        "character_images",
        "scene_images",
        "prop_images",
        "costume_images",
        "shot_frame_images",
    ):
        sa.Table(table_name, metadata, sa.Column("id", sa.Integer(), primary_key=True))
    metadata.create_all(engine)


def test_unified_generation_expand_migration_upgrades_and_downgrades_sqlite(tmp_path) -> None:
    """P1 expand 迁移应在 SQLite 旧库上完整增加并移除约定的结构。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'unified-generation-expand.db'}", future=True)
    _create_pre_expand_schema(engine)
    migration = _load_migration_module()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        inspector = sa.inspect(connection)
        task_columns = {column["name"] for column in inspector.get_columns("generation_tasks")}
        assert {"visibility", "lease_owner", "lease_epoch", "lease_expires_at", "heartbeat_at"} <= task_columns
        assert "current_revision_id" in {column["name"] for column in inspector.get_columns("models")}
        assert {"content_version", "content_hash"} <= {
            column["name"] for column in inspector.get_columns("files")
        }
        assert "generated_video_version_id" in {
            column["name"] for column in inspector.get_columns("shots")
        }
        assert all(
            "version_id" in {column["name"] for column in inspector.get_columns(table_name)}
            for table_name in (
                "actor_images",
                "character_images",
                "scene_images",
                "prop_images",
                "costume_images",
                "shot_frame_images",
            )
        )
        assert {
            "model_config_revisions",
            "generation_artifacts",
            "generation_task_media_references",
            "generation_dispatch_outbox",
        } <= set(inspector.get_table_names())
        for table_name, column_names in {
            "model_config_revisions": {
                "model_params",
                "endpoint_config",
                "capability_snapshot",
            },
            "generation_artifacts": {"provider_result"},
            "generation_dispatch_outbox": {"payload"},
        }.items():
            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            assert all(columns[column_name]["default"] is None for column_name in column_names)
        artifact_file_foreign_key = next(
            foreign_key
            for foreign_key in inspector.get_foreign_keys("generation_artifacts")
            if foreign_key["constrained_columns"] == ["file_id"]
        )
        assert artifact_file_foreign_key["options"].get("ondelete") == "RESTRICT"

        # MySQL DDL 不可事务回滚，首次失败可能在 Alembic 记录版本前留下部分结构。
        migration.upgrade()

        migration.downgrade()

        inspector = sa.inspect(connection)
        assert {
            "model_config_revisions",
            "generation_artifacts",
            "generation_task_media_references",
            "generation_dispatch_outbox",
        }.isdisjoint(inspector.get_table_names())
        assert "visibility" not in {
            column["name"] for column in inspector.get_columns("generation_tasks")
        }
        assert "current_revision_id" not in {
            column["name"] for column in inspector.get_columns("models")
        }
        assert "content_version" not in {column["name"] for column in inspector.get_columns("files")}

    engine.dispose()


def test_unified_generation_expand_migration_rejects_incomplete_existing_table(tmp_path) -> None:
    """遗留同名表缺少迁移所需结构时，应停止升级而非静默跳过。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'incomplete-generation-expand.db'}", future=True)
    _create_pre_expand_schema(engine)
    metadata = sa.MetaData()
    sa.Table("model_config_revisions", metadata, sa.Column("id", sa.String(64), primary_key=True))
    metadata.create_all(engine)
    migration = _load_migration_module()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        with pytest.raises(RuntimeError, match="Existing table 'model_config_revisions' is incompatible"):
            migration.upgrade()

    engine.dispose()


def test_revision_cleanup_migration_removes_revision_schema_and_repairs_timestamps(tmp_path) -> None:
    """收缩迁移应移除旧 revision 结构，并让异步表可依赖数据库时间默认值写入。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'remove-model-config-revisions.db'}", future=True)
    _create_pre_expand_schema(engine)
    expand_migration = _load_migration_module()
    cleanup_migration = _load_revision_cleanup_migration()

    with engine.begin() as connection:
        expand_migration.op = Operations(MigrationContext.configure(connection))
        expand_migration.upgrade()

        cleanup_migration.op = Operations(MigrationContext.configure(connection))
        cleanup_migration.upgrade()

        inspector = sa.inspect(connection)
        assert "model_config_revisions" not in inspector.get_table_names()
        assert "current_revision_id" not in {
            column["name"] for column in inspector.get_columns("models")
        }
        for table_name in (
            "generation_artifacts",
            "generation_task_media_references",
            "generation_dispatch_outbox",
        ):
            columns = {column["name"]: column for column in inspector.get_columns(table_name)}
            assert columns["created_at"]["default"] is not None
            assert columns["updated_at"]["default"] is not None

        with pytest.raises(NotImplementedError, match="irreversible"):
            cleanup_migration.downgrade()

    engine.dispose()
