#!/usr/bin/env python3
"""把旧结构里的章节资产资料搬进专用表 ``chapter_asset_profiles``（幂等、带备份、可回滚）。

为什么需要搬运
==============

改造前，"章节范围的结构化资产资料"塞在两个地方，两者都挂在**候选行**上：

1. ``shot_extracted_candidates.payload.chapter_overlay`` —— ``asset_overlays.py`` 写入的
   章节隔离层（结构见 ``ChapterAssetOverlay.to_payload()``：``chapter_id`` / ``project_id`` /
   ``asset_type`` / ``asset_id`` / ``name`` / ``aliases`` / ``global_asset`` /
   ``plot_identity`` / ``chapter_fields`` / ``temporary_notes`` / ``shot_refs`` /
   ``evidence`` / ``source_kind`` / ``evidence_scope``）；
2. 同一 payload 上的 ``asset_profile`` / ``asset_profile_text`` / ``aliases`` /
   ``shot_refs`` / ``evidence`` / ``linked_entity_id``（旧确认流程写的）。

而 ``/script-processing/extract`` 会 ``replace_for_shot`` 先删候选行再重建 ——
挂在候选行上的资料会**一起消失**（人工确认过的也没了）。所以这里把旧结构里的资料
搬进专用表：数据库成为事实来源，重启不丢、重新提取不丢。

搬运规则（与用户口径一致）
==========================

- 来源行按 ``shot_extracted_candidates.shot_id → shots.chapter_id → chapters.project_id``
  解析出 ``chapter_id`` / ``project_id``（章节隔离靠它落地）；
- 同一 ``(chapter_id, asset_type, 归一化名称)`` 的多条来源**合并成一行**：
  ``profile`` 优先取 overlay 的 ``chapter_fields``（没有 overlay 才取 ``asset_profile``）、
  ``aliases`` / ``evidence`` 取并集（按内容去重）、``shot_refs`` 取并集（按 ``shot_id`` 去重）、
  ``plot_identity`` / ``temporary_notes`` 取 overlay 的值、
  ``asset_id`` 取 overlay 的 ``asset_id``，否则 payload 的 ``linked_entity_id``；
- **受保护语义**：搬进来的行只要有 ``asset_id`` 一律 ``status='confirmed'``，
  等于"已确认、重新分析不覆盖"（服务层 ``_protected`` 认这个状态）；
- ``name_key`` 用代码里那一份归一化实现
  （``app.services.studio.llm_orchestration.json_utils.normalize_name``），绝不另写一套；
- **刻意不写** ``chapter_asset_profile_runs``：迁移的数据没有生成记录，服务层会把这种章节
  标成 ``records_only``，如实显示"找不到生成记录，可能是从旧结构迁移过来的"。
  因此搬进来的行 ``run_id`` 保持 NULL、``confirmed_at`` 不伪造（旧结构没记时间）。

幂等
====

- 建表：``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``；
- 搬数据：``INSERT ... ON CONFLICT(chapter_id, asset_type, name_key) DO NOTHING`` ——
  库里已有同样的行（含应用后来写入、甚至被人工确认过的行）**一个字都不动**，
  重复执行结果一致，只统计"新增 / 跳过"。

备份
====

默认执行**先备份**再用 SQLite ``backup`` API 做一致性快照，文件名
``{db.name}.backup_before_chapter_asset_records_{YYYYmmdd_HHMMSS}``
（WAL 下直接拷文件会丢未 checkpoint 的数据）。``--check`` / ``--print-only``
全程只开**只读连接**（``file:...?mode=ro``），不写库、也不生成备份。

跑法：
    cd backend && uv run python scripts/migrate_chapter_asset_records.py              # 执行
    cd backend && uv run python scripts/migrate_chapter_asset_records.py --check      # 只检查
    cd backend && uv run python scripts/migrate_chapter_asset_records.py --print-only  # 只打印统计
    cd backend && uv run python scripts/migrate_chapter_asset_records.py --db /tmp/copy.db

同目录另有回滚脚本 ``rollback_chapter_asset_records.py``；建表清单**只有一份**：
``scripts/_chapter_asset_records.py``（与回滚脚本共用，禁止各写一份）。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# 直接跑脚本时 sys.path[0] 是 scripts/（清单模块在这一层），而 cwd 不在路径上；
# 归一化函数来自 app 包，所以两个目录都要显式兜一层。
SCRIPT_DIR = Path(__file__).resolve().parent
for _entry in (SCRIPT_DIR, BACKEND_ROOT):
    if str(_entry) not in sys.path:
        sys.path.insert(0, str(_entry))

# pylint: disable=import-error,wrong-import-position  # 上面刚把 scripts/ 与 backend/ 注入 sys.path
from _chapter_asset_records import (  # noqa: E402
    PROFILES_TABLE,
    RUNS_TABLE,
    TABLES,
    describe,
    index_names,
    table_count,
)

# 归一化名称与资产类型一律用代码里那一份实现（禁止自己写一套，否则与读写路径不一致）。
from app.services.studio.asset_profiles import ASSET_TYPES, normalize_asset_type  # noqa: E402
from app.services.studio.llm_orchestration.json_utils import normalize_name  # noqa: E402

DB_PATH = BACKEND_ROOT / "jellyfish.db"

#: 写进 ``source_summary.migrated_from`` 的来源标记（如实说明这些行是搬来的）。
MIGRATED_FROM = "shot_extracted_candidates.payload"

#: 判定"这一行 payload 里确实有旧结构章节资料"的键：**有资料**（overlay / asset_profile）
#: 或**有关联**（linked_entity_id）才算一条来源。只有 ``aliases`` / ``shot_refs`` /
#: ``evidence`` 的 payload 不搬 —— 那样只会产出没有资料的空行。
SOURCE_TRIGGER_KEYS: tuple[str, ...] = (
    "chapter_overlay",
    "asset_profile",
    "asset_profile_text",
    "linked_entity_id",
)

#: 旧结构扫描 SQL：候选行 → 镜头 → 章节，一次性把解析 ``chapter_id`` / ``project_id``
#: 需要的信息读出来（找不到镜头/章节的行会被跳过并计入统计）。
_LEGACY_QUERY = """
SELECT c.id, c.shot_id, c.candidate_type, c.candidate_name, c.linked_entity_id, c.payload,
       s.chapter_id, ch.project_id
