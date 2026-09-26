"""章节资产资料两张专用表的迁移 / 回滚 / 数据搬运回归测试（全部用 tmp_path 临时库）。

锁住六件事：

1. ``--check`` 只读：跑完表还没建、文件 mtime 不变、没有生成备份；
2. 建表结果与 ORM **逐列一致**（列名顺序 / NOT NULL / 主键 / 外键 / 索引名），
   并用 PRAGMA ``table_info`` 的列名集合与模型 ``__table__.columns`` 断言完全相等，
   唯一约束名 ``uq_chapter_asset_profile_key`` 真的在表定义里；
3. 幂等：连续跑两次，第二次输出"已存在"，各表行数不变；
4. 默认执行自动生成备份（文件名前缀 ``.backup_before_chapter_asset_records_``）；
5. 旧结构数据搬运：同资产多镜头合并成一行、画像优先级、别名/证据并集、``shot_refs`` 按
   ``shot_id`` 去重、``status`` 与 ``asset_id``、``source_summary.migrated_from``、
   刻意不写 runs 表；
6. 回滚：``--check`` 不改库；执行后两张表都不存在，且旧 payload 数据仍在（可再次迁移）。

**绝不连正式库**：不使用 ``DATABASE_URL``、不连 ``backend/jellyfish.db``、
不用 ``with TestClient(app)``；所有库都在 ``tmp_path`` 下现造。
"""

from __future__ import annotations

import importlib.util
import json
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

BACKUP_PREFIX = ".backup_before_chapter_asset_records_"

#: 旧结构的最小表结构（只保留解析 chapter_id / project_id 与装 payload 需要的列）
_LEGACY_DDL: tuple[str, ...] = (
    (
        "CREATE TABLE projects (id VARCHAR(64) NOT NULL PRIMARY KEY, "
        "name VARCHAR(255) NOT NULL DEFAULT '')"
    ),
    "CREATE TABLE chapters (id VARCHAR(64) NOT NULL PRIMARY KEY, project_id VARCHAR(64) NOT NULL)",
    "CREATE TABLE shots (id VARCHAR(64) NOT NULL PRIMARY KEY, chapter_id VARCHAR(64) NOT NULL)",
    (
        "CREATE TABLE shot_extracted_candidates ("
        "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "
        "shot_id VARCHAR(64) NOT NULL, "
        "candidate_type VARCHAR(32) NOT NULL, "
        "candidate_name VARCHAR(255) NOT NULL, "
        "candidate_status VARCHAR(32) NOT NULL DEFAULT 'pending', "
        "linked_entity_id VARCHAR(64), "
        "source VARCHAR(32) NOT NULL DEFAULT 'extraction', "
        "payload JSON NOT NULL DEFAULT '{}')"
    ),
)

_SCRIPT_CACHE: dict[str, Any] = {}


