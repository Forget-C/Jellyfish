"""交付文本的公共排版原语（零第三方依赖）。

存在的理由：出口 A（``prompt_delivery_text``）与一键技能导出（``skills.quick_skill_text``）
是**两份会被粘到同一个外部平台**的 TXT，分隔线、空行位置、``UTF-8 BOM`` 必须完全一致。
把这几条原语抽到这里，是为了让"一致"由代码保证，而不是靠两处手工对齐。

同时也刻意放在 ``app/services/`` 顶层：``app/services/studio/__init__`` 会拉起
sqlalchemy，凡是想在受限沙箱里自检的纯文本模块，都不能穿过那个包。
"""

from __future__ import annotations

# 来源: app.py:build_jurilu_prompt_export_document:21293 的两条分隔线
SHOT_RULE = "===================="
CHAPTER_RULE = "################################"


def encode_txt_download(text: str) -> bytes:
    """UTF-8 BOM 编码 —— 来源: app.py:encode_txt_download:21288（桌面编辑器才认中文）。"""
    return ("\ufeff" + str(text or "")).encode("utf-8")


def safe_filename_part(value: str, *, fallback: str) -> str:
    """把任意字符串压成可安全用作文件名的片段。"""
    cleaned = "".join(ch for ch in str(value or "") if ch.isalnum() or ch in "-_")
    return cleaned or fallback


__all__ = ["SHOT_RULE", "CHAPTER_RULE", "encode_txt_download", "safe_filename_part"]
