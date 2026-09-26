"""SQLite 增量列清单（LLM 管线 + 项目起点）：迁移脚本与回滚脚本共用这一份，禁止各写一份。

为什么要有这个文件：迁移与回滚此前各维护一份列清单，已经漂移成
「迁移 11 列 / 回滚 10 列」——迁移漏了 ``video_prompt`` / ``video_prompt_source``，
回滚又漏了 ``audio_opt_out``，于是"迁移后能跑、回滚后回不到迁移前"。
清单只有一份，两个脚本都从它派生，就不会再出现两侧不对称。

当前清单共 13 列（数量由 :func:`column_count` 动态给出，不要在别处写死数字）：

1. 资产级图片提示词落库（5 列）：``characters`` / ``scenes`` / ``props`` /
   ``costumes`` / ``actors`` 各加 ``image_prompts``（JSON 文本，存
   ``{提示词类别: 提示词正文}``）。
2. 定版主图（4 列）：``actor_images`` / ``scene_images`` / ``prop_images`` /
   ``costume_images`` 各加 ``is_primary``。此前只有 ``character_images`` 有这一列。
3. 项目起点（1 列，``projects``）：``start_mode``（``script`` / ``prompts``）。
   「从视频提示词开始」的项目创建时需要它来决定是否自动补默认章节、以及工作台第一步
   显示「已跳过：提示词起步」；**旧行由 ``DEFAULT 'script'`` 自动回填**，行为与迁移前一致
   （老项目仍然按「从剧本开始」走）。
4. 镜头级正式产物（4 列，都在 ``shot_details``）：
   ``video_prompt`` / ``video_prompt_source``（视频提示词与来源，交付导出读的就是它）、
   ``audio_file_id`` / ``audio_opt_out``（声音绑定与「本镜无需声音」显式标记，
   两者互斥）。

列定义用 SQLite 方言：``ALTER TABLE ... ADD COLUMN`` 要求 NOT NULL 列必须带默认值，
所以 JSON / BOOLEAN 列统一给 ``DEFAULT '{}'`` / ``DEFAULT 0``。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class NewColumn:
    """一列新增字段。

    - ``ddl``：``ALTER TABLE {table} ADD COLUMN {column} {ddl}`` 的完整定义（迁移用）；
    - ``why``：为什么要这一列（迁移输出与文档引用，避免"加了个看不懂的列"）；
    - 回滚只需要 ``table`` / ``column``（``DROP COLUMN`` 不用类型）。
    """

    table: str
    column: str
    ddl: str
    why: str


COLUMNS: tuple[NewColumn, ...] = (
    NewColumn(
        "characters",
        "image_prompts",
        "TEXT NOT NULL DEFAULT '{}'",
        "角色级图片提示词（按槽位类别存 JSON）",
    ),
    NewColumn(
        "scenes",
        "image_prompts",
        "TEXT NOT NULL DEFAULT '{}'",
        "场景级图片提示词",
    ),
    NewColumn(
        "props",
        "image_prompts",
        "TEXT NOT NULL DEFAULT '{}'",
        "道具级图片提示词",
    ),
    NewColumn(
        "costumes",
        "image_prompts",
        "TEXT NOT NULL DEFAULT '{}'",
        "服装级图片提示词",
    ),
    NewColumn(
        "actors",
        "image_prompts",
        "TEXT NOT NULL DEFAULT '{}'",
        "演员级图片提示词",
    ),
    NewColumn(
        "actor_images",
        "is_primary",
        "BOOLEAN NOT NULL DEFAULT 0",
        "演员定版主图标记（同一资产至多一张）",
    ),
    NewColumn(
        "scene_images",
        "is_primary",
        "BOOLEAN NOT NULL DEFAULT 0",
        "场景定版主图标记",
    ),
    NewColumn(
        "prop_images",
        "is_primary",
        "BOOLEAN NOT NULL DEFAULT 0",
        "道具定版主图标记",
    ),
    NewColumn(
        "costume_images",
        "is_primary",
        "BOOLEAN NOT NULL DEFAULT 0",
        "服装定版主图标记",
    ),
    NewColumn(
        "shot_details",
        "video_prompt",
        "TEXT NOT NULL DEFAULT ''",
        "镜头视频提示词（文生视频用；交付导出的就是这一列）",
    ),
    NewColumn(
        "shot_details",
        "video_prompt_source",
        "VARCHAR(32) NOT NULL DEFAULT ''",
        "视频提示词来源标记（jurilu / external_import / llm / manual…）",
    ),
    NewColumn(
        "shot_details",
        "audio_file_id",
        "VARCHAR(64) DEFAULT NULL",
        "镜头级音频文件引用（files.type=audio）；无音频时保持 NULL",
    ),
    NewColumn(
        "projects",
        "start_mode",
        "VARCHAR(16) NOT NULL DEFAULT 'script'",
        "项目起点（script=从剧本开始 / prompts=从视频提示词开始）；旧行自动回填 script",
    ),
    NewColumn(
        "shot_details",
        "audio_opt_out",
        "BOOLEAN NOT NULL DEFAULT 0",
        "「本镜无需声音」的显式标记；与 audio_file_id 互斥，默认 0=未表态",
    ),
)


def column_count() -> int:
    """清单里的列数（输出文案一律用它，不在别处写死数字）。"""
    return len(COLUMNS)


def column_pairs() -> tuple[tuple[str, str], ...]:
    """``(表名, 列名)`` 列表 —— 回滚与校验用。"""
    return tuple((item.table, item.column) for item in COLUMNS)


def describe() -> str:
    """一行人类可读概览，例如 ``13 列：image_prompts×5 / is_primary×4 / shot_details×4``。"""
    grouped: dict[str, int] = {}
    for item in COLUMNS:
        # 镜头细节那 4 列名字各不相同，按表聚合更可读；其余两类按列名聚合。
        key = "shot_details" if item.table == "shot_details" else item.column
        grouped[key] = grouped.get(key, 0) + 1
    parts = " / ".join(f"{name}×{count}" for name, count in grouped.items())
    return f"{column_count()} 列：{parts}"


__all__ = ["COLUMNS", "NewColumn", "column_count", "column_pairs", "describe"]
