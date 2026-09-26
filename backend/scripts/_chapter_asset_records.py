"""SQLite 建表清单（章节资产资料的**两张专用表**）：迁移脚本与回滚脚本共用这一份。

为什么必须有这个文件（与 ``_llm_pipeline_columns.py`` / ``_prompt_board_drafts.py`` 同理）：
建表口径只有一份 —— 迁移脚本按它建表、回滚脚本按它删表、测试按它逐列比对 ORM 模型。
两侧各维护一份清单必然漂移（历史上已经发生过"迁移 11 列 / 回滚 10 列"这种不对称）。

清单内容（数量由 :func:`table_count` 动态给出，不在别处写死）：

1. ``chapter_asset_profile_runs``（**先建**）：一次"整章分析"一行 —— 内容签名 ``cache_key``、
   来源摘要、是否真的调了模型 / 是否演练、运行元信息与技术详情。
   必须先建，因为第 2 张表有外键指向它（``run_id``）。
2. ``chapter_asset_profiles``（**后建**）：一章一个资产一行 —— 规范名称 / 别名 / 结构化画像 /
   人工修改 / 用户补充 / 出镜依据 / 已关联资产 ID / 状态。
   唯一约束 ``uq_chapter_asset_profile_key (chapter_id, asset_type, name_key)``
   是**幂等搬运的依据**（迁移用 ``ON CONFLICT ... DO NOTHING``，重复执行不会重复搬）。

为什么是 Python 而不是 ``sql/0xx*.sql``：``sql/`` 下的文件是 MySQL 方言
（``information_schema`` / ``TINYINT``），运行时用的却是 SQLite。这里给的是**真能跑**的
SQLite 建表器：``IF NOT EXISTS`` 幂等、带备份、可回滚。

DDL 与 ``app/models/studio_asset_profiles.py`` 的 ORM 定义**逐列一致**：列名、顺序、
``NOT NULL``、``DEFAULT``、唯一约束名、外键的 ``ON DELETE`` 动作、索引名全部对齐。
类型按 SQLite 方言落：``JSON → TEXT NOT NULL DEFAULT '{}' | '[]'``、
``Boolean → BOOLEAN NOT NULL DEFAULT 0``、``DateTime(timezone=True) → DATETIME``、
``String(n) → VARCHAR(n)``、``Text → TEXT``、``Integer`` 主键 → ``INTEGER NOT NULL
PRIMARY KEY AUTOINCREMENT``（对应 ORM 的 ``Integer primary_key=True autoincrement=True``；
``AUTOINCREMENT`` 只影响 rowid 复用策略，列名与语义不变）。
``tests/test_chapter_asset_record_migration.py`` 会用 PRAGMA ``table_info`` 与 ORM 的
``__table__.columns`` 逐列比对（模型加列而这里没跟 → 测试变红）。
"""

from __future__ import annotations

from dataclasses import dataclass

#: 生成记录表（一次整章分析一行；**先建**，另一张表的外键指向它）
RUNS_TABLE = "chapter_asset_profile_runs"

#: 章节资产资料表（一章一个资产一行；**后建**，删表时必须先删它）
PROFILES_TABLE = "chapter_asset_profiles"

#: 旧结构（把章节资料塞在候选 payload 里）用到的键：迁移脚本按这些键找旧数据。
#:
#: 改造前的两个载体：
#: - ``chapter_overlay``：``asset_overlays.py`` 写的章节隔离层（含
#:   ``chapter_fields`` / ``aliases`` / ``shot_refs`` / ``evidence`` / ``asset_id`` 等，
#:   结构见 ``ChapterAssetOverlay.to_payload()``）；
#: - ``asset_profile`` / ``asset_profile_text`` / ``aliases`` / ``shot_refs`` /
#:   ``evidence`` / ``linked_entity_id``：旧确认流程写在同一 payload 上的结构化资料。
#:
#: 两者都挂在**候选行**上，而重新提取会先删后建候选行 —— 这正是资料会丢的原因。
LEGACY_PAYLOAD_KEYS: tuple[str, ...] = (
    "chapter_overlay",
    "asset_profile",
    "asset_profile_text",
    "aliases",
    "shot_refs",
    "evidence",
    "linked_entity_id",
)