FROM shot_extracted_candidates AS c
LEFT JOIN shots AS s ON s.id = c.shot_id
LEFT JOIN chapters AS ch ON ch.id = s.chapter_id
ORDER BY c.id
""".strip()

#: 搬数据的插入语句：靠唯一约束 ``uq_chapter_asset_profile_key`` 做冲突忽略（幂等）。
_INSERT_SQL = f"""
INSERT INTO {PROFILES_TABLE} (
    project_id, chapter_id, asset_type, name, name_key,
    aliases, profile, manual_overrides, user_notes, shot_refs, evidence, merge_sources,
    plot_identity, temporary_notes, asset_id, link_action, status, source_hash, source_summary,
    generated_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(chapter_id, asset_type, name_key) DO NOTHING
""".strip()


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


# ---------------------------------------------------------------------------
# 旧结构解析 + 合并
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class LegacySource:
    """一条旧结构来源：某个候选行 payload 里的一份章节资产资料。"""

    candidate_id: int
    shot_id: str
    chapter_id: str
    project_id: str
    asset_type: str
    name: str
    #: 结构化画像是否来自 overlay 的 ``chapter_fields``（合并时 overlay 优先）
    profile_from_overlay: bool
    profile: dict[str, str] = field(default_factory=dict)
    aliases: list[str] = field(default_factory=list)
    shot_refs: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    plot_identity: str = ""
    temporary_notes: list[str] = field(default_factory=list)
    asset_id: str | None = None


def _as_dict(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def _as_text(raw: Any) -> str:
    return str(raw).strip() if raw is not None else ""


def _as_str_list(raw: Any) -> list[str]:
    """任意来源的别名/备注列表 → 非空字符串列表（与 ``_strip_map`` 同口径）。"""
    if not isinstance(raw, (list, tuple)):
        return []
    return [str(item).strip() for item in raw if str(item or "").strip()]


def _as_dict_list(raw: Any) -> list[dict[str, Any]]:
    """任意来源的依据列表 → 只保留对象条目（丢弃字符串等杂物，不伪造结构）。"""
    if not isinstance(raw, (list, tuple)):
        return []
    return [dict(item) for item in raw if isinstance(item, dict)]


def _strip_profile(raw: Any) -> dict[str, str]:
    """结构化画像：只留"非空文本"字段（与 ``chapter_asset_record_store._strip_map`` 一致）。"""
    return {
        str(key): str(value).strip()
        for key, value in _as_dict(raw).items()
        if str(value or "").strip()
    }


def _load_payload(raw: Any) -> dict[str, Any] | None:
    """把候选行的 ``payload`` 列解析成字典；解析不了返回 ``None``（调用方计入跳过）。"""
    if isinstance(raw, dict):
        return raw
    if raw is None:
        return {}
    text = str(raw).strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def collect_sources(conn: sqlite3.Connection) -> tuple[list[LegacySource], dict[str, int]]:
    """扫描候选表，解析出全部旧结构来源；返回 ``(来源列表, 跳过原因统计)``。

    候选表本身不存在（全新库）时返回空列表 —— 这不是错误，只是"没有可搬的旧数据"。
    """
    skipped: dict[str, int] = {
        "payload 不是 JSON 对象": 0,
        "payload 里没有章节资料": 0,
        "找不到镜头或所属章节": 0,
        "资产类型无法识别": 0,
        "缺少资产名称": 0,
    }
    try:
        rows = conn.execute(_LEGACY_QUERY).fetchall()
    except sqlite3.Error:
        return [], skipped

    sources: list[LegacySource] = []
    for row in rows:
        (
            candidate_id,
            shot_id,
            candidate_type,
            candidate_name,
            linked_entity_id,
            payload_raw,
            chapter_id,
            project_id,
        ) = row
        payload = _load_payload(payload_raw)
        if payload is None:
            skipped["payload 不是 JSON 对象"] += 1
            continue
        if not any(key in payload for key in SOURCE_TRIGGER_KEYS):
            skipped["payload 里没有章节资料"] += 1
            continue
        if not chapter_id or not project_id:
            skipped["找不到镜头或所属章节"] += 1
            continue

        overlay = _as_dict(payload.get("chapter_overlay"))
        # overlay 是"章节隔离层"，它的类型/名称优先；没有 overlay 时用候选行自己的。
        asset_type = normalize_asset_type(overlay.get("asset_type") if overlay else candidate_type)
        if asset_type not in ASSET_TYPES:
            skipped["资产类型无法识别"] += 1
            continue
        name = _as_text(overlay.get("name") if overlay else "") or _as_text(candidate_name)
        if not name or not normalize_name(name):
            skipped["缺少资产名称"] += 1
            continue

        overlay_profile = _strip_profile(overlay.get("chapter_fields")) if overlay else {}
        payload_profile = _strip_profile(payload.get("asset_profile"))
        profile = overlay_profile or payload_profile
        asset_id = (
            _as_text(overlay.get("asset_id"))
            or _as_text(payload.get("linked_entity_id"))
            or _as_text(linked_entity_id)
        )
        sources.append(
            LegacySource(
                candidate_id=int(candidate_id),
                shot_id=_as_text(shot_id),
                chapter_id=str(chapter_id),
                project_id=str(project_id),
                asset_type=asset_type,
                name=name,
                profile_from_overlay=bool(overlay_profile),
                profile=profile,
                # overlay 与旧确认流程写的别名/依据都要（合并阶段去重）
                aliases=_as_str_list(overlay.get("aliases")) + _as_str_list(payload.get("aliases")),
                shot_refs=(
                    _as_dict_list(overlay.get("shot_refs"))
                    + _as_dict_list(payload.get("shot_refs"))
                ),
                evidence=(
                    _as_dict_list(overlay.get("evidence")) + _as_dict_list(payload.get("evidence"))
                ),
                plot_identity=_as_text(overlay.get("plot_identity")),
                temporary_notes=_as_str_list(overlay.get("temporary_notes")),
                asset_id=asset_id or None,
            )
        )
    return sources, skipped


def _canonical(value: Any) -> str:
    """条目的稳定文本形态（去重用；键排序，保证同样的内容得到同样的标记）。"""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)


def _dedup(entries: list[dict[str, Any]], *, key: str) -> list[dict[str, Any]]:
    """依据列表取并集：优先按 ``key``（例如 ``shot_id``）去重，没有该键时按内容去重。"""
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        marker = _as_text(entry.get(key)) or _canonical(entry)
        if marker in seen:
            continue
        seen.add(marker)
        merged.append(entry)
    return merged


def _first_text(items: list[LegacySource], getter: Any) -> str:
    for item in items:
        value = _as_text(getter(item))
        if value:
            return value
    return ""


def merge_sources(sources: list[LegacySource], *, migrated_at: str) -> list[dict[str, Any]]:
    """把来源合并成"一章一个资产一行"的待插入记录（同一 key 多条来源合并成一行）。"""
    groups: dict[tuple[str, str, str], list[LegacySource]] = {}
    for source in sources:
        key = (source.chapter_id, source.asset_type, normalize_name(source.name))
        if not key[2]:
            continue
        groups.setdefault(key, []).append(source)

    records: list[dict[str, Any]] = []
    for (chapter_id, asset_type, name_key), items in sorted(groups.items()):
        # profile：overlay 的 chapter_fields 优先；没有 overlay 的才用 asset_profile。
        ordered = [item for item in items if item.profile_from_overlay]
        ordered += [item for item in items if not item.profile_from_overlay]
        profile: dict[str, str] = {}
        for item in ordered:
            if item.profile:
                profile = dict(item.profile)
                break
        asset_id = next((item.asset_id for item in items if item.asset_id), None)
        records.append(
            {
                "project_id": items[0].project_id,
                "chapter_id": chapter_id,
                "asset_type": asset_type,
                "name": _first_text(items, lambda item: item.name),
                "name_key": name_key,
                "aliases": sorted({alias for item in items for alias in item.aliases}),
                "profile": profile,
                "shot_refs": _dedup(
                    [ref for item in items for ref in item.shot_refs], key="shot_id"
                ),
                "evidence": _dedup(
                    [entry for item in items for entry in item.evidence], key="snippet"
                ),
                "plot_identity": _first_text(items, lambda item: item.plot_identity),
                "temporary_notes": next(
                    (list(item.temporary_notes) for item in items if item.temporary_notes), []
                ),
                "asset_id": asset_id,
                # 受保护语义：有 asset_id = 已确认 → 重新分析不覆盖（服务层认这个状态）
                "status": "confirmed" if asset_id else "generated",
                "source_summary": {"migrated_from": MIGRATED_FROM, "migrated_at": migrated_at},
            }
        )
    return records


def _existing_keys(conn: sqlite3.Connection) -> set[tuple[str, str, str]]:
    """库里已有的 ``(chapter_id, asset_type, name_key)``（表不存在时返回空集）。"""
    try:
        rows = conn.execute(
            f"SELECT chapter_id, asset_type, name_key FROM {PROFILES_TABLE}"
        ).fetchall()
    except sqlite3.Error:
        return set()
    return {(str(row[0]), str(row[1]), str(row[2])) for row in rows}


def _json_text(value: Any) -> str:
    """JSON 列的写入文本（与 ORM 的 JSON 列互读无障碍；中文不转义，便于人工查看）。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def apply_records(
    conn: sqlite3.Connection,
    records: list[dict[str, Any]],
    existing: set[tuple[str, str, str]],
    *,
    now_stamp: str,
) -> dict[str, Any]:
    """把合并好的记录插进 ``chapter_asset_profiles``（已存在的 key 一律跳过）。"""
    inserted = 0
    skipped_existing = 0
    by_type: dict[str, int] = {}
    confirmed = 0
    for record in records:
        key = (record["chapter_id"], record["asset_type"], record["name_key"])
        if key in existing:
            skipped_existing += 1
            continue
        before = conn.total_changes
        conn.execute(
            _INSERT_SQL,
            (
                record["project_id"],
                record["chapter_id"],
                record["asset_type"],
                record["name"],
                record["name_key"],
                _json_text(record["aliases"]),
                _json_text(record["profile"]),
                "{}",  # manual_overrides：搬运不产生人工修改
                "[]",  # user_notes：搬运不产生用户补充
                _json_text(record["shot_refs"]),
                _json_text(record["evidence"]),
                "[]",  # merge_sources：旧结构没有合并过程记录，不伪造
                record["plot_identity"],
                _json_text(record["temporary_notes"]),
                record["asset_id"],
                "",  # link_action：旧结构没记建/绑动作
                record["status"],
                "",  # source_hash：旧结构没有剧本签名
                _json_text(record["source_summary"]),
                now_stamp,
                now_stamp,
                now_stamp,
            ),
        )
        if conn.total_changes > before:
            inserted += 1
            existing.add(key)
            by_type[record["asset_type"]] = by_type.get(record["asset_type"], 0) + 1
            if record["asset_id"]:
                confirmed += 1
        else:
            # 唯一约束命中（并发或上面那句 SELECT 之后又插入了同样的行）
            skipped_existing += 1
    return {
        "inserted": inserted,
        "skipped": skipped_existing,
        "by_type": by_type,
        "confirmed": confirmed,
    }


def _print_skipped(skipped: dict[str, int]) -> None:
    for reason, count in skipped.items():
        if count:
            print(f"  - 跳过 {count} 条来源：{reason}")


def migrate(*, check_only: bool, db_path: Path | None = None) -> int:
    """执行建表 + 数据搬运；``check_only=True`` 时只报告不写库。返回进程退出码。"""
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

        now = datetime.now()
        now_stamp = now.strftime("%Y-%m-%d %H:%M:%S")
        migrated_at = datetime.now(timezone.utc).isoformat()
        sources, skipped = collect_sources(conn)
        records = merge_sources(sources, migrated_at=migrated_at)
        existing = _existing_keys(conn)
        waiting = [
            record
            for record in records
            if (record["chapter_id"], record["asset_type"], record["name_key"]) not in existing
        ]

        if pending_tables:
            print(f"待新建 {len(pending_tables)}/{total} 张表：")
            for item in pending_tables:
                print(f"  + {item.table}（{item.why}）")
        print(f"旧结构：扫描到 {len(sources)} 条来源，可合并成 {len(records)} 行章节资料（库里还没有 {len(waiting)} 行）")
        _print_skipped(skipped)

        if check_only:
            print(
                f"（--check 模式，未执行；缺 {len(pending_tables)} 张表，"
                f"待搬运 {len(waiting)} 行）"
            )
            print("  只读连接：没有建表、没有搬数据、没有生成备份。")
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

        stats = apply_records(conn, records, existing, now_stamp=now_stamp)
        conn.commit()

        # 最后再逐列校验一次（建表 + 搬数据之后），缺一列即失败
        problems = verify_schema(conn)
        if problems:
            for problem in problems:
                print(f"✗ 迁移后校验失败：{problem}", file=sys.stderr)
            return 1
        print("✓ 迁移后校验通过（逐列与清单一致）")

        distribution = " / ".join(
            f"{name} {count}" for name, count in sorted(stats["by_type"].items())
        )
        print("✓ 数据搬运完成：")
        print(f"  - 新增 {stats['inserted']} 行")
        print(f"  - 跳过 {stats['skipped']} 行（库里已有同样的「章节 + 类型 + 归一化名称」，一律不动）")
        print(f"  - 按类型分布：{distribution or '（本次没有新增）'}")
        print(f"  - 带 asset_id（已确认，重新分析不覆盖）：{stats['confirmed']} 行")
        print(
            f"  说明：本次**刻意没有**写 {RUNS_TABLE} —— 迁移来的资料没有生成记录，"
            "服务层会把这种章节标成 records_only，如实显示来源。"
        )
        return 0
    except sqlite3.Error as exc:
        print(f"✗ 迁移失败：{exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="补建章节资产资料专用表并搬运旧结构数据")
    parser.add_argument("--check", action="store_true", help="只检查缺哪些表 / 有多少旧数据可搬，不修改")
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
