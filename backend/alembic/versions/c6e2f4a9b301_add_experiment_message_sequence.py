"""add per-session experiment message sequence

Revision ID: c6e2f4a9b301
Revises: b4d7f1a8c2e0
Create Date: 2026-07-21
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c6e2f4a9b301"
down_revision: str | Sequence[str] | None = "b4d7f1a8c2e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill_message_sequences() -> None:
    """回填消息顺序，并让每个会话计数器追平其当前最大序号。

    不依赖窗口函数，避免因 SQLite 或旧版 MySQL 的能力差异导致迁移失败。
    旧 MySQL 可能把同一提交的微秒差截断；同一时间戳内显式让 user 排在
    task/assistant 前，避免继续用随机 UUID 固化已知的气泡翻转。
    """
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, session_id, role FROM experiment_messages "
            "ORDER BY session_id ASC, created_at ASC, "
            "CASE WHEN role = 'user' THEN 0 ELSE 1 END ASC, id ASC"
        )
    ).mappings()
    sequence_by_session: dict[str, int] = {}
    updates: list[dict[str, str | int]] = []
    for row in rows:
        session_id = row["session_id"]
        sequence = sequence_by_session.get(session_id, 0) + 1
        sequence_by_session[session_id] = sequence
        updates.append({"id": row["id"], "sequence": sequence})

    if updates:
        bind.execute(
            sa.text("UPDATE experiment_messages SET sequence = :sequence WHERE id = :id"),
            updates,
        )
    bind.execute(sa.text("UPDATE experiment_sessions SET message_sequence = 0"))
    bind.execute(
        sa.text(
            "UPDATE experiment_sessions SET message_sequence = ("
            "SELECT COALESCE(MAX(sequence), 0) FROM experiment_messages "
            "WHERE experiment_messages.session_id = experiment_sessions.id)"
        )
    )


def upgrade() -> None:
    """增加会话消息计数器与稳定序号，并回填存量记录。"""
    inspector = sa.inspect(op.get_bind())
    session_column_names = {column["name"] for column in inspector.get_columns("experiment_sessions")}
    if "message_sequence" not in session_column_names:
        op.add_column(
            "experiment_sessions",
            sa.Column("message_sequence", sa.Integer(), nullable=False, server_default="0"),
        )

    inspector = sa.inspect(op.get_bind())
    column_names = {column["name"] for column in inspector.get_columns("experiment_messages")}
    if "sequence" not in column_names:
        op.add_column("experiment_messages", sa.Column("sequence", sa.Integer(), nullable=True))
    _backfill_message_sequences()

    sequence_column = next(
        column for column in sa.inspect(op.get_bind()).get_columns("experiment_messages")
        if column["name"] == "sequence"
    )
    if sequence_column["nullable"]:
        # batch_alter_table 会在 SQLite 上重建表，在其他数据库上使用原生 ALTER，
        # 因而可以统一将已回填的列收紧为非空。
        with op.batch_alter_table("experiment_messages") as batch_op:
            batch_op.alter_column("sequence", existing_type=sa.Integer(), nullable=False)

    index_names = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("experiment_messages")}
    if "ux_experiment_messages_session_sequence" not in index_names:
        op.create_index(
            "ux_experiment_messages_session_sequence",
            "experiment_messages",
            ["session_id", "sequence"],
            unique=True,
        )


def downgrade() -> None:
    """移除会话内顺序索引、消息序号与会话计数器。"""
    inspector = sa.inspect(op.get_bind())
    if "ux_experiment_messages_session_sequence" in {index["name"] for index in inspector.get_indexes("experiment_messages")}:
        op.drop_index("ux_experiment_messages_session_sequence", table_name="experiment_messages")
    if "sequence" in {column["name"] for column in sa.inspect(op.get_bind()).get_columns("experiment_messages")}:
        with op.batch_alter_table("experiment_messages") as batch_op:
            batch_op.drop_column("sequence")
    if "message_sequence" in {column["name"] for column in sa.inspect(op.get_bind()).get_columns("experiment_sessions")}:
        with op.batch_alter_table("experiment_sessions") as batch_op:
            batch_op.drop_column("message_sequence")