def _load_script(name: str) -> Any:
    """按文件路径加载 scripts/ 下的脚本（只加载一次，避免反复付出导入成本）。

    加载前先登记进 ``sys.modules``：脚本里有 ``from __future__ import annotations`` +
    ``@dataclass``，dataclasses 判断字符串注解时要查 ``sys.modules[cls.__module__]``，
    不登记就会拿到 ``None`` 而在装饰时炸掉。正常 import / 直接执行脚本都不会碰到这点。
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


def _rows(path: Path, table: str, *, order_by: str = "id") -> list[dict[str, Any]]:
    conn = _connect(path, read_only=True)
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(f"SELECT * FROM {table} ORDER BY {order_by}").fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def _create_legacy_tables(path: Path) -> None:
    conn = _connect(path)
    try:
        for ddl in _LEGACY_DDL:
            conn.execute(ddl)
        conn.execute(f"INSERT INTO projects (id, name) VALUES ('{PROJECT_ID}', '测试项目')")
        conn.execute(
            f"INSERT INTO chapters (id, project_id) VALUES ('{CHAPTER_ID}', '{PROJECT_ID}')"
        )
        for shot_id in ("shot-1", "shot-2", "shot-3"):
            conn.execute(f"INSERT INTO shots (id, chapter_id) VALUES ('{shot_id}', '{CHAPTER_ID}')")
        conn.commit()
    finally:
        conn.close()


def _insert_candidate(
    path: Path,
    *,
    shot_id: str,
    candidate_type: str,
    candidate_name: str,
    payload: dict[str, Any],
    linked_entity_id: str | None = None,
) -> None:
    conn = _connect(path)
    try:
        conn.execute(
            "INSERT INTO shot_extracted_candidates "
            "(shot_id, candidate_type, candidate_name, linked_entity_id, payload) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                shot_id,
                candidate_type,
                candidate_name,
                linked_entity_id,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _empty_db(path: Path) -> Path:
    """只有旧结构表、没有任何候选数据的库（用于 --check 只读测试）。"""
    _create_legacy_tables(path)
    return path


def _legacy_db(path: Path) -> Path:
    """完整旧数据：1 条 overlay 行 + 1 条只有 asset_profile 的行 + 1 条同资产不同镜头的重复行。"""
    _create_legacy_tables(path)
    _insert_candidate(
        path,
        shot_id="shot-1",
        candidate_type="character",
        candidate_name="林小满",
        payload={
            "chapter_overlay": {
                "schema": "chapter_overlay.v1",
                "chapter_id": CHAPTER_ID,
                "project_id": PROJECT_ID,
                "asset_type": "character",
                "asset_id": "char-1",
                "name": "林小满",
                "aliases": ["小满"],
                "global_asset": False,
                "plot_identity": "本章女主",
                "chapter_fields": {"appearance": "鹅蛋脸", "hairstyle": "长发"},
                "temporary_notes": ["本章淋雨"],
                "shot_refs": [{"shot_id": "shot-1", "shot_index": 1, "script_excerpt": "推门"}],
                "evidence": [{"snippet": "林小满推门进来", "grounded": True}],
                "source_kind": "candidate",
                "evidence_scope": "shot",
            }
        },
    )
    _insert_candidate(
        path,
        shot_id="shot-2",
        candidate_type="scene",
        candidate_name="破庙",
        payload={
            # 旧确认流程写的键：没有 overlay，画像只能取 asset_profile
            "asset_profile": {"atmosphere": "阴冷"},
            "asset_profile_text": "氛围：阴冷",
            "aliases": ["荒庙"],
            "shot_refs": [{"shot_id": "shot-2", "shot_index": 2}],
            "evidence": [{"snippet": "破庙里没有人"}],
            "linked_entity_id": None,
        },
    )
    _insert_candidate(
        path,
        shot_id="shot-3",
        candidate_type="character",
        candidate_name=" 林 小满 ",  # 归一化后与 shot-1 同一个资产
        payload={
            "chapter_overlay": {
                "chapter_id": CHAPTER_ID,
                "project_id": PROJECT_ID,
                "asset_type": "character",
                "asset_id": None,
                "name": "林小满",
                "aliases": ["林小满小姐"],
                "chapter_fields": {"appearance": "鹅蛋脸（另一镜写法）"},
                "temporary_notes": ["本镜湿发"],
                "shot_refs": [
                    {"shot_id": "shot-3", "shot_index": 3},
                    {"shot_id": "shot-1", "shot_index": 1},  # 与 shot-1 的来源重复 → 去重
                ],
                "evidence": [
                    {"snippet": "林小满推门进来", "grounded": True},  # 与 shot-1 重复 → 去重
                    {"snippet": "她抬头看天"},
                ],
            }
        },
    )
    return path


# ---------------------------------------------------------------------------
# 1) --check 只读
# ---------------------------------------------------------------------------


def test_check_mode_does_not_write(tmp_path: Path, capsys: Any) -> None:
    """``--check`` 不得建表、不得改文件、不得生成备份。"""
    # pylint: disable=import-error  # scripts/ 已在上文注入 sys.path
    import _chapter_asset_records as shared

    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "check_only.db")
    before_mtime = db.stat().st_mtime_ns

    assert migrate.migrate(check_only=True, db_path=db) == 0
    out = capsys.readouterr().out

    # 表一个都没建；文件与边车文件都没变
    assert _tables(db) & set(shared.table_names()) == set()
    assert db.stat().st_mtime_ns == before_mtime
    assert not (tmp_path / "check_only.db-wal").exists()
    assert not (tmp_path / "check_only.db-shm").exists()
    assert list(tmp_path.glob(f"*{BACKUP_PREFIX}*")) == []

    # 如实报告：缺 2 张表 + 有多少条旧数据可搬
    assert "未执行" in out
    assert "缺 2 张表" in out
    assert "扫描到 3 条来源，可合并成 2 行章节资料" in out
    assert "只读连接" in out


def test_print_only_cli_flag_does_not_write(tmp_path: Path, monkeypatch: Any) -> None:
    """``--print-only`` 走命令行入口时也必须只读（flag → check_only 的映射要锁住）。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    import _chapter_asset_records as shared

    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "print_only.db")
    before_mtime = db.stat().st_mtime_ns

    monkeypatch.setattr(
        sys, "argv", ["migrate_chapter_asset_records.py", "--print-only", "--db", str(db)]
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
    import _chapter_asset_records as shared

    import app.models.studio  # noqa: F401 - 导入即把两张表注册进 Base.metadata
    from app.core.db import Base

    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "schema.db")
    assert migrate.migrate(check_only=False, db_path=db) == 0

    # 清单顺序：先 runs（被外键指向）、后 profiles
    assert shared.table_names() == (shared.RUNS_TABLE, shared.PROFILES_TABLE)
    assert shared.TABLE_NAMES == shared.table_names()
    assert shared.table_count() == len(shared.TABLES) == 2
    # 唯一约束的定义片段必须真的在 profiles 的建表 DDL 里（幂等搬运靠它做 ON CONFLICT）
    assert shared.PROFILES_TABLE_UNIQUE_CONSTRAINT in shared.PROFILES_TABLE_DDL

    for item in shared.TABLES:
        orm_table = Base.metadata.tables[item.table]

        # (a) 列名集合完全相等（逐列一致），顺序也一致（PRAGMA 顺序 = DDL 顺序 = ORM 声明顺序）
        actual = _columns(db, item.table)
        assert set(actual) == set(orm_table.columns.keys()), f"{item.table} 列名与 ORM 不一致"
        assert actual == list(orm_table.columns.keys()), f"{item.table} 列顺序与 ORM 不一致"
        assert tuple(actual) == item.columns, f"{item.table} 列与清单不一致"

        # (b) NOT NULL / 主键 / 列顺序一致（类型按 SQLite 方言落：JSON→TEXT、Boolean→BOOLEAN）
        conn = _connect(db, read_only=True)
        try:
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
            assert name in sql, f"{item.table} 的表定义里没有唯一约束 {name}"
    # 唯一约束在 SQLite 里落成 origin='u' 的自动索引，且必须正好盖住 (chapter_id, asset_type, name_key)
    conn = _connect(db, read_only=True)
    try:
        auto_unique = [
            str(row[1])
            for row in conn.execute(f"PRAGMA index_list({shared.PROFILES_TABLE})")
            if str(row[3]) == "u"
        ]
        assert auto_unique, "profiles 表上没有唯一约束的自动索引"
        covered = [
            str(row[2])
            for row in conn.execute(f"PRAGMA index_info({auto_unique[0]})")
        ]
    finally:
        conn.close()
    assert covered == ["chapter_id", "asset_type", "name_key"]


