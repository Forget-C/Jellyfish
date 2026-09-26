"""商品资产 + 剧情方案草稿四张表的迁移 / 回滚回归测试（全部用 tmp_path 临时库）。

锁住六件事：

1. ``--check`` / ``--print-only`` 只读：跑完表还没建、文件 mtime 不变、没有生成备份；
2. 建表结果与 ORM **逐列一致**（列名顺序 / NOT NULL / 主键 / 外键含 ON DELETE / 索引名 /
   唯一约束名），并用 PRAGMA ``table_info`` 与模型 ``__table__.columns`` 断言完全相等；
3. 幂等：连续跑两次，第二次输出"已存在"，四张表行数不变；
4. 默认执行自动生成备份（文件名前缀 ``.backup_before_product_and_drama_plan_``）；
5. 回滚：四张表都不存在、``--check`` 不改库、回滚后可以再迁移回来；
6. 清单只有一份：``table_names()`` 与 ``TABLE_NAMES`` 一致，且 ``products`` 必须最先建
   （另两张表的外键指向它）。

**绝不连正式库**：不使用 ``DATABASE_URL``、不连 ``backend/jellyfish.db``、
不用 ``with TestClient(app)``；所有库都在 ``tmp_path`` 下现造。
"""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BACKEND_ROOT / "scripts"

# scripts/（共享清单模块）与 backend/（app 包）都要在 sys.path 上：
# 直接跑脚本时 sys.path[0] 是 scripts/，脚本自己也会把 backend/ 兜进去。
for _entry in (SCRIPTS_DIR, BACKEND_ROOT):
    if str(_entry) not in sys.path:
        sys.path.insert(0, str(_entry))

PROJECT_ID = "proj-1"
CHAPTER_ID = "chap-1"

BACKUP_PREFIX = ".backup_before_product_and_drama_plan_"

#: 最小前置表结构：只保留四张新表的外键需要指向的表。
_PREREQ_DDL: tuple[str, ...] = (
    "CREATE TABLE projects (id VARCHAR(64) NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL DEFAULT '')",
    "CREATE TABLE chapters (id VARCHAR(64) NOT NULL PRIMARY KEY, project_id VARCHAR(64) NOT NULL)",
    "CREATE TABLE shots (id VARCHAR(64) NOT NULL PRIMARY KEY, chapter_id VARCHAR(64) NOT NULL)",
    "CREATE TABLE files (id VARCHAR(64) NOT NULL PRIMARY KEY)",
    "CREATE TABLE prompt_templates (id VARCHAR(64) NOT NULL PRIMARY KEY)",
)

_SCRIPT_CACHE: dict[str, Any] = {}


