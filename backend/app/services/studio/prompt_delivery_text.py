"""出口 A 的**纯文本口径**（零第三方依赖）。

本模块刻意只 import 标准库：因为它承载的是「交付文本长什么样」这一层契约，
必须能在**不加载 sqlalchemy / fastapi** 的环境里被独立自检
（沙箱内 import 这两个库会被信号杀掉）。取数与编排见 ``prompt_delivery.py``。

来源标注（逐条对齐中控台，不自行发明）：
  - 导出文档格式 —— 来源: app.py:build_jurilu_prompt_export_document:21293
        （等价移植件 web/api/services/task_delivery_service.py:498）
  - 排序键（集 → 段 → 镜号） —— 来源: app.py:doubao_shot_sort_key:20886
  - 镜头编号规则 ``S%03d``（按集内顺序） —— 来源: app.py:build_task_delivery_items:21136 行 21145-21172
  - 三档范围「当前镜头 / 当前集 / 多集」 —— 来源: app.py:task_delivery_page:21322 行 21362-21383
  - UTF-8 BOM（桌面编辑器才认中文） —— 来源: app.py:encode_txt_download:21288

与中控台的口径差异（重要，别当成 bug）：
  1. **数据源不同**。中控台读 ``prompts`` 表（一镜头一条，已核验 shot_id 唯一 126/126）；
     Jellyfish 侧读 ``shot_details.video_prompt`` / ``video_prompt_source``——迁移时已按原
     ``source`` 忠实回填 126 条，两边逐条一致。Jellyfish 没有 ``imported_size`` /
     ``imported_resolution`` / ``recommended_duration`` 的等价列，因此
     「完整任务（含资产）」模式在 Jellyfish 侧不提供，本模块只做「仅提示词」出口。
  2. **层级差异**。中控台是 剧本 → 集 → 段 → 镜头 四层；Jellyfish 是 项目 → 章节 → 镜头
     三层，无「段」。因此排序键等价为（章节序号, 章节id, 0, 镜头序号, 镜头id）。
  3. **章节标签**。中控台直接用 ``episode_id``；Jellyfish 的章节 id 迁移后带剧本前缀
     （如 ``script_fffb14fa33::EP01``），直接输出对用户不可读，故取 ``::`` 之后的部分，
     取不到时回落章节标题。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Sequence

from app.services.prompt_text_format import (
    CHAPTER_RULE,
    SHOT_RULE,
    encode_txt_download,
    safe_filename_part,
)

# ---------------------------------------------------------------------------
# 常量（逐字对齐中控台）
# ---------------------------------------------------------------------------

# 来源: app.py:build_jurilu_prompt_export_document:21293 —— 只认这一个来源值
JURILU_PROMPT_SOURCE = "jurilu"
JURILU_PROMPT_HEADER = "【巨日禄提示词】"
# SHOT_RULE / CHAPTER_RULE 见 app/services/prompt_text_format.py（与一键技能导出共用）

# 三档范围 —— 来源: app.py:task_delivery_page:21322 行 21362-21367
SCOPE_CURRENT_SHOT = "current_shot"
SCOPE_EPISODE = "episode"
SCOPE_EPISODES = "episodes"
SCOPE_LABELS = {
    SCOPE_CURRENT_SHOT: "当前镜头",
    SCOPE_EPISODE: "当前集",
    SCOPE_EPISODES: "多集",
}

EXPORT_SOURCE = JURILU_PROMPT_SOURCE

# 可进入出口 A 的来源白名单。
# 默认口径（本次放宽后）：
#   jurilu —— 巨日禄导入
#   skill  —— 一键技能（导演 Skill）生成后「写入镜头」
#   llm    —— LLM 编排层生成后由用户确认保存
#   internal —— 人工在分镜工作室里手写/微调并保存
# 保留 JURILU_PROMPT_SOURCE 单独值，便于需要与中控台逐字对齐时把口径收窄回 jurilu。
LLM_PROMPT_SOURCE = "llm"
SKILL_PROMPT_SOURCE = "skill"
#: 其它外部平台的批量导入（与巨日禄区分）；必须进交付白名单，否则导入的提示词会被静默丢掉
EXTERNAL_IMPORT_PROMPT_SOURCE = "external_import"
INTERNAL_PROMPT_SOURCE = "internal"
MANUAL_PROMPT_SOURCE = "manual"
# 历史/其他入口已经存在的来源值（实测库里有 shot_description 18 条、manual_workspace 2 条）。
# 不认它们会静默丢掉这些已保存的提示词。
LEGACY_EXPORTABLE_SOURCES: tuple[str, ...] = ("manual_workspace", "shot_description")

# 注意：本模块刻意只依赖标准库，所以这里保留一份白名单副本。
# 权威定义在 app/services/studio/product_guardrails.py（写入口那一侧），
# 两边由 tests/test_product_guardrails.py 的同步测试兜住，防止漂移。
EXPORT_SOURCES: tuple[str, ...] = (
    JURILU_PROMPT_SOURCE,
    SKILL_PROMPT_SOURCE,
    LLM_PROMPT_SOURCE,
    EXTERNAL_IMPORT_PROMPT_SOURCE,
    INTERNAL_PROMPT_SOURCE,
    MANUAL_PROMPT_SOURCE,
    *LEGACY_EXPORTABLE_SOURCES,
)
BINDING_HEADER = "【绑定资产】"
# 用户要求"关联资产名称不算完成，必须明确实际使用的文件"，
# 所以除名称外单独渲染一段实际文件（file_id / 地址）。
BINDING_FILE_HEADER = "【绑定素材·实际文件】"


# ---------------------------------------------------------------------------
# 纯函数
# ---------------------------------------------------------------------------


def chapter_label(chapter_id: str, chapter_title: str = "") -> str:
    """章节在导出文本里的显示标签。

    中控台原口径直接输出 ``episode_id``；Jellyfish 迁移后的章节 id 形如
    ``script_fffb14fa33::EP01``，直接输出对用户不可读，故取 ``::`` 之后的部分。
    """
    raw = str(chapter_id or "").strip()
    if "::" in raw:
        tail = raw.rsplit("::", 1)[-1].strip()
        if tail:
            return tail
    title = str(chapter_title or "").strip()
    return title or raw


def shot_code(shot_index: Any) -> str:
    """镜头编号 ``S%03d``（集内顺序）—— 来源: app.py:build_task_delivery_items:21136。"""
    try:
        value = int(shot_index)
    except (TypeError, ValueError):
        value = 0
    return f"S{value:03d}"


def shot_sort_key(row: dict[str, Any]) -> tuple:
    """排序键（集 → 段 → 镜号）。

    来源: app.py:doubao_shot_sort_key:20886。
    等价性说明：Jellyfish 无「段」层级，段号恒为 0，因此同章节内按「镜头序号」排序。
    """
    try:
        chapter_no = int(row.get("chapter_index"))
    except (TypeError, ValueError):
        chapter_no = 9999
    try:
        shot_no = int(row.get("shot_index"))
    except (TypeError, ValueError):
        shot_no = 999999
    return (
        chapter_no,
        str(row.get("chapter_id") or ""),
        0,
        shot_no,
        str(row.get("shot_id") or ""),
    )


def has_exportable_prompt(
    row: dict[str, Any], *, sources: Sequence[str] | None = None
) -> bool:
    """该行是否可以进入「仅提示词」出口。

    来源必须在 ``sources``（默认 ``EXPORT_SOURCES``）内 **且** 有正文。
    取 ``sources=("jurilu",)`` 时与中控台逐字对齐（app.py:task_delivery_item_issues:21185
    的 prompt_only 分支）。
    """
    prompt = str(row.get("video_prompt") or "").strip()
    source = str(row.get("video_prompt_source") or "").strip()
    allowed = tuple(sources) if sources else EXPORT_SOURCES
    return source in allowed and bool(prompt)


def has_jurilu_prompt(row: dict[str, Any]) -> bool:
    """兼容入口：只认 ``jurilu`` 来源（与中控台逐字一致）。"""
    return has_exportable_prompt(row, sources=(EXPORT_SOURCE,))


def build_jurilu_prompt_export_document(
    rows: Sequence[dict[str, Any]],
    *,
    multi_episode: bool = False,
    sources: Sequence[str] | None = None,
    include_bindings: bool = False,
) -> str:
    """生成「仅提示词」交付文本。

    来源: app.py:build_jurilu_prompt_export_document:21293（逐字对齐，含分隔线与空行位置）。
    取 ``sources=("jurilu",)`` 且 ``include_bindings=False`` 时与中控台**逐字一致**；
    ``sources=None`` 时按 ``EXPORT_SOURCES`` 放宽（含 skill / llm / internal）；
    ``include_bindings=True`` 时在每条提示词后追加绑定资产清单。
    """
    parts: list[str] = []
    current_chapter = ""
    for row in sorted(rows, key=shot_sort_key):
        if not has_exportable_prompt(row, sources=sources):
            continue
        label = chapter_label(str(row.get("chapter_id") or ""), str(row.get("chapter_title") or ""))
        code = shot_code(row.get("shot_index"))
        if multi_episode and label != current_chapter:
            current_chapter = label
            parts.extend([CHAPTER_RULE, label, CHAPTER_RULE, ""])
        parts.extend(
            [
                SHOT_RULE,
                f"{label} / {code}",
                SHOT_RULE,
                "",
                JURILU_PROMPT_HEADER,
                str(row.get("video_prompt") or "").strip(),
                "",
            ]
        )
        if include_bindings:
            binding_lines = render_binding_lines(row)
            if binding_lines:
                parts.extend([BINDING_HEADER, *binding_lines, ""])
            # 实际文件段：明确到 file_id / 地址，而不只是资产名
            file_lines = row.get("bound_file_lines")
            if isinstance(file_lines, (list, tuple)) and file_lines:
                parts.extend([BINDING_FILE_HEADER, *(str(x) for x in file_lines), ""])
    return ("\n".join(parts).strip() + "\n") if parts else ""


def render_binding_lines(row: dict[str, Any]) -> list[str]:
    """把一行镜头里已绑定的资产渲染成交付文本行（无绑定时返回空列表）。"""
    bound = row.get("bound_assets")
    if not isinstance(bound, dict) or not bound:
        return []
    labels = (
        ("characters", "角色"),
        ("scene", "场景"),
        ("props", "道具"),
        ("costumes", "服装"),
    )
    lines: list[str] = []
    for key, label in labels:
        names = bound.get(key) or []
        if isinstance(names, (list, tuple)) and names:
            lines.append(f"{label}：" + "、".join(str(x) for x in names))
    return lines


def export_filename(project_id: str, scope: str) -> str:
    """下载文件名（项目 + 范围）。"""
    safe = safe_filename_part(project_id, fallback="project")
    return f"{safe}-{scope}-jurilu-prompt.txt"


__all__ = [
    "JURILU_PROMPT_SOURCE",
    "JURILU_PROMPT_HEADER",
    "SHOT_RULE",
    "CHAPTER_RULE",
    "SCOPE_CURRENT_SHOT",
    "SCOPE_EPISODE",
    "SCOPE_EPISODES",
    "SCOPE_LABELS",
    "EXPORT_SOURCE",
    "chapter_label",
    "shot_code",
    "shot_sort_key",
    "has_jurilu_prompt",
    "has_exportable_prompt",
    "render_binding_lines",
    "EXPORT_SOURCES",
    "LLM_PROMPT_SOURCE",
    "SKILL_PROMPT_SOURCE",
    "INTERNAL_PROMPT_SOURCE",
    "BINDING_HEADER",
    "BINDING_FILE_HEADER",
    "build_jurilu_prompt_export_document",
    "encode_txt_download",
    "export_filename",
]