# ---------------------------------------------------------------------------
# 3) 幂等 + 4) 自动备份
# ---------------------------------------------------------------------------


def test_migration_is_idempotent_and_backs_up(tmp_path: Path, capsys: Any) -> None:
    """连续跑两次：第二次报"已存在"、行数不变；每次都生成备份文件。"""
    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "idempotent.db")

    assert migrate.migrate(check_only=False, db_path=db) == 0
    first_out = capsys.readouterr().out
    counts = (_rows(db, "chapter_asset_profiles"), _rows(db, "chapter_asset_profile_runs"))
    assert len(counts[0]) == 2
    assert "新增 2 行" in first_out
    assert "跳过 0 行" in first_out

    # 自动备份：文件名形如 {db.name}.backup_before_chapter_asset_records_{YYYYmmdd_HHMMSS}
    backups = sorted(tmp_path.glob(f"{db.name}{BACKUP_PREFIX}*"))
    assert len(backups) == 1
    assert backups[0].name.startswith(f"{db.name}{BACKUP_PREFIX}")
    assert "已备份数据库" in first_out

    # 第二次：表已存在，数据一条都不重复搬
    assert migrate.migrate(check_only=False, db_path=db) == 0
    second_out = capsys.readouterr().out
    assert "已存在，跳过建表" in second_out
    assert "新增 0 行" in second_out
    assert "跳过 2 行" in second_out
    assert _rows(db, "chapter_asset_profiles") == counts[0]
    assert _rows(db, "chapter_asset_profile_runs") == counts[1]
    # 备份文件名精确到秒，同一秒内重复执行会命中同一个文件（就地覆盖），因此这里只要求"有备份"
    assert len(sorted(tmp_path.glob(f"{db.name}{BACKUP_PREFIX}*"))) >= 1
    assert "已备份数据库" in second_out


