#!/usr/bin/env python3
"""为「LLM 能力嵌入生产流程」补齐落库字段（幂等，可回滚）。

新增列清单**只有一份**：``scripts/_llm_pipeline_columns.py``（迁移与回滚共用），
内容概览（数量动态取自清单，不在文案里写死）：

1. 资产级图片提示词落库：``characters`` / ``scenes`` / ``props`` / ``costumes`` /
   ``actors`` 各加 ``image_prompts``（JSON 文本）。
2. 定版主图：``actor_images`` / ``scene_images`` / ``prop_images`` /
   ``costume_images`` 各加 ``is_primary``。此前只有 ``character_images`` 有这一列，
   于是"设为定版"在其它四类资产上通过 HTTP 永远不可达。
3. 镜头级正式产物：``shot_details.video_prompt`` / ``video_prompt_source``
   （视频提示词与来源，交付导出读的就是它）、``audio_file_id`` / ``audio_opt_out``
   （声音绑定与「本镜无需声音」，两者互斥）。

为什么是 Python 而不是 sql/009*.sql：
现有 ``sql/`` 里的文件是 MySQL 方言（``information_schema`` / ``TINYINT``），
而运行时用的是 SQLite（``backend/jellyfish.db``）。这里提供一个**真正能跑**的
SQLite 迁移器，幂等、带备份、可回滚。同目录另有 ``rollback_llm_pipeline_columns.py``。

用法：
    cd backend && uv run python scripts/migrate_llm_pipeline_columns.py            # 执行
    cd backend && uv run python scripts/migrate_llm_pipeline_columns.py --check    # 只检查
    cd backend && uv run python scripts/migrate_llm_pipeline_columns.py --db /tmp/x.db   # 指定库（验证用）
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


def backup_database(db_path: Path) -> Path:
    """用 SQLite 的 backup API 做一致性快照（WAL 下直接拷文件会丢未 checkpoint 的数据）。"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = db_path.with_name(f"{db_path.name}.backup_before_llm_pipeline_{stamp}")
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
    """执行迁移；``check_only=True`` 时只报告不写库。返回进程退出码。"""
    target_db = Path(db_path) if db_path is not None else DB_PATH
    if not target_db.exists():
        print(f"✗ 找不到数据库：{target_db}", file=sys.stderr)
        return 1

    total = column_count()
    # --check 走只读连接：字面意义上"不写库"（连 WAL 边车都不动）
    conn = _connect(target_db, read_only=check_only)
    try:
        print(f"清单：{describe()}（共 {total} 列）")
        pending: list[tuple[str, str, str]] = []
        for item in COLUMNS:
            if item.column in existing_columns(conn, item.table):
                print(f"  = {item.table}.{item.column} 已存在，跳过")
            else:
                pending.append((item.table, item.column, item.ddl))

        if not pending:
            print(f"✓ 全部 {total} 列都已存在，无需迁移")
            return 0

        print(f"待新增 {len(pending)}/{total} 列：")
        for table, column, _ddl in pending:
            print(f"  + {table}.{column}")

        if check_only:
            print(f"（--check 模式，未执行；缺 {len(pending)} 列）")
            return 0

        backup_path = backup_database(target_db)
        print(f"✓ 已备份数据库 → {backup_path.name}")

        for table, column, ddl in pending:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            print(f"  ✓ ALTER TABLE {table} ADD COLUMN {column}")
        conn.commit()

        # 迁移后校验：逐列确认真的存在，缺一列就算失败
        missing = [
            f"{item.table}.{item.column}"
            for item in COLUMNS
            if item.column not in existing_columns(conn, item.table)
        ]
        if missing:
            print(f"✗ 校验失败，仍缺少：{missing}", file=sys.stderr)
            return 1
        print(f"✓ 迁移完成并校验通过（{total} 列全部存在）")
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 迁移失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="补齐 LLM 管线落库字段")
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
