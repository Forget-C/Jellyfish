"""自检脚本共用的库路径解析测试（``tests/selfcheck_db.py``）。

为什么值得单独测：两份手工 selfcheck 都要「找对库」——
``DATABASE_URL`` 的 sqlite 写法有个易踩的坑：
``sqlite+aiosqlite:////abs/path.db`` 是**绝对**路径，而
``sqlite+aiosqlite:///rel.db`` 是**相对**路径（相对进程工作目录，自检里按 ``backend/`` 解析）。
写错一次就会「指纹算的是 A 库、应用读的是 B 库」，拿到的是假证据。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tests.selfcheck_db import resolve_db_path, skip_note, unusable_reason

BACKEND = Path("/repo/backend")


def test_absolute_database_url_resolves_to_that_file(monkeypatch) -> None:
    monkeypatch.delenv("JELLYFISH_SELFCHECK_DB", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:////tmp/jf_groups/test.db")
    assert resolve_db_path(BACKEND) == Path("/tmp/jf_groups/test.db")


def test_relative_database_url_resolves_against_backend(monkeypatch) -> None:
    monkeypatch.delenv("JELLYFISH_SELFCHECK_DB", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./jellyfish.db")
    assert resolve_db_path(BACKEND) == BACKEND / "jellyfish.db"


def test_memory_and_non_sqlite_urls_fall_back_to_default(monkeypatch) -> None:
    monkeypatch.delenv("JELLYFISH_SELFCHECK_DB", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    assert resolve_db_path(BACKEND) == BACKEND / "jellyfish.db"
    monkeypatch.setenv("DATABASE_URL", "postgresql://user@host/db")
    assert resolve_db_path(BACKEND) == BACKEND / "jellyfish.db"


def test_explicit_override_wins(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:////tmp/other.db")
    monkeypatch.setenv("JELLYFISH_SELFCHECK_DB", "/tmp/jf_selfcheck/selfcheck.db")
    assert resolve_db_path(BACKEND) == Path("/tmp/jf_selfcheck/selfcheck.db")


def test_missing_and_empty_files_are_reported(tmp_path) -> None:
    missing = tmp_path / "nope.db"
    assert "找不到数据库文件" in str(unusable_reason(missing))

    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    assert "0 字节" in str(unusable_reason(empty))


def test_schema_without_rows_is_reported_as_unusable(tmp_path) -> None:
    """只有表结构、没有任何镜头 → 明确报「不可用」，而不是让人看到一堆断言失败。"""
    db_path = tmp_path / "schema_only.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "CREATE TABLE chapters (id TEXT); CREATE TABLE shots (id TEXT);"
        " CREATE TABLE shot_details (id TEXT);"
    )
    connection.commit()
    connection.close()
    reason = unusable_reason(db_path)
    assert reason is not None and "没有任何镜头" in reason
    # 明确说明「这不是代码失败」
    assert "跳过" in skip_note(db_path, reason)


def test_seeded_db_is_usable(tmp_path) -> None:
    db_path = tmp_path / "seeded.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "CREATE TABLE chapters (id TEXT); CREATE TABLE shots (id TEXT);"
        " CREATE TABLE shot_details (id TEXT); INSERT INTO shots (id) VALUES ('s1');"
    )
    connection.commit()
    connection.close()
    assert unusable_reason(db_path) is None
