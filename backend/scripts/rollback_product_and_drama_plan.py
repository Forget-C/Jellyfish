#!/usr/bin/env python3
"""回滚 ``migrate_product_and_drama_plan.py``：删掉那四张表。

**与迁移共用同一份清单**（``scripts/_product_and_drama_plan.py``）：回滚删的就是迁移建的那些表，
不会再出现"迁移建了 N 张、回滚只删 N-k 张"的不对称（``_llm_pipeline_columns.py:3-6``
记录过那次真实事故）。

三种模式：

1. ``--restore <备份文件名>``（推荐）：直接用迁移时生成的备份覆盖当前库。
   最干净，但会连同迁移之后产生的新数据一起丢回当时的状态。
2. 默认：``DROP TABLE IF EXISTS`` 删掉清单里的四张表（表上的索引随表一起删）。
   删表顺序是**清单的逆序**：``project_product_links`` / ``product_images`` 有外键指向
   ``products``，所以先删它们、最后删 ``products``。
3. ``--check``：只报告"当前库里有哪些表会被删、各有多少行"，只开只读连接，不写库。

**默认执行前会先备份**（同迁移：SQLite ``backup`` API，
``{db.name}.backup_before_product_and_drama_plan_{YYYYmmdd_HHMMSS}``）。

⚠ 注意：DROP 会丢掉**迁移之后新写入**的商品资产、商品图、关联行与剧情方案草稿。
这些表在迁移前**不存在**，所以库里的旧数据不会因此受损，删表后随时可以再跑一次
``migrate_product_and_drama_plan.py`` 把空表重建出来。

用法：
    cd backend && uv run python scripts/rollback_product_and_drama_plan.py
    cd backend && uv run python scripts/rollback_product_and_drama_plan.py --check
    cd backend && uv run python scripts/rollback_product_and_drama_plan.py --db /tmp/copy.db
    cd backend && uv run python scripts/rollback_product_and_drama_plan.py \\
        --restore jellyfish.db.backup_before_product_and_drama_plan_20260926_120000
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# 直接跑脚本时 sys.path[0] 就是 scripts/；被测试用 spec 加载时不一定是，这里显式兜一层。
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# pylint: disable=import-error,wrong-import-position  # 上面刚把 scripts/ 注入 sys.path
from _product_and_drama_plan import TABLES, describe, table_count, table_names  # noqa: E402

DB_PATH = BACKEND_ROOT / "jellyfish.db"


def _connect(db_path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """打开数据库；``read_only`` 时用 URI 只读模式。"""
    if read_only:
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    return sqlite3.connect(str(db_path))


def existing_tables(conn: sqlite3.Connection) -> set[str]:
    """库里当前已有的表名集合。"""
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {str(row[0]) for row in rows}


def row_count(conn: sqlite3.Connection, table: str) -> int:
    """表里的行数（读不出来时返回 0，不影响回滚本身）。"""
    try:
        row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    except sqlite3.Error:
        return 0
    return int(row[0]) if row else 0


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


def restore_from_backup(name: str, *, db_path: Path | None = None) -> int:
    """用 SQLite 的 backup API 把备份文件**反向**写回目标库（比 cp 安全）。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    source_path = target_db.with_name(name)
    if not source_path.exists():
        print(f"✗ 找不到备份文件：{source_path}", file=sys.stderr)
        return 1
    if not target_db.exists():
        print(f"✗ 找不到目标库：{target_db}", file=sys.stderr)
        return 1
    keep = backup_database(target_db)
    print(f"✓ 覆盖前先留一份当前状态 → {keep.name}")
    source = sqlite3.connect(str(source_path))
    try:
        dest = sqlite3.connect(str(target_db))
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    print(f"✓ 已从备份还原：{source_path.name}")
    return 0


def rollback(*, check_only: bool, db_path: Path | None = None) -> int:
    """执行删表；``check_only=True`` 时只报告不写库。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    total = table_count()
    conn = _connect(target_db, read_only=check_only)
    try:
        print(f"清单：{describe()}（共 {total} 张表）")
        print(f"目标库：{target_db}")
        present = existing_tables(conn)
        # 删表顺序 = 清单逆序（有外键指向 products 的表先删）
        doomed = [item for item in reversed(TABLES) if item.table in present]

        for item in doomed:
            print(f"  - {item.table}（{row_count(conn, item.table)} 行会被删）")
        intact = [item.table for item in TABLES if item.table not in present]
        for name in intact:
            print(f"  = {name} 不在库里，无需处理")

        if check_only:
            print(f"（--check 模式，未执行；会删 {len(doomed)}/{total} 张表）")
            print("  只读连接：没有删表、没有生成备份。")
            return 0

        if not doomed:
            print(f"✓ 四张表都不在库里，无需回滚")
            return 0

        backup_path = backup_database(target_db)
        print(f"✓ 已备份数据库 → {backup_path.name}")

        for item in doomed:
            conn.execute(f"DROP TABLE IF EXISTS {item.table}")
            print(f"  ✓ DROP TABLE {item.table}")
        conn.commit()

        still_there = existing_tables(conn)
        remaining = [name for name in table_names() if name in still_there]
        if remaining:
            print(f"✗ 回滚后这些表还在：{remaining}", file=sys.stderr)
            return 1
        print(f"✓ 回滚完成：清单里的 {total} 张表都不在库里了")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 回滚失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="回滚商品资产与剧情方案草稿的四张表")
    parser.add_argument("--check", action="store_true", help="只报告会删哪些表，不修改")
    parser.add_argument("--print-only", action="store_true", help="等同 --check")
    parser.add_argument(
        "--restore",
        metavar="BACKUP_NAME",
        default=None,
        help="用指定备份文件覆盖当前库（迁移时的备份名，例如 jellyfish.db.backup_before_...）",
    )
    parser.add_argument(
        "--db",
        metavar="DB_PATH",
        default=None,
        help="目标数据库路径（默认 backend/jellyfish.db；验证/演练请传副本路径）",
    )
    args = parser.parse_args()
    db_path = Path(args.db) if args.db else None
    if args.restore:
        return restore_from_backup(args.restore, db_path=db_path)
    return rollback(check_only=bool(args.check or args.print_only), db_path=db_path)


if __name__ == "__main__":
    raise SystemExit(main())