# ---------------------------------------------------------------------------
# 5) 旧结构数据搬运
# ---------------------------------------------------------------------------


def test_legacy_payload_rows_are_migrated_and_merged(tmp_path: Path) -> None:
    """3 条候选来源 → 2 行章节资料；画像优先级、并集、去重、状态全部按口径落库。"""
    # pylint: disable=import-error  # scripts/ 已注入 sys.path
    from app.services.studio.llm_orchestration.json_utils import normalize_name

    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "legacy.db")
    assert migrate.migrate(check_only=False, db_path=db) == 0

    profiles = _rows(db, "chapter_asset_profiles")
    assert len(profiles) == 2
    # 刻意不写生成记录表：迁移数据没有 run，服务层会把这种章节标成 records_only
    assert _rows(db, "chapter_asset_profile_runs") == []

    by_key = {row["name_key"]: row for row in profiles}
    assert set(by_key) == {normalize_name("林小满"), normalize_name("破庙")}

    # --- 角色：overlay 行 + 同资产不同镜头的重复行合并成一行 ---
    character = by_key[normalize_name("林小满")]
    assert character["project_id"] == PROJECT_ID
    assert character["chapter_id"] == CHAPTER_ID
    assert character["asset_type"] == "character"
    assert character["name"] == "林小满"
    assert character["name_key"] == "林小满"
    # profile 优先取 overlay 的 chapter_fields（第一条 overlay 来源胜出，不混另一镜的写法）
    assert json.loads(character["profile"]) == {"appearance": "鹅蛋脸", "hairstyle": "长发"}
    # 别名取并集
    assert json.loads(character["aliases"]) == ["小满", "林小满小姐"]
    # 证据取并集（重复的 snippet 去重）
    evidence = json.loads(character["evidence"])
    assert [entry["snippet"] for entry in evidence] == ["林小满推门进来", "她抬头看天"]
    # shot_refs 按 shot_id 去重（shot-1 两条来源只留一条）
    refs = json.loads(character["shot_refs"])
    assert [ref["shot_id"] for ref in refs] == ["shot-1", "shot-3"]
    # overlay 的剧情身份与临时补充
    assert character["plot_identity"] == "本章女主"
    assert json.loads(character["temporary_notes"]) == ["本章淋雨"]
    # 受保护语义：有 asset_id → confirmed（重新分析不覆盖）
    assert character["asset_id"] == "char-1"
    assert character["status"] == "confirmed"
    # 搬运不产生人工修改 / 用户补充 / 合并过程；确认时间不伪造；run_id 保持 NULL
    assert json.loads(character["manual_overrides"]) == {}
    assert json.loads(character["user_notes"]) == []
    assert json.loads(character["merge_sources"]) == []
    assert character["link_action"] == ""
    assert character["source_hash"] == ""
    assert character["confirmed_at"] is None
    assert character["run_id"] is None
    summary = json.loads(character["source_summary"])
    assert summary["migrated_from"] == "shot_extracted_candidates.payload"
    assert summary["migrated_at"]
    assert character["generated_at"] and character["created_at"] and character["updated_at"]

    # --- 场景：没有 overlay，画像取 asset_profile，没有 asset_id → generated ---
    scene = by_key[normalize_name("破庙")]
    assert scene["asset_type"] == "scene"
    assert scene["name"] == "破庙"
    assert json.loads(scene["profile"]) == {"atmosphere": "阴冷"}
    assert json.loads(scene["aliases"]) == ["荒庙"]
    assert [ref["shot_id"] for ref in json.loads(scene["shot_refs"])] == ["shot-2"]
    assert [entry["snippet"] for entry in json.loads(scene["evidence"])] == ["破庙里没有人"]
    assert scene["plot_identity"] == ""
    assert scene["asset_id"] is None
    assert scene["status"] == "generated"


