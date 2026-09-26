#!/usr/bin/env python3
"""补建「商品资产 + 剧情方案草稿」的四张表（幂等、带备份、可回滚）。

为什么需要它
============

「广告剧情流程」要在商品卖点 → 剧情方案 → 确认落库这条链上用到四张此前不存在的表
（``products`` / ``product_images`` / ``project_product_links`` / ``drama_plan_drafts``）。
本仓库**不用 Alembic**，也没有版本表：改已有库靠 ``scripts/migrate_*.py`` 这类
**手写幂等脚本**，靠"表/列存在性探测"决定跳过什么（先例：``b76ad7c`` 的章节资产资料迁移）。

为什么不写成 ``sql/0xx-*.sql``
=============================

``backend/sql/`` 下的文件是 **MySQL 方言**（``information_schema`` / ``PREPARE`` /
``MODIFY COLUMN``），而运行时用的是 SQLite，**没有任何代码执行它们**。
所以这里给的是真能跑的 SQLite 建表器（与 ``_chapter_asset_records.py`` 同一判断）。

幂等
====

- 建表：``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``；
- 库里已有的表**一个字都不动**（只报告"已存在，跳过"），重复执行结果一致；
- 本迁移**不搬任何数据**（四张表都是全新表，没有旧结构需要搬运）。

备份
====

默认执行**先备份**，再用 SQLite 的 ``backup`` API 做一致性快照，文件名
``{db.name}.backup_before_product_and_drama_plan_{YYYYmmdd_HHMMSS}``
（WAL 下直接拷文件会丢未 checkpoint 的数据）。
``--check`` / ``--print-only`` 全程只开**只读连接**（``file:...?mode=ro``），
不写库、也不生成备份。

跑法：
    cd backend && uv run python scripts/migrate_product_and_drama_plan.py              # 执行
    cd backend && uv run python scripts/migrate_product_and_drama_plan.py --check      # 只检查
    cd backend && uv run python scripts/migrate_product_and_drama_plan.py --print-only # 只打印统计
    cd backend && uv run python scripts/migrate_product_and_drama_plan.py --db /tmp/copy.db

同目录另有回滚脚本 ``rollback_product_and_drama_plan.py``；清单**只有一份**：
``scripts/_product_and_drama_plan.py``（与回滚脚本共用，禁止各写一份）。
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# 直接跑脚本时 sys.path[0] 是 scripts/（清单模块在这一层），而 cwd 不在路径上。
SCRIPT_DIR = Path(__file__).resolve().parent
for _entry in (SCRIPT_DIR, BACKEND_ROOT):
    if str(_entry) not in sys.path:
        sys.path.insert(0, str(_entry))

# pylint: disable=import-error,wrong-import-position  # 上面刚把 scripts/ 与 backend/ 注入 sys.path
from _product_and_drama_plan import (  # noqa: E402
    TABLES,
    describe,
    index_names,
    table_count,
)

DB_PATH = BACKEND_ROOT / "jellyfish.db"


def _connect(db_path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """打开数据库；``read_only`` 时用 URI 只读模式。"""
    if read_only:
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    return sqlite3.connect(str(db_path))


def existing_tables(conn: sqlite3.Connection) -> set[str]:
    """库里当前已有的表名集合（``sqlite_master`` 为准，不猜）。"""
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {str(row[0]) for row in rows}


def existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """表当前实际存在的列名集合（表不存在时返回空集）。"""
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    except sqlite3.Error:
        return set()
    return {str(row[1]) for row in rows}


def existing_indexes(conn: sqlite3.Connection, table: str) -> set[str]:
    """表上的索引名集合（唯一约束的自动索引也在里面）。"""
    try:
        rows = conn.execute(f"PRAGMA index_list({table})").fetchall()
    except sqlite3.Error:
        return set()
    return {str(row[1]) for row in rows}


def table_sql(conn: sqlite3.Connection, table: str) -> str:
    """表在 ``sqlite_master`` 里的原始建表 SQL（唯一约束名只能从这里读到）。"""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return str(row[0] or "") if row else ""


def backup_database(db_path: Path) -> Path:
    """用 SQLite 的 backup API 做一致性快照（WAL 下直接拷文件会丢未 checkpoint 的数据）。"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = db_path.with_name(f"{db_path.name}.backup_before_product_and_drama_plan_{stamp}")
    source = sqlite3.connect(str(db_path))
    try:
        dest = sqlite3.connect(str(target))
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    return target


