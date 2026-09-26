"""一键技能的**交付文本口径**（零第三方依赖）。

与出口 A（``prompt_delivery_text``）保持同一套排版习惯：
同样的分隔线、同样的 ``UTF-8 BOM`` 编码——因为这两份 TXT 都会被粘到
外部平台，一致性比"各写各的"更重要。

差异只在标题：出口 A 写「【巨日禄提示词】」（来源固定 jurilu），
本模块写「【导演Skill提示词】」并附上 Skill 名，方便你回看是哪套规则产出的。
"""

from __future__ import annotations

from typing import Any, Sequence

from app.services.prompt_text_format import (
    CHAPTER_RULE,
    SHOT_RULE,
    encode_txt_download,
)

SKILL_PROMPT_HEADER = "【导演Skill提示词】"


def build_skill_export_document(
    entries: Sequence[dict[str, Any]],
    *,
    skill_label: str = "",
    title: str = "",
) -> str:
    """生成「一键技能提示词」交付文本。

    ``entries`` 每项：``{"label": 显示名, "prompt": 正文, "note": 附注(可选)}``。
    空正文的条目会被跳过（与出口 A 的"没有正文不导出"一致）。
    """
    parts: list[str] = []
    head = str(title or "").strip() or str(skill_label or "").strip()
    if head:
        parts.extend([CHAPTER_RULE, head, CHAPTER_RULE, ""])

    exported = 0
    for item in entries:
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        label = str(item.get("label") or "").strip() or f"#{exported + 1}"
        parts.extend([SHOT_RULE, label, SHOT_RULE, ""])
        note = str(item.get("note") or "").strip()
        if note:
            parts.extend([note, ""])
        parts.extend([SKILL_PROMPT_HEADER, prompt, ""])
        exported += 1

    if not exported:
        return ""
    return "\n".join(parts).strip() + "\n"


def export_filename(skill_id: str, project_id: str = "") -> str:
    """下载文件名（项目 + Skill）。"""
    def safe(value: str) -> str:
        return "".join(ch for ch in str(value or "") if ch.isalnum() or ch in "-_") or "skill"

    return f"{safe(project_id)}-{safe(skill_id)}-skill-prompt.txt"


__all__ = [
    "SKILL_PROMPT_HEADER",
    "build_skill_export_document",
    "export_filename",
    "encode_txt_download",
]
