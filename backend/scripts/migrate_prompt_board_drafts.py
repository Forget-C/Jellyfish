#!/usr/bin/env python3
"""为「整集视频提示词草稿丢失」补建**服务端草稿表**（幂等，可回滚）。

建表清单**只有一份**：``scripts/_prompt_board_drafts.py``（迁移与回滚共用），
当前 1 张表（数量动态取自清单，不在文案里写死）：

``shot_video_prompt_drafts`` —— 集级提示词看板的逐镜草稿（主键 = ``shot_id``）。
修的问题：看板按「一次一镜」真实调用大模型（会产生费用），草稿此前只存在浏览器内存里，
刷新 / 切走 / 中断就全丢，已付费的生成结果不可恢复。草稿落库后刷新能恢复、中断能续跑。

为什么是 Python 而不是 ``sql/0xx*.sql``：
``sql/`` 里的文件是 MySQL 方言（``information_schema`` / ``TINYINT``），运行时是 SQLite。
这里提供**真正能跑**的 SQLite 建表器：幂等、带备份、可回滚。
同目录另有 ``rollback_prompt_board_drafts.py``。

用法：
    cd backend && uv run python scripts/migrate_prompt_board_drafts.py            # 执行
    cd backend && uv run python scripts/migrate_prompt_board_drafts.py --check    # 只检查
    cd backend && uv run python scripts/migrate_prompt_board_drafts.py --db /tmp/x.db   # 指定库（验证用）
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
from _prompt_board_drafts import TABLES, describe, table_count  # noqa: E402

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


def backup_database(db_path: Path) -> Path:
    """用 SQLite 的 backup API 做一致性快照（WAL 下直接拷文件会丢未 checkpoint 的数据）。"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = db_path.with_name(f"{db_path.name}.backup_before_prompt_board_drafts_{stamp}")
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


def migrate(*, check_only: bool, db_path: Path | None = None) -> int:
    """执行建表迁移；``check_only=True`` 时只报告不写库。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    total = table_count()
    # --check 走只读连接：字面意义上"不写库"（连 WAL 边车都不动）
    conn = _connect(target_db, read_only=check_only)
    try:
        print(f"清单：{describe()}（共 {total} 张表）")
        present = existing_tables(conn)
        pending = [item for item in TABLES if item.table not in present]
        for item in TABLES:
            if item.table in present:
                print(f"  = {item.table} 已存在，跳过")

        if not pending:
            print(f"✓ 全部 {total} 张表都已存在，无需迁移")
            return 0

        print(f"待新建 {len(pending)}/{total} 张表：")
        for item in pending:
            print(f"  + {item.table}（{item.why}）")

        if check_only:
            print(f"（--check 模式，未执行；缺 {len(pending)} 张表）")
            return 0

        backup_path = backup_database(target_db)
        print(f"✓ 已备份数据库 → {backup_path.name}")

        for item in pending:
            conn.execute(item.ddl)
            print(f"  ✓ CREATE TABLE {item.table}")
            for index_ddl in item.indexes:
                conn.execute(index_ddl)
                print(f"    ✓ {index_ddl.split(' ON ')[0].split('EXISTS ')[-1]}")
        conn.commit()

        # 迁移后校验：逐表确认真的存在（并确认主键/列数不是空的）
        missing = [item.table for item in TABLES if item.table not in existing_tables(conn)]
        if missing:
            print(f"✗ 校验失败，仍缺少：{missing}", file=sys.stderr)
            return 1
        for item in TABLES:
            columns = conn.execute(f"PRAGMA table_info({item.table})").fetchall()
            if not columns:
                print(f"✗ 校验失败：{item.table} 建出来了却没有列定义", file=sys.stderr)
                return 1
        print(f"✓ 迁移完成并校验通过（{total} 张表全部存在）")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 迁移失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="补建集级提示词看板的草稿表")
    parser.add_argument("--check", action="store_true", help="只检查，不修改")
    parser.add_argument(
        "--db",
        metavar="DB_PATH",
        default=None,
        help="目标数据库路径（默认 backend/jellyfish.db；验证/演练请传副本路径）",
    )
    args = parser.parse_args()
    return migrate(check_only=args.check, db_path=Path(args.db) if args.db else None)


if __name__ == "__main__":
    raise SystemExit(main())