def verify_schema(conn: sqlite3.Connection) -> list[str]:
    """逐列 / 逐约束 / 逐索引校验建表结果；返回问题清单（空列表 = 通过）。

    缺一列、缺唯一约束、缺索引都算问题（调用方据此返回退出码 1）；
    清单之外的额外列只提示不拦（可能是别人后加的列）。
    """
    problems: list[str] = []
    for item in TABLES:
        actual = existing_columns(conn, item.table)
        if not actual:
            problems.append(f"{item.table} 不存在（或没有列定义）")
            continue
        missing = [name for name in item.columns if name not in actual]
        if missing:
            problems.append(f"{item.table} 缺少列：{missing}")
        extra = sorted(actual - set(item.columns))
        if extra:
            print(f"  · 提示：{item.table} 另有清单外的列（不影响使用）：{extra}")
        sql = table_sql(conn, item.table)
        for name in item.constraints:
            if name not in sql:
                problems.append(f"{item.table} 缺少唯一约束 {name}")
        indexes = existing_indexes(conn, item.table)
        for name in index_names(item):
            if name not in indexes:
                problems.append(f"{item.table} 缺少索引 {name}")
    return problems


def migrate(*, check_only: bool, db_path: Path | None = None) -> int:
    """执行建表；``check_only=True`` 时只报告不写库。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    total = table_count()
    # --check / --print-only 走只读连接：字面意义上"不写库"（连 WAL 边车都不动）
    conn = _connect(target_db, read_only=check_only)
    try:
        print(f"清单：{describe()}（共 {total} 张表）")
        print(f"目标库：{target_db}")
        present = existing_tables(conn)
        pending_tables = [item for item in TABLES if item.table not in present]
        for item in TABLES:
            if item.table in present:
                print(f"  = {item.table} 已存在，跳过建表")

        if pending_tables:
            print(f"待新建 {len(pending_tables)}/{total} 张表：")
            for item in pending_tables:
                print(f"  + {item.table}（{item.why}）")

        if check_only:
            print(f"（--check 模式，未执行；缺 {len(pending_tables)} 张表）")
            print("  只读连接：没有建表、没有生成备份。")
            return 0

        if not pending_tables:
            print(f"✓ 全部 {total} 张表都已存在，无需迁移")
            return 0

        backup_path = backup_database(target_db)
        print(f"✓ 已备份数据库 → {backup_path.name}")

        for item in pending_tables:
            conn.execute(item.ddl)
            print(f"  ✓ CREATE TABLE {item.table}")
            for index_ddl in item.indexes:
                conn.execute(index_ddl)
        conn.commit()

        problems = verify_schema(conn)
        if problems:
            for problem in problems:
                print(f"✗ 建表校验失败：{problem}", file=sys.stderr)
            return 1
        print(f"✓ 建表完成并逐列校验通过（{total} 张表，列与 ORM 一致）")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 迁移失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="补建商品资产与剧情方案草稿的四张表")
    parser.add_argument("--check", action="store_true", help="只检查缺哪些表，不修改")
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="只打印将要做的事与统计，不写库（等同 --check）",
    )
    parser.add_argument(
        "--db",
        metavar="DB_PATH",
        default=None,
        help="目标数据库路径（默认 backend/jellyfish.db；验证/演练请传副本路径）",
    )
    args = parser.parse_args()
    return migrate(
        check_only=bool(args.check or args.print_only),
        db_path=Path(args.db) if args.db else None,
    )


if __name__ == "__main__":
    raise SystemExit(main())