def _load_script(name: str) -> Any:
    """按文件路径加载 scripts/ 下的脚本（只加载一次）。

    加载前先登记进 ``sys.modules``：脚本里有 ``from __future__ import annotations`` +
    ``@dataclass``，dataclasses 判断字符串注解时要查 ``sys.modules[cls.__module__]``，
    不登记就会拿到 ``None`` 而在装饰时炸掉。
    """
    if name not in _SCRIPT_CACHE:
        spec = importlib.util.spec_from_file_location(
            f"_jf_script_{name}", SCRIPTS_DIR / f"{name}.py"
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[module.__name__] = module
        spec.loader.exec_module(module)
        _SCRIPT_CACHE[name] = module
    return _SCRIPT_CACHE[name]


def _connect(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    if read_only:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    return sqlite3.connect(str(path))


def _tables(path: Path) -> set[str]:
    conn = _connect(path, read_only=True)
    try:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    finally:
        conn.close()
    return {str(row[0]) for row in rows}


def _columns(path: Path, table: str) -> list[str]:
    conn = _connect(path, read_only=True)
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    finally:
        conn.close()
    return [str(row[1]) for row in rows]


def _prereq_db(path: Path) -> Path:
    """只有前置表、没有任何业务数据的库（用于迁移与回滚测试）。"""
    conn = _connect(path)
    try:
        for ddl in _PREREQ_DDL:
            conn.execute(ddl)
        conn.execute(f"INSERT INTO projects (id, name) VALUES ('{PROJECT_ID}', '测试项目')")
        conn.execute(
            f"INSERT INTO chapters (id, project_id) VALUES ('{CHAPTER_ID}', '{PROJECT_ID}')"
        )
        conn.commit()
    finally:
        conn.close()
    return path


# ---------------------------------------------------------------------------
# 1) --check / --print-only 只读
# ---------------------------------------------------------------------------


def test_check_mode_does_not_write(tmp_path: Path, capsys: Any) -> None:
    """``--check`` 不得建表、不得改文件、不得生成备份。"""
    # pylint: disable=import-error  # scripts/ 已在上文注入 sys.path
    import _product_and_drama_plan as shared

    migrate = _load_script("migrate_product_and_drama_plan")
    db = _prereq_db(tmp_path / "check_only.db")
    before_mtime = db.stat().st_mtime_ns

    assert migrate.migrate(check_only=True, db_path=db) == 0
    out = capsys.readouterr().out

    assert _tables(db) & set(shared.table_names()) == set()
    assert db.stat().st_mtime_ns == before_mtime
    assert not (tmp_path / "check_only.db-wal").exists()
    assert not (tmp_path / "check_only.db-shm").exists()
    assert list(tmp_path.glob(f"*{BACKUP_PREFIX}*")) == []

    assert "未执行" in out
    assert "缺 4 张表" in out
    assert "只读连接" in out


def test_print_only_cli_flag_does_not_write(tmp_path: Path, monkeypatch: Any) -> None:
    """``--print-only`` 走命令行入口时也必须只读（flag → check_only 的映射要锁住）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _product_and_drama_plan as shared

    migrate = _load_script("migrate_product_and_drama_plan")
    db = _prereq_db(tmp_path / "print_only.db")
    before_mtime = db.stat().st_mtime_ns

    monkeypatch.setattr(
        sys,
        "argv",
        ["migrate_product_and_drama_plan.py", "--print-only", "--db", str(db)],
    )
    assert migrate.main() == 0

    assert _tables(db) & set(shared.table_names()) == set()
    assert db.stat().st_mtime_ns == before_mtime
    assert list(tmp_path.glob(f"*{BACKUP_PREFIX}*")) == []


# ---------------------------------------------------------------------------
# 2) 建表结果与 ORM 逐列一致
# ---------------------------------------------------------------------------


def test_migrated_tables_match_orm_columns_and_constraints(tmp_path: Path) -> None:
    """迁移后的表结构必须与 ORM 定义逐列一致（列名顺序 / NOT NULL / 主键 / 外键 / 索引）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _product_and_drama_plan as shared

    import app.models.studio  # noqa: F401 - 导入即把四张表注册进 Base.metadata
    from app.core.db import Base

    migrate = _load_script("migrate_product_and_drama_plan")
    db = _prereq_db(tmp_path / "schema.db")
    assert migrate.migrate(check_only=False, db_path=db) == 0

    # 清单只有一份，且 products 必须最先建（另两张表的外键指向它）
    assert shared.TABLE_NAMES[0] == shared.PRODUCTS_TABLE
    assert shared.table_names() == shared.TABLE_NAMES
    assert shared.table_count() == len(shared.TABLES) == 4
    assert shared.PRODUCTS_TABLE_UNIQUE_CONSTRAINT in shared.PRODUCTS_TABLE_DDL
    assert shared.PRODUCT_IMAGES_TABLE_UNIQUE_CONSTRAINT in shared.PRODUCT_IMAGES_TABLE_DDL
    assert (
        shared.PROJECT_PRODUCT_LINKS_TABLE_UNIQUE_CONSTRAINT
        in shared.PROJECT_PRODUCT_LINKS_TABLE_DDL
    )

    for item in shared.TABLES:
        orm_table = Base.metadata.tables[item.table]

        # (a) 列名集合完全相等（逐列一致），顺序也一致（PRAGMA 顺序 = DDL 顺序 = ORM 声明顺序）
        actual = _columns(db, item.table)
        assert set(actual) == set(orm_table.columns.keys()), f"{item.table} 列名与 ORM 不一致"
        assert actual == list(orm_table.columns.keys()), f"{item.table} 列顺序与 ORM 不一致"
        assert tuple(actual) == item.columns, f"{item.table} 列与清单不一致"

        conn = _connect(db, read_only=True)
        try:
            # (b) NOT NULL / 主键 一致
            pragma = [
                (str(row[1]), int(row[3]), int(row[5]))
                for row in conn.execute(f"PRAGMA table_info({item.table})")
            ]
            orm_flags = [
                (column.name, 0 if column.nullable else 1, 1 if column.primary_key else 0)
                for column in orm_table.columns
            ]
            assert pragma == orm_flags, f"{item.table} 的 NOT NULL / 主键与 ORM 不一致"

            # (c) 外键（含 ON DELETE 动作）一致
            fk_rows = sorted(
                (str(row[3]), str(row[2]), str(row[4]), str(row[6]))
                for row in conn.execute(f"PRAGMA foreign_key_list({item.table})")
            )
            orm_fks = sorted(
                (
                    element.parent.name,
                    element.column.table.name,
                    element.column.name,
                    str(constraint.ondelete or ""),
                )
                for constraint in orm_table.foreign_key_constraints
                for element in constraint.elements
            )
            assert fk_rows == orm_fks, f"{item.table} 的外键与 ORM 不一致"

            # (d) 索引名一致（含 ORM 里 index=True 自动生成的同名索引）
            index_rows = {str(row[1]) for row in conn.execute(f"PRAGMA index_list({item.table})")}
            assert index_rows >= set(shared.index_names(item))
            assert index_rows >= {index.name for index in orm_table.indexes}

            # (e) 唯一约束名真的写进了表定义
            sql = str(
                conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
                    (item.table,),
                ).fetchone()[0]
            )
        finally:
            conn.close()
        for name in item.constraints:
            assert name in sql, f"{item.table} 的建表 SQL 里找不到唯一约束 {name}"


# ---------------------------------------------------------------------------
# 3) 幂等
# ---------------------------------------------------------------------------


def test_second_run_skips_existing_tables(tmp_path: Path, capsys: Any) -> None:
    """连续跑两次：第二次报告"已存在，跳过"，且不再生成第二份备份。"""
    migrate = _load_script("migrate_product_and_drama_plan")
    db = _prereq_db(tmp_path / "idempotent.db")

    assert migrate.migrate(check_only=False, db_path=db) == 0
    first_backups = list(tmp_path.glob(f"*{BACKUP_PREFIX}*"))
    assert len(first_backups) == 1
    capsys.readouterr()

    assert migrate.migrate(check_only=False, db_path=db) == 0
    out = capsys.readouterr().out

    assert "已存在，跳过建表" in out
    assert "都已存在，无需迁移" in out
    assert list(tmp_path.glob(f"*{BACKUP_PREFIX}*")) == first_backups


# ---------------------------------------------------------------------------
# 4) 默认执行先备份
# ---------------------------------------------------------------------------


def test_default_run_creates_backup(tmp_path: Path) -> None:
    """默认执行必须在建表**之前**先留一份一致性快照。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _product_and_drama_plan as shared

    migrate = _load_script("migrate_product_and_drama_plan")
    db = _prereq_db(tmp_path / "backup.db")

    assert migrate.migrate(check_only=False, db_path=db) == 0

    backups = list(tmp_path.glob(f"*{BACKUP_PREFIX}*"))
    assert len(backups) == 1
    # 备份是"迁移前"的状态：四张新表都不在，但前置表在（证明确实拷的是原库）
    backup_tables = _tables(backups[0])
    assert backup_tables & set(shared.table_names()) == set()
    assert "chapters" in backup_tables


# ---------------------------------------------------------------------------
# 5) 回滚
# ---------------------------------------------------------------------------


def test_rollback_drops_all_four_tables_and_migrate_again(tmp_path: Path, capsys: Any) -> None:
    """回滚删掉四张表、可再次迁移回来；回滚的 --check 不写库。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _product_and_drama_plan as shared

    migrate = _load_script("migrate_product_and_drama_plan")
    rollback = _load_script("rollback_product_and_drama_plan")
    db = _prereq_db(tmp_path / "rollback.db")

    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert set(shared.table_names()) <= _tables(db)

    # --check 只读：表还在
    before_mtime = db.stat().st_mtime_ns
    assert rollback.rollback(check_only=True, db_path=db) == 0
    out = capsys.readouterr().out
    assert "未执行" in out
    assert "只读连接" in out
    assert db.stat().st_mtime_ns == before_mtime
    assert set(shared.table_names()) <= _tables(db)

    # 真回滚：四张表都不在
    assert rollback.rollback(check_only=False, db_path=db) == 0
    assert _tables(db) & set(shared.table_names()) == set()

    # 还能再迁移回来（空表重建）
    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert set(shared.table_names()) <= _tables(db)
