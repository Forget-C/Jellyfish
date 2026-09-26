"""SQLite 增量**建表**清单（集级提示词看板的草稿表）：迁移与回滚脚本共用这一份。

为什么要有这个文件：
``migrate_llm_pipeline_columns.py`` / ``rollback_llm_pipeline_columns.py`` 的教训是
"迁移与回滚各维护一份清单 → 必然漂移"。建表同理：表名、列定义、索引只有一份，
迁移脚本按它建表、回滚脚本按它删表、测试按它校验与 ORM 模型一致。

清单内容（数量由 :func:`table_count` 动态给出，不要在别处写死）：

1. ``shot_video_prompt_drafts``（1 张表）：集级「视频提示词看板」的**服务端草稿**，
   每镜一行（主键 = ``shot_id``，与 ``shot_details`` 一样与 ``shots`` 共享主键）。
   修的是「整集视频提示词草稿丢失」：草稿此前只在浏览器内存里，刷新/中断就丢，
   已经付过费的真实生成结果无法恢复。

   **本表只放草稿**，绝不写 ``shot_details.video_prompt``（写正式列只有
   ``POST /api/v1/studio/prompt-board/{chapter_id}/save`` 一条路，成功后清掉对应草稿）。

为什么是 Python 而不是 ``sql/*.sql``：``sql/`` 下的文件是 MySQL 方言
（``information_schema`` / ``TINYINT``），运行时用的却是 SQLite。这里给的是
**真能跑**的 SQLite 建表器：幂等（``IF NOT EXISTS``）、带备份、可回滚。

列定义与 ``app/models/studio_shots.py`` 里的 ``ShotVideoPromptDraft`` 必须一致，
测试 ``test_prompt_board_draft_migration.py`` 会逐列比对（模型加列而这里没跟 → 红）。
"""

from __future__ import annotations

from dataclasses import dataclass

#: 草稿表名（脚本、测试、文档都从这里取）
DRAFT_TABLE = "shot_video_prompt_drafts"


@dataclass(frozen=True, slots=True)
class NewTable:
    """一张新增表。

    - ``ddl``：``CREATE TABLE IF NOT EXISTS ...`` 的完整定义（迁移用）；
    - ``indexes``：建表后按顺序执行的 ``CREATE INDEX IF NOT EXISTS ...``；
    - ``why``：为什么要这张表（迁移输出与文档引用，避免"加了张看不懂的表"）；
    - 回滚只需要 ``table``（``DROP TABLE IF EXISTS`` 会连索引一起删）。
    """

    table: str
    ddl: str
    indexes: tuple[str, ...]
    why: str


DRAFT_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS {DRAFT_TABLE} (
    shot_id VARCHAR(64) NOT NULL,
    chapter_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'failed',
    prompt TEXT NOT NULL DEFAULT '',
    source VARCHAR(32) NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    model VARCHAR(128) NOT NULL DEFAULT '',
    meta JSON NOT NULL DEFAULT '{{}}',
    server_generated BOOLEAN NOT NULL DEFAULT 0,
    claim_token VARCHAR(64),
    claim_expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shot_id),
    FOREIGN KEY (shot_id) REFERENCES shots (id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
)
""".strip()

DRAFT_TABLE_INDEXES: tuple[str, ...] = (
    f"CREATE INDEX IF NOT EXISTS ix_{DRAFT_TABLE}_chapter_id ON {DRAFT_TABLE} (chapter_id)",
    f"CREATE INDEX IF NOT EXISTS ix_{DRAFT_TABLE}_status ON {DRAFT_TABLE} (status)",
    f"CREATE INDEX IF NOT EXISTS ix_{DRAFT_TABLE}_chapter_shot ON {DRAFT_TABLE} (chapter_id, shot_id)",
)

TABLES: tuple[NewTable, ...] = (
    NewTable(
        DRAFT_TABLE,
        DRAFT_TABLE_DDL,
        DRAFT_TABLE_INDEXES,
        "集级提示词看板的服务端草稿（每镜一行；刷新/中断不丢，绝不写正式提示词列）",
    ),
)


def table_count() -> int:
    """清单里的表数（输出文案一律用它，不在别处写死数字）。"""
    return len(TABLES)


def table_names() -> tuple[str, ...]:
    """清单里的表名 —— 回滚与校验用。"""
    return tuple(item.table for item in TABLES)


def describe() -> str:
    """一行人类可读概览，例如 ``1 张表：shot_video_prompt_drafts``。"""
    return f"{table_count()} 张表：" + " / ".join(table_names())


__all__ = [
    "DRAFT_TABLE",
    "DRAFT_TABLE_DDL",
    "DRAFT_TABLE_INDEXES",
    "NewTable",
    "TABLES",
    "describe",
    "table_count",
    "table_names",
]
