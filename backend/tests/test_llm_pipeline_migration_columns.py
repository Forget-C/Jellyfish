"""迁移/回滚列清单的回归测试（2026-09-19 修对称性）。

背景：`migrate_llm_pipeline_columns.py` 与 `rollback_llm_pipeline_columns.py` 各维护过一份
列清单，漂移成「迁移 11 列 / 回滚 10 列」（迁移漏 video_prompt、video_prompt_source；
回滚漏 audio_opt_out），于是"迁移后能跑、回滚回不到迁移前"。

这里锁住三件事：
1. 清单只有一份、两个脚本都从它派生，且**逐列完全对称**；
2. 清单和 ORM 模型一致（模型后来加列而忘了补清单时，这条会红）；
3. 在临时库上跑通「迁移前缺列 → 迁移 → 全部存在 → 回滚 → 回到迁移前」，并验证幂等。

测试全程使用 ``tmp_path`` 下的临时库，绝不碰 ``backend/jellyfish.db``。
"""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BACKEND_ROOT / "scripts"

# scripts/ 入 sys.path：脚本本身也这么做（`from _llm_pipeline_columns import ...`），
# 这样测试里拿到的共享清单与两个脚本加载到的是**同一个模块对象**（能断言 is 相等）。
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _load_script(name: str):
    """按文件路径加载 scripts/ 下的脚本（不污染 sys.modules 包结构）。"""
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location(f"_jf_script_{name}", SCRIPTS_DIR / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# 1) 清单对称性 + 与模型一致
# ---------------------------------------------------------------------------


def test_shared_column_list_is_symmetric_between_migrate_and_rollback() -> None:
    """迁移与回滚必须使用同一份清单，且数量/内容完全一致。"""
    # pylint: disable=import-error  # scripts/ 已在上文注入 sys.path
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _llm_pipeline_columns as shared

    migrate = _load_script("migrate_llm_pipeline_columns")
    rollback = _load_script("rollback_llm_pipeline_columns")

    assert migrate.COLUMNS is shared.COLUMNS
    assert rollback.COLUMNS is shared.COLUMNS
    # 数量动态取自清单本身（清单是唯一来源，不在测试里写死）
    assert shared.column_count() == len(shared.COLUMNS)
    assert shared.column_pairs() == tuple((c.table, c.column) for c in shared.COLUMNS)

    # 各段构成必须都在（防止"漏了两列"这种历史问题复发）
    pairs = set(shared.column_pairs())
    assert len([p for p in pairs if p[1] == "image_prompts"]) == 5
    assert len([p for p in pairs if p[1] == "is_primary"]) == 4
    assert len([p for p in pairs if p[1] == "start_mode"]) == 1
    assert ("projects", "start_mode") in pairs
    assert {
        ("shot_details", "video_prompt"),
        ("shot_details", "video_prompt_source"),
        ("shot_details", "audio_file_id"),
        ("shot_details", "audio_opt_out"),
    } <= pairs


def test_column_list_matches_orm_models() -> None:
    """清单里的每一列都必须在 SQLAlchemy 模型里真实存在（模型加列而清单没跟 → 红）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _llm_pipeline_columns as shared

    import importlib

    from app.core.db import Base

    importlib.import_module("app.models.studio")  # 导入即把全部表注册进 Base.metadata

    metadata = Base.metadata
    missing: list[str] = []
    for item in shared.COLUMNS:
        table = metadata.tables.get(item.table)
        if table is None:
            missing.append(f"{item.table}(表不存在)")
            continue
        if item.column not in table.columns:
            missing.append(f"{item.table}.{item.column}")
    assert missing == [], f"清单与模型不一致：{missing}"


# ---------------------------------------------------------------------------
# 2) 临时库上的迁移 → 回滚 往返
# ---------------------------------------------------------------------------

# 迁移前的最小表结构（只包含与本清单相关的表，字段刻意不含新增列）
_PRE_MIGRATION_DDL = (
    "CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE scenes (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE props (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE costumes (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE actors (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE actor_images (id INTEGER PRIMARY KEY, actor_id TEXT)",
    "CREATE TABLE scene_images (id INTEGER PRIMARY KEY, scene_id TEXT)",
    "CREATE TABLE prop_images (id INTEGER PRIMARY KEY, prop_id TEXT)",
    "CREATE TABLE costume_images (id INTEGER PRIMARY KEY, costume_id TEXT)",
    "CREATE TABLE shot_details (id TEXT PRIMARY KEY, camera_shot TEXT)",
    # 项目起点列（scripts/_llm_pipeline_columns.py 里的 projects.start_mode）也在这份清单里，
    # 因此最小的「迁移前」结构必须包含 projects 表。
    "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)",
)


def _make_pre_migration_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    try:
        for ddl in _PRE_MIGRATION_DDL:
            conn.execute(ddl)
        # 放几行数据：回滚后必须原样还在（DROP COLUMN 不该动数据）
        conn.execute("INSERT INTO characters (id, name) VALUES ('char-1', '林小满')")
        conn.execute("INSERT INTO shot_details (id, camera_shot) VALUES ('shot-1', 'MS')")
        conn.execute("INSERT INTO projects (id, name) VALUES ('proj-1', '老项目')")
        conn.commit()
    finally:
        conn.close()


def _columns(path: Path, table: str) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]
    finally:
        conn.close()


def test_migrate_then_rollback_round_trip_is_symmetric_and_idempotent(tmp_path: Path) -> None:
    """迁移前缺列 → 迁移 → 清单里的列全有 → 再迁移幂等 → 回滚 → 全无且数据不动。"""
    # pylint: disable=import-error  # scripts/ 已在上文注入 sys.path
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _llm_pipeline_columns as shared

    migrate = _load_script("migrate_llm_pipeline_columns")
    rollback = _load_script("rollback_llm_pipeline_columns")

    db = tmp_path / "round_trip.db"
    _make_pre_migration_db(db)
    before = {item.table: _columns(db, item.table) for item in shared.COLUMNS}

    # 0) 迁移前：清单里的列一个都不存在
    for item in shared.COLUMNS:
        assert item.column not in before[item.table]
    assert migrate.migrate(check_only=True, db_path=db) == 0  # --check 不该写库
    for item in shared.COLUMNS:
        assert item.column not in _columns(db, item.table)

    # 1) 迁移：清单里的列全部存在
    assert migrate.migrate(check_only=False, db_path=db) == 0
    for item in shared.COLUMNS:
        assert item.column in _columns(db, item.table), f"迁移后缺少 {item.table}.{item.column}"

    # 2) 幂等：再迁移一次不报错、也不重复加列
    assert migrate.migrate(check_only=False, db_path=db) == 0
    for item in shared.COLUMNS:
        cols = _columns(db, item.table)
        assert cols.count(item.column) == 1

    # 3) 回滚：清单里的列全部消失，且逐表列定义回到迁移前
    assert rollback.drop_columns(db_path=db) == 0
    for item in shared.COLUMNS:
        assert item.column not in _columns(db, item.table), f"回滚后仍残留 {item.table}.{item.column}"
    for item in shared.COLUMNS:
        assert _columns(db, item.table) == before[item.table]

    # 4) 数据未受影响
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT name FROM characters WHERE id='char-1'").fetchone()[0] == "林小满"
        assert conn.execute("SELECT camera_shot FROM shot_details WHERE id='shot-1'").fetchone()[0] == "MS"
    finally:
        conn.close()

    # 5) 回滚后还能再迁移（往返可重复）
    assert migrate.migrate(check_only=False, db_path=db) == 0
    for item in shared.COLUMNS:
        assert item.column in _columns(db, item.table)


def test_rollback_check_mode_reports_without_writing(tmp_path: Path) -> None:
    """回滚 --check 不得修改数据库。"""
    # pylint: disable=import-error  # scripts/ 已在上文注入 sys.path
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _llm_pipeline_columns as shared

    migrate = _load_script("migrate_llm_pipeline_columns")
    rollback = _load_script("rollback_llm_pipeline_columns")

    db = tmp_path / "check_only.db"
    _make_pre_migration_db(db)
    assert migrate.migrate(check_only=False, db_path=db) == 0
    snapshot = {item.table: _columns(db, item.table) for item in shared.COLUMNS}

    assert rollback.drop_columns(check_only=True, db_path=db) == 0

    for item in shared.COLUMNS:
        assert _columns(db, item.table) == snapshot[item.table]
