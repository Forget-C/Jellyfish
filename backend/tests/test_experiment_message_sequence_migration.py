"""实验室消息稳定序号迁移测试。"""

from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration_module():
    """从版本文件加载本轮迁移，避免依赖 Alembic 目录成为 Python 包。"""

    migration_path = (
        Path(__file__).parents[1]
        / "alembic/versions/c6e2f4a9b301_add_experiment_message_sequence.py"
    )
    spec = importlib.util.spec_from_file_location("experiment_message_sequence_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_message_sequence_migration_backfills_counter_and_downgrades(tmp_path) -> None:
    """迁移应回填消息序号与会话计数器，并可完整降级。"""

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'message-sequence.db'}", future=True)
    metadata = sa.MetaData()
    sessions = sa.Table(
        "experiment_sessions",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
    )
    messages = sa.Table(
        "experiment_messages",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    metadata.create_all(engine)

    migration = _load_migration_module()
    with engine.begin() as connection:
        connection.execute(sessions.insert(), [{"id": "session-1", "title": "测试"}])
        timestamp = datetime(2026, 7, 21, 10, 0, 0)
        connection.execute(
            messages.insert(),
            [
                {
                    "id": "message-a-task",
                    "session_id": "session-1",
                    "role": "task",
                    "created_at": timestamp,
                },
                {
                    "id": "message-z-user",
                    "session_id": "session-1",
                    "role": "user",
                    "created_at": timestamp,
                },
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        rows = connection.execute(
            sa.text("SELECT id, sequence FROM experiment_messages ORDER BY sequence")
        ).all()
        counter = connection.execute(
            sa.text("SELECT message_sequence FROM experiment_sessions WHERE id = 'session-1'")
        ).scalar_one()
        assert rows == [("message-z-user", 1), ("message-a-task", 2)]
        assert counter == 2

        migration.downgrade()
        assert "sequence" not in {
            column["name"] for column in sa.inspect(connection).get_columns("experiment_messages")
        }
        assert "message_sequence" not in {
            column["name"] for column in sa.inspect(connection).get_columns("experiment_sessions")
        }

    engine.dispose()
