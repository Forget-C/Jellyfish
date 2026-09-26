#!/usr/bin/env python3
"""回滚 ``migrate_chapter_asset_records.py``：删掉章节资产资料的两张专用表。

**与迁移共用同一份清单**（``scripts/_chapter_asset_records.py``）：回滚删的就是迁移建的那些表，
不会再出现"迁移建了 N 张、回滚只删 N-k 张"的不对称。

两种模式：
1. ``--restore <备份文件名>``（推荐）：直接用迁移时生成的备份覆盖当前库。
   最干净，但会连同迁移之后产生的新数据一起丢回当时的状态。
2. 默认：``DROP TABLE IF EXISTS`` 删掉清单里的两张表（表上的索引随表一起删）。
   删表顺序是**先** ``chapter_asset_profiles``（它有外键指向 ``chapter_asset_profile_runs``）、
   **后** ``chapter_asset_profile_runs``。
3. ``--check``：只报告"当前库里有哪些表会被删、各有多少行"，只开只读连接，不写库。

**默认执行前会先备份**（同迁移：SQLite ``backup`` API，
``{db.name}.backup_before_chapter_asset_records_{YYYYmmdd_HHMMSS}``）。

⚠ 注意：DROP 会丢掉**迁移之后新写入**的章节资料（人工确认、人工修改、用户补充都在里面）。
旧结构 ``shot_extracted_candidates.payload`` 里的数据**仍然保留**，
删表后随时可以再跑一次 ``migrate_chapter_asset_records.py`` 把它们搬回来。

用法：
    cd backend && uv run python scripts/rollback_chapter_asset_records.py
    cd backend && uv run python scripts/rollback_chapter_asset_records.py --check
    cd backend && uv run python scripts/rollback_chapter_asset_records.py --db /tmp/copy.db
    cd backend && uv run python scripts/rollback_chapter_asset_records.py \\
        --restore jellyfish.db.backup_before_chapter_asset_records_20260924_120000
"""

from __future__ import annotations

import argparse
import shutil
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
from _chapter_asset_records import TABLES, describe, table_count, table_names  # noqa: E402

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
    target = db_path.with_name(f"{db_path.name}.backup_before_chapter_asset_records_{stamp}")
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
    """用迁移时的备份整体覆盖数据库（含清理 -wal/-shm 边车文件）。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    backup = Path(name)
    if not backup.is_absolute():
        backup = BACKEND_ROOT / name
    if not backup.exists():
        print(f"✗ 找不到备份文件：{backup}", file=sys.stderr)
        return 1
    for suffix in ("-wal", "-shm"):
        sidecar = target_db.with_name(target_db.name + suffix)
        if sidecar.exists():
            sidecar.unlink()
    shutil.copy2(backup, target_db)
    print(f"✓ 已用 {backup.name} 覆盖 {target_db.name}")
    return 0


def drop_tables(*, check_only: bool = False, db_path: Path | None = None) -> int:
    """按共享清单逐表 ``DROP TABLE IF EXISTS``；``check_only`` 只报告。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    # --check 走只读连接：字面意义上"不写库"
    conn = _connect(target_db, read_only=check_only)
    try:
        print(f"清单：{describe()}（共 {table_count()} 张表）")
        present = existing_tables(conn)
        to_drop = [item for item in TABLES if item.table in present]
        if not to_drop:
            print("✓ 清单里的表一张都不在库里，无需回滚")
            return 0

        print(f"将删除 {len(to_drop)} 张表：")
        for item in to_drop:
            print(f"  - {item.table}（当前 {row_count(conn, item.table)} 行）")

        if check_only:
            print("（--check 模式，未执行；只读连接，没有写库、没有生成备份）")
            return 0

        print("⚠ DROP 会丢掉迁移之后新写入的章节资料（人工确认 / 人工修改 / 用户补充都会没）。")
        print("  旧结构 shot_extracted_candidates.payload 里的数据仍然保留，")
        print("  删表后可以再跑一次 migrate_chapter_asset_records.py 把它们搬回来。")
        backup_path = backup_database(target_db)
        print(f"✓ 已备份数据库 → {backup_path.name}")

        # 删表顺序：先删有外键的 chapter_asset_profiles，再删 chapter_asset_profile_runs
        for item in reversed(TABLES):
            if item.table not in existing_tables(conn):
                print(f"  = {item.table} 不存在，跳过")
                continue
            conn.execute(f"DROP TABLE IF EXISTS {item.table}")
            print(f"  ✓ DROP TABLE {item.table}")
        conn.commit()

        remaining = [table for table in table_names() if table in existing_tables(conn)]
        if remaining:
            print(f"✗ 校验失败，仍残留：{remaining}", file=sys.stderr)
            return 1
        print(f"✓ 回滚完成并校验通过（{table_count()} 张表均已删除；旧结构数据仍可再次迁移）")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 回滚失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="回滚章节资产资料专用表")
    parser.add_argument("--check", action="store_true", help="只报告将删除哪些表与各表行数，不修改")
    parser.add_argument("--restore", metavar="BACKUP", default=None, help="用迁移时的备份整体覆盖")
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
    return drop_tables(check_only=args.check, db_path=db_path)


if __name__ == "__main__":
    raise SystemExit(main())