@dataclass(frozen=True, slots=True)
class NewTable:
    """一张新增表。

    - ``ddl``：``CREATE TABLE IF NOT EXISTS ...`` 的完整定义（迁移用）；列名顺序与 ORM 一致；
    - ``indexes``：建表后按顺序执行的 ``CREATE INDEX IF NOT EXISTS ...``；
    - ``columns``：期望的列名（按 ORM 声明顺序）—— 迁移后逐列校验、测试比对 ORM 都用它；
    - ``constraints``：命名的唯一约束（迁移后校验"约束名真的在表定义里"）；
    - ``why``：为什么要这张表（迁移输出与文档引用，避免"加了张看不懂的表"）；
    - 回滚只需要 ``table``（``DROP TABLE IF EXISTS`` 会连索引一起删）。
    """

    table: str
    ddl: str
    indexes: tuple[str, ...]
    columns: tuple[str, ...]
    constraints: tuple[str, ...]
    why: str


RUNS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS chapter_asset_profile_runs (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    project_id VARCHAR(64) NOT NULL,
    chapter_id VARCHAR(64) NOT NULL,
    cache_key VARCHAR(64) NOT NULL DEFAULT '',
    source_hash VARCHAR(64) NOT NULL DEFAULT '',
    source_summary TEXT NOT NULL DEFAULT '{}',
    status VARCHAR(32) NOT NULL DEFAULT 'generated',
    item_total INTEGER NOT NULL DEFAULT 0,
    llm_called BOOLEAN NOT NULL DEFAULT 0,
    dry_run BOOLEAN NOT NULL DEFAULT 0,
    extra_instructions VARCHAR(512) NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}',
    technical TEXT NOT NULL DEFAULT '{}',
    warnings TEXT NOT NULL DEFAULT '[]',
    generated_at DATETIME,
    stale_at DATETIME,
    stale_reason VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
)
""".strip()

RUNS_TABLE_INDEXES: tuple[str, ...] = (
    f"CREATE INDEX IF NOT EXISTS ix_{RUNS_TABLE}_project_id ON {RUNS_TABLE} (project_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{RUNS_TABLE}_chapter_id ON {RUNS_TABLE} (chapter_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{RUNS_TABLE}_cache_key ON {RUNS_TABLE} (cache_key)",
    f"CREATE INDEX IF NOT EXISTS ix_{RUNS_TABLE}_status ON {RUNS_TABLE} (status)",
    (
        f"CREATE INDEX IF NOT EXISTS ix_{RUNS_TABLE}_chapter_status "
        f"ON {RUNS_TABLE} (chapter_id, status)"
    ),
)

RUNS_TABLE_COLUMNS: tuple[str, ...] = (
    "id",
    "project_id",
    "chapter_id",
    "cache_key",
    "source_hash",
    "source_summary",
    "status",
    "item_total",
    "llm_called",
    "dry_run",
    "extra_instructions",
    "meta",
    "technical",
    "warnings",
    "generated_at",
    "stale_at",
    "stale_reason",
    "created_at",
    "updated_at",
)

PROFILES_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS chapter_asset_profiles (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    project_id VARCHAR(64) NOT NULL,
    chapter_id VARCHAR(64) NOT NULL,
    asset_type VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_key VARCHAR(255) NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    profile TEXT NOT NULL DEFAULT '{}',
    manual_overrides TEXT NOT NULL DEFAULT '{}',
    user_notes TEXT NOT NULL DEFAULT '[]',
    shot_refs TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '[]',
    merge_sources TEXT NOT NULL DEFAULT '[]',
    plot_identity TEXT NOT NULL DEFAULT '',
    temporary_notes TEXT NOT NULL DEFAULT '[]',
    asset_id VARCHAR(64),
    link_action VARCHAR(32) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'generated',
    source_hash VARCHAR(64) NOT NULL DEFAULT '',
    source_summary TEXT NOT NULL DEFAULT '{}',
    pending_profile TEXT NOT NULL DEFAULT '{}',
    pending_aliases TEXT NOT NULL DEFAULT '[]',
    pending_shot_refs TEXT NOT NULL DEFAULT '[]',
    pending_evidence TEXT NOT NULL DEFAULT '[]',
    pending_source_hash VARCHAR(64) NOT NULL DEFAULT '',
    pending_at DATETIME,
    generated_at DATETIME,
    confirmed_at DATETIME,
    manual_edited_at DATETIME,
    run_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_chapter_asset_profile_key UNIQUE (chapter_id, asset_type, name_key),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES chapter_asset_profile_runs (id) ON DELETE SET NULL
)
""".strip()