def test_migration_reports_stats_output(tmp_path: Path, capsys: Any) -> None:
    """统计输出要如实给出：新增/跳过行数、按类型分布、多少行带 asset_id。"""
    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "stats.db")
    assert migrate.migrate(check_only=False, db_path=db) == 0
    out = capsys.readouterr().out
    assert "新增 2 行" in out
    assert "按类型分布：character 1 / scene 1" in out
    assert "带 asset_id（已确认，重新分析不覆盖）：1 行" in out
    assert "records_only" in out


# ---------------------------------------------------------------------------
# 6) 回滚
# ---------------------------------------------------------------------------


def test_rollback_check_then_drop_keeps_legacy_payload(tmp_path: Path, capsys: Any) -> None:
    """``--check`` 不改库；执行回滚后两张表消失，旧 payload 仍在且可再次迁移。"""
    rollback = _load_script("rollback_chapter_asset_records")
    migrate = _load_script("migrate_chapter_asset_records")
    db = _legacy_db(tmp_path / "rollback.db")
    assert migrate.migrate(check_only=False, db_path=db) == 0
    capsys.readouterr()
    before_profiles = _rows(db, "chapter_asset_profiles")

    # --check：只报告将被删的表与各表行数，一个字都不写
    check_mtime = db.stat().st_mtime_ns
    assert rollback.drop_tables(check_only=True, db_path=db) == 0
    check_out = capsys.readouterr().out
    assert "chapter_asset_profiles（当前 2 行）" in check_out
    assert "chapter_asset_profile_runs（当前 0 行）" in check_out
    assert "未执行" in check_out
    assert db.stat().st_mtime_ns == check_mtime
    assert _rows(db, "chapter_asset_profiles") == before_profiles

    # 执行回滚：表没了，旧结构 payload 一行不少
    assert rollback.drop_tables(db_path=db) == 0
    drop_out = capsys.readouterr().out
    assert "DROP TABLE chapter_asset_profiles" in drop_out
    assert "DROP TABLE chapter_asset_profile_runs" in drop_out
    assert "旧结构" in drop_out  # 如实说明"新写入的资料会丢、旧 payload 还能搬回来"
    assert "已备份数据库" in drop_out
    tables = _tables(db)
    assert "chapter_asset_profiles" not in tables
    assert "chapter_asset_profile_runs" not in tables
    candidates = _rows(db, "shot_extracted_candidates")
    assert len(candidates) == 3
    payloads = {row["shot_id"]: json.loads(str(row["payload"])) for row in candidates}
    assert payloads["shot-1"]["chapter_overlay"]["asset_id"] == "char-1"
    assert payloads["shot-2"]["asset_profile"] == {"atmosphere": "阴冷"}

    # 再迁移一次：完整搬回来（可重复往返）
    assert migrate.migrate(check_only=False, db_path=db) == 0
    assert len(_rows(db, "chapter_asset_profiles")) == 2
    assert _tables(db) >= {"chapter_asset_profiles", "chapter_asset_profile_runs"}


def test_rollback_on_clean_db_reports_nothing_to_do(tmp_path: Path, capsys: Any) -> None:
    """库里本来就没有这两张表时，回滚直接报"无需回滚"，也不生成备份。"""
    rollback = _load_script("rollback_chapter_asset_records")
    db = _empty_db(tmp_path / "clean.db")
    before_mtime = db.stat().st_mtime_ns
    assert rollback.drop_tables(db_path=db) == 0
    assert "无需回滚" in capsys.readouterr().out
    assert db.stat().st_mtime_ns == before_mtime
    assert list(tmp_path.glob(f"*{BACKUP_PREFIX}*")) == []
