"""草稿表迁移/回滚的回归测试（新增表，2026-09-19）。

``migrate_llm_pipeline_columns.py`` 的教训是"迁移与回滚各维护一份清单 → 必然漂移"。
建表同理，这里锁住四件事：

1. 清单只有一份、迁移与回滚都从它派生；
2. 清单里的列与 ORM 模型（``ShotVideoPromptDraft``）**逐列一致** —— 模型加列而清单没跟会红；
3. 临时库上跑通「无表 → 迁移（幂等）→ 有表 → 回滚 → 回到无表」，且**别的表和数据不动**；
4. 迁移建出来的表**能被 ORM 直接读写**（DDL 与模型真的兼容，而不是"看起来像"）。

全程只用 ``tmp_path`` 下的临时库，绝不碰 ``backend/jellyfish.db``。
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import sqlite3
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BACKEND_ROOT / "scripts"

# scripts/ 入 sys.path：脚本本身也这么做（`from _prompt_board_drafts import ...`），
# 这样测试里拿到的共享清单与两个脚本加载到的是**同一个模块对象**。
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _load_script(name: str):
    """按文件路径加载 scripts/ 下的脚本（不污染 sys.modules 包结构）。"""
    spec = importlib.util.spec_from_file_location(f"_jf_script_{name}", SCRIPTS_DIR / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


#: 迁移前的**最小**库结构：草稿表依赖 shots / chapters 两张表（外键），另加一张无关表
#: 用来证明"迁移/回滚不会动别的表"。
_PRE_MIGRATION_DDL = (
    "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE chapters (id TEXT PRIMARY KEY, project_id TEXT)",
    "CREATE TABLE shots (id TEXT PRIMARY KEY, chapter_id TEXT, idx INTEGER)",
    "CREATE TABLE shot_details (id TEXT PRIMARY KEY, video_prompt TEXT NOT NULL DEFAULT '')",
)


def _make_pre_migration_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    try:
        for ddl in _PRE_MIGRATION_DDL:
            conn.execute(ddl)
        conn.execute("INSERT INTO projects (id, name) VALUES ('proj-1', '老项目')")
        conn.execute("INSERT INTO chapters (id, project_id) VALUES ('proj-1::EP01', 'proj-1')")
        conn.execute("INSERT INTO shots (id, chapter_id, idx) VALUES ('shot-1', 'proj-1::EP01', 1)")
        conn.execute("INSERT INTO shot_details (id, video_prompt) VALUES ('shot-1', '正式提示词')")
        conn.commit()
    finally:
        conn.close()


def _tables(path: Path) -> set[str]:
    conn = sqlite3.connect(str(path))
    try:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        return {str(row[0]) for row in rows}
    finally:
        conn.close()


def _columns(path: Path, table: str) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 1) 清单对称性 + 与 ORM 模型一致
# ---------------------------------------------------------------------------


def test_shared_table_list_is_symmetric_between_migrate_and_rollback() -> None:
    """迁移与回滚必须使用同一份清单（表名、数量、内容完全一致）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _prompt_board_drafts as shared

    migrate = _load_script("migrate_prompt_board_drafts")
    rollback = _load_script("rollback_prompt_board_drafts")

    assert migrate.TABLES is shared.TABLES
    assert rollback.TABLES is shared.TABLES
    assert shared.table_count() == len(shared.TABLES)
    assert shared.table_names() == tuple(item.table for item in shared.TABLES)
    # 这次新增的就是看板草稿表（防止清单被清空/改名却没人发现）
    assert shared.DRAFT_TABLE in shared.table_names()
    assert len([item for item in shared.TABLES if item.table == shared.DRAFT_TABLE]) == 1