PROFILES_TABLE_INDEXES: tuple[str, ...] = (
    f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_project_id ON {PROFILES_TABLE} (project_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_chapter_id ON {PROFILES_TABLE} (chapter_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_asset_type ON {PROFILES_TABLE} (asset_type)",
    f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_asset_id ON {PROFILES_TABLE} (asset_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_status ON {PROFILES_TABLE} (status)",
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PROFILES_TABLE}_chapter_status "
        f"ON {PROFILES_TABLE} (chapter_id, status)"
    ),
)

PROFILES_TABLE_COLUMNS: tuple[str, ...] = (
    "id",
    "project_id",
    "chapter_id",
    "asset_type",
    "name",
    "name_key",
    "aliases",
    "profile",
    "manual_overrides",
    "user_notes",
    "shot_refs",
    "evidence",
    "merge_sources",
    "plot_identity",
    "temporary_notes",
    "asset_id",
    "link_action",
    "status",
    "source_hash",
    "source_summary",
    "pending_profile",
    "pending_aliases",
    "pending_shot_refs",
    "pending_evidence",
    "pending_source_hash",
    "pending_at",
    "generated_at",
    "confirmed_at",
    "manual_edited_at",
    "run_id",
    "created_at",
    "updated_at",
)

#: 建表顺序**有意义**：``chapter_asset_profile_runs`` 在前（``chapter_asset_profiles.run_id``
#: 有外键指向它）；删表时按相反顺序（先删有外键的 ``chapter_asset_profiles``）。
TABLE_NAMES: tuple[str, ...] = (RUNS_TABLE, PROFILES_TABLE)

#: 唯一约束的定义片段（已写进 ``PROFILES_TABLE_DDL`` 的表级子句；这里单独留一份，
#: 供文档、迁移后校验与测试引用 —— 它同时是"幂等搬运"的依据：``ON CONFLICT`` 认的就是它）。
#: ``chapter_asset_profile_runs`` 上没有唯一约束（一次分析可以有多行历史记录）。
PROFILES_TABLE_UNIQUE_CONSTRAINT = (
    "CONSTRAINT uq_chapter_asset_profile_key UNIQUE (chapter_id, asset_type, name_key)"
)

TABLES: tuple[NewTable, ...] = (
    NewTable(
        RUNS_TABLE,
        RUNS_TABLE_DDL,
        RUNS_TABLE_INDEXES,
        RUNS_TABLE_COLUMNS,
        (),
        "一次「整章分析」的生成记录（内容签名 + 来源摘要 + 运行元信息），"
        "用来判断库里这份清单是不是当前剧本那一版",
    ),
    NewTable(
        PROFILES_TABLE,
        PROFILES_TABLE_DDL,
        PROFILES_TABLE_INDEXES,
        PROFILES_TABLE_COLUMNS,
        ("uq_chapter_asset_profile_key",),
        "章节资产资料（一章一个资产一行，按项目 + 章节隔离）："
        "重启不丢、重新提取不丢、人工修改与用户补充不被模型结果覆盖",
    ),
)


def table_count() -> int:
    """清单里的表数（输出文案一律用它，不在别处写死数字）。"""
    return len(TABLES)


def table_names() -> tuple[str, ...]:
    """清单里的表名（建表顺序）—— 回滚与校验用。"""
    return TABLE_NAMES


def columns_of(table: str) -> tuple[str, ...]:
    """某张表期望的列名（按 ORM 声明顺序）；表不在清单里时抛 ``KeyError``。"""
    for item in TABLES:
        if item.table == table:
            return item.columns
    raise KeyError(f"清单里没有这张表：{table}")


def index_names(item: NewTable) -> tuple[str, ...]:
    """从 ``CREATE INDEX IF NOT EXISTS <名字> ON ...`` 里取出索引名（校验用）。"""
    names: list[str] = []
    for ddl in item.indexes:
        parts = ddl.replace("IF NOT EXISTS", " ").split()
        names.append(parts[2])
    return tuple(names)


def describe() -> str:
    """一行人类可读概览，例如 ``2 张表：chapter_asset_profile_runs（19 列） / ...``。"""
    parts = " / ".join(f"{item.table}（{len(item.columns)} 列）" for item in TABLES)
    return f"{table_count()} 张表：{parts}"


_DDL_CLAUSE_PREFIXES = (
    "PRIMARY KEY",
    "FOREIGN KEY",
    "UNIQUE",
    "CONSTRAINT",
    "CHECK",
    ")",
)


def _ddl_column_names(ddl: str) -> tuple[str, ...]:
    """从 ``CREATE TABLE`` DDL 里解析出列名（跳过主键/外键/唯一约束等表级子句）。"""
    names: list[str] = []
    for raw_line in ddl.splitlines()[1:]:
        line = raw_line.strip().rstrip(",")
        if not line or line.startswith(_DDL_CLAUSE_PREFIXES):
            continue
        names.append(line.split()[0])
    return tuple(names)


def _self_check() -> None:
    """模块自检：DDL 的列/表头必须与声明的列清单一致，表名顺序必须满足建表依赖。

    清单只有一份，所以这里宁可 import 时就报错，也不让"清单说的列"和"真实建出来的列"
    悄悄漂移（测试也会比对，但脚本单独跑时也要拦住）。
    """
    for item in TABLES:
        header = f"CREATE TABLE IF NOT EXISTS {item.table} ("
        if header not in item.ddl:
            raise AssertionError(f"{item.table} 的 DDL 表头与表名对不上：{item.ddl.splitlines()[0]}")
        parsed = _ddl_column_names(item.ddl)
        if parsed != item.columns:
            raise AssertionError(f"{item.table} 的 DDL 列与清单列不一致：DDL={parsed} 清单={item.columns}")
        if item.table == PROFILES_TABLE and PROFILES_TABLE_UNIQUE_CONSTRAINT not in item.ddl:
            raise AssertionError(f"{PROFILES_TABLE} 缺少唯一约束 {PROFILES_TABLE_UNIQUE_CONSTRAINT}")
    if table_names() != (RUNS_TABLE, PROFILES_TABLE):
        raise AssertionError("建表顺序必须是先 chapter_asset_profile_runs、后 chapter_asset_profiles")


_self_check()


__all__ = [
    "LEGACY_PAYLOAD_KEYS",
    "PROFILES_TABLE",
    "PROFILES_TABLE_COLUMNS",
    "PROFILES_TABLE_DDL",
    "PROFILES_TABLE_INDEXES",
    "PROFILES_TABLE_UNIQUE_CONSTRAINT",
    "RUNS_TABLE",
    "RUNS_TABLE_COLUMNS",
    "RUNS_TABLE_DDL",
    "RUNS_TABLE_INDEXES",
    "TABLE_NAMES",
    "TABLES",
    "NewTable",
    "columns_of",
    "describe",
    "index_names",
    "table_count",
    "table_names",
]
