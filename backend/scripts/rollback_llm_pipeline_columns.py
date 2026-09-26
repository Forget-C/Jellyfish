#!/usr/bin/env python3
"""回滚 ``migrate_llm_pipeline_columns.py`` 新增的列。

**与迁移共用同一份清单**（``scripts/_llm_pipeline_columns.py``）：回滚删的就是迁移加的那些列，
不会再出现"迁移加了 N 列、回滚只删 N-k 列"的不对称。

两种模式：
1. ``--restore <备份文件名>``（推荐）：直接用迁移时生成的备份覆盖当前库。
   最干净，但会连同迁移之后产生的新数据一起丢回当时的状态。
2. 默认：只 DROP 迁移新增的列，保留其他数据。需要 SQLite ≥ 3.35
   （Python 3.12 自带的版本满足）。若 DROP COLUMN 不可用，脚本会提示改用模式 1。
3. ``--check``：只报告"当前库里有多少列会被删"，不写库。

用法：
    cd backend && uv run python scripts/rollback_llm_pipeline_columns.py
    cd backend && uv run python scripts/rollback_llm_pipeline_columns.py --check
    cd backend && uv run python scripts/rollback_llm_pipeline_columns.py --db /tmp/copy.db
    cd backend && uv run python scripts/rollback_llm_pipeline_columns.py --restore jellyfish.db.backup_before_llm_pipeline_20260918_120000
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# 直接跑脚本时 sys.path[0] 就是 scripts/；被测试用 spec 加载时不一定是，这里显式兜一层。
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# pylint: disable=import-error,wrong-import-position  # 上面刚把 scripts/ 注入 sys.path
from _llm_pipeline_columns import COLUMNS, column_count, describe  # noqa: E402

DB_PATH = BACKEND_ROOT / "jellyfish.db"


def _connect(db_path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """打开数据库；``read_only`` 时用 URI 只读模式。"""
    if read_only:
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    return sqlite3.connect(str(db_path))


def existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """表当前实际存在的列名集合（表不存在时返回空集）。"""
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    except sqlite3.Error:
        return set()
    return {str(row[1]) for row in rows}


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


def drop_columns(*, check_only: bool = False, db_path: Path | None = None) -> int:
    """按共享清单逐列 DROP；``check_only`` 只报告。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    total = column_count()
    # --check 走只读连接：字面意义上"不写库"
    conn = _connect(target_db, read_only=check_only)
    try:
        version = tuple(int(part) for part in sqlite3.sqlite_version.split("."))
        if version < (3, 35, 0):
            print(
                f"✗ 当前 SQLite {sqlite3.sqlite_version} 不支持 DROP COLUMN，"
                f"请改用 --restore <备份文件>",
                file=sys.stderr,
            )
            return 1

        print(f"清单：{describe()}（共 {total} 列）")
        present = [
            item for item in COLUMNS if item.column in existing_columns(conn, item.table)
        ]
        absent = [item for item in COLUMNS if item not in present]

        if check_only:
            print(f"（--check 模式，未执行；将删除 {len(present)}/{total} 列，{len(absent)} 列本就不存在）")
            for item in present:
                print(f"  - {item.table}.{item.column}")
            return 0

        dropped = 0
        for item in COLUMNS:
            if item.column not in existing_columns(conn, item.table):
                print(f"  = {item.table}.{item.column} 不存在，跳过")
                continue
            conn.execute(f"ALTER TABLE {item.table} DROP COLUMN {item.column}")
            print(f"  ✓ DROP {item.table}.{item.column}")
            dropped += 1
        conn.commit()

        # 回滚后校验：清单里的列必须一个都不剩
        leftover = [
            f"{item.table}.{item.column}"
            for item in COLUMNS
            if item.column in existing_columns(conn, item.table)
        ]
        if leftover:
            print(f"✗ 校验失败，仍残留：{leftover}", file=sys.stderr)
            return 1
        print(f"✓ 已回滚 {dropped}/{total} 列，且清单里的列已全部不存在（回到迁移前状态）")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 回滚失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="回滚 LLM 管线落库字段")
    parser.add_argument("--restore", metavar="BACKUP_FILE", help="用指定备份覆盖数据库")
    parser.add_argument("--check", action="store_true", help="只检查将删除哪些列，不修改")
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
    return drop_columns(check_only=args.check, db_path=db_path)


if __name__ == "__main__":
    raise SystemExit(main())