def test_table_definition_matches_orm_model(tmp_path: Path) -> None:
    """清单里的列/主键/非空必须与 ORM 模型逐项一致（模型加列而清单没跟 → 红）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _prompt_board_drafts as shared

    from app.core.db import Base

    importlib.import_module("app.models.studio")  # 导入即把全部表注册进 Base.metadata

    table = Base.metadata.tables.get(shared.DRAFT_TABLE)
    assert table is not None, f"ORM 里没有 {shared.DRAFT_TABLE} 这张表"

    # 用一个真实临时库执行清单里的 DDL，再拿 PRAGMA 与模型对账
    db = tmp_path / "ddl_only.db"
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(shared.DRAFT_TABLE_DDL)
        info = {str(row[1]): row for row in conn.execute(f"PRAGMA table_info({shared.DRAFT_TABLE})")}
    finally:
        conn.close()

    assert set(info) == {column.name for column in table.columns}, "清单与模型的列不一致"
    assert [name for name, row in info.items() if row[5]] == [
        column.name for column in table.primary_key.columns
    ], "主键不一致"
    for column in table.columns:
        assert bool(info[column.name][3]) == (not column.nullable), f"{column.name} 的 NOT NULL 不一致"


# ---------------------------------------------------------------------------
# 2) 临时库上的迁移 → 回滚 往返
# ---------------------------------------------------------------------------


def test_migrate_then_rollback_round_trip_is_idempotent(tmp_path: Path) -> None:
    """无表 → 迁移 → 有表 → 再迁移幂等 → 回滚 → 无表，且其它表和数据原样保留。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _prompt_board_drafts as shared

    migrate = _load_script("migrate_prompt_board_drafts")
    rollback = _load_script("rollback_prompt_board_drafts")

    db = tmp_path / "round_trip.db"
    _make_pre_migration_db(db)
    before = _tables(db)
    assert shared.DRAFT_TABLE not in before

    # 0) --check 只报告，不写库
    assert migrate.migrate(check_only=True, db_path=db) == 0
    assert shared.DRAFT_TABLE not in _tables(db)
    assert rollback.drop_tables(check_only=True, db_path=db) == 0
    assert _tables(db) == before

    # 1) 迁移：表建出来，索引也建出来
    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert shared.DRAFT_TABLE in _tables(db)
    assert len(_columns(db, shared.DRAFT_TABLE)) > 0
    conn = sqlite3.connect(str(db))
    try:
        indexes = {
            str(row[0])
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'").fetchall()
        }
    finally:
        conn.close()
    for index_ddl in shared.DRAFT_TABLE_INDEXES:
        index_name = index_ddl.split("IF NOT EXISTS ")[1].split(" ")[0]
        assert index_name in indexes, f"索引没建出来：{index_name}"

    # 2) 幂等：再迁移一次不报错、不重复建表
    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert _columns(db, shared.DRAFT_TABLE).count("shot_id") == 1

    # 3) 回滚：表没了，别的一张不少
    assert rollback.drop_tables(db_path=db) == 0
    assert shared.DRAFT_TABLE not in _tables(db)
    assert _tables(db) == before

    # 4) 无关表的数据没被动过
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT video_prompt FROM shot_details WHERE id='shot-1'").fetchone()[0] == "正式提示词"
        assert conn.execute("SELECT name FROM projects WHERE id='proj-1'").fetchone()[0] == "老项目"
    finally:
        conn.close()

    # 5) 回滚后还能再迁移（往返可重复）
    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert shared.DRAFT_TABLE in _tables(db)


def test_migrated_table_is_usable_by_the_orm(tmp_path: Path) -> None:
    """迁移建出来的表必须能被 ORM 直接读写（DDL 与模型真兼容，而不是"看起来像"）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _prompt_board_drafts as shared

    migrate = _load_script("migrate_prompt_board_drafts")
    db = tmp_path / "orm_compat.db"
    _make_pre_migration_db(db)
    assert migrate.migrate(check_only=False, db_path=db) == 0

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.models.studio import ShotVideoPromptDraft

    async def run() -> tuple[str, str, bool]:
        engine = create_async_engine(f"sqlite+aiosqlite:///{db}", future=True)
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with factory() as session:
                session.add(
                    ShotVideoPromptDraft(
                        shot_id="shot-1",
                        chapter_id="proj-1::EP01",
                        status="ok",
                        prompt="迁移建表后写入的草稿",
                        source="llm",
                        error="",
                        model="deepseek-chat",
                        meta={"latency_ms": 12},
                        server_generated=True,
                    )
                )
                await session.commit()
            async with factory() as session:
                row = (
                    await session.execute(
                        select(ShotVideoPromptDraft).where(ShotVideoPromptDraft.shot_id == "shot-1")
                    )
                ).scalar_one()
                return (str(row.prompt), str(row.status), bool(row.server_generated))
        finally:
            await engine.dispose()

    prompt, status, generated = asyncio.run(run())

    assert prompt == "迁移建表后写入的草稿"
    assert status == "ok"
    assert generated is True
    # 迁移后的表里只有这一行草稿；正式列没有被牵连
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT video_prompt FROM shot_details WHERE id='shot-1'").fetchone()[0] == "正式提示词"
        assert conn.execute(f"SELECT COUNT(*) FROM {shared.DRAFT_TABLE}").fetchone()[0] == 1
    finally:
        conn.close()


def test_migrate_refuses_missing_database(tmp_path: Path) -> None:
    """目标库不存在 → 明确拒绝（不静默建一个空库）。"""
    migrate = _load_script("migrate_prompt_board_drafts")
    rollback = _load_script("rollback_prompt_board_drafts")
    missing = tmp_path / "nope" / "missing.db"
    assert migrate.migrate(check_only=False, db_path=missing) == 1
    assert rollback.drop_tables(db_path=missing) == 1
    assert not missing.exists()
