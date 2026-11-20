"""Verify the new database entrypoints against a disposable empty database."""

import os
from pathlib import Path
import subprocess
import sys

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory


BACKEND = Path(__file__).resolve().parents[1]


def test_initial_revision_is_a_frozen_root():
    scripts = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    assert scripts.get_bases() == ["68e14fd0c209"]
    assert len(scripts.get_heads()) == 1


def test_empty_database_is_migrated_and_seeded_without_replacing_user_data(tmp_path):
    path = tmp_path / "baseline.sqlite"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{path}"}

    def run(module, *, success=True):
        result = subprocess.run(
            [sys.executable, "-m", f"app.scripts.{module}"],
            cwd=BACKEND, env=env, check=False, capture_output=True, text=True,
        )
        assert (result.returncode == 0) == success, result.stderr
        return result.stderr

    engine = sa.create_engine(f"sqlite:///{path}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE manually_created (id INTEGER PRIMARY KEY)")
        assert "non-empty but has no Alembic version" in run("migrate_database", success=False)
        with engine.begin() as connection:
            assert sa.inspect(connection).get_table_names() == ["manually_created"]
            connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
        assert "non-empty but has no Alembic version" in run("migrate_database", success=False)
        with engine.begin() as connection:
            assert sa.inspect(connection).get_table_names() == ["alembic_version", "manually_created"]
            connection.exec_driver_sql("DROP TABLE manually_created")
            connection.exec_driver_sql("DROP TABLE alembic_version")

        run("migrate_database")
        run("seed_system_data")
        with engine.begin() as connection:
            assert connection.exec_driver_sql(
                "SELECT id, api_timeout, log_level FROM model_settings"
            ).all() == [(1, 30, "info")]
            connection.exec_driver_sql("UPDATE model_settings SET api_timeout = 45 WHERE id = 1")
            connection.exec_driver_sql(
                "INSERT INTO prompt_templates "
                "(id, name, category, preview, content, variables, variable_defaults, created_at, updated_at, is_system, is_default, version) "
                "VALUES ('user-template', 'User template', 'actor_image', '', 'Custom content', '[]', '{}', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 1)"
            )

        run("migrate_database")
        run("seed_system_data")
        with engine.begin() as connection:
            assert connection.exec_driver_sql(
                "SELECT id, api_timeout, log_level FROM model_settings"
            ).all() == [(1, 45, "info")]
            assert connection.exec_driver_sql(
                "SELECT id FROM prompt_templates WHERE is_system ORDER BY id"
            ).scalars().all() == [
                "system_actor_image", "system_character_image", "system_costume_image", "system_prop_image",
            ]
            assert connection.exec_driver_sql(
                "SELECT content FROM prompt_templates WHERE id = 'user-template'"
            ).scalar_one() == "Custom content"
    finally:
        engine.dispose()
