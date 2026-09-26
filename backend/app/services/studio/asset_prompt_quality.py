"""资产图片提示词的**质量拦截**：后端必须拦，不能只靠前端。

线上真实症状
============

资产准备页生成的图片提示词里大量出现「外观信息不足，需人工补充」——
因为上游没给结构化资料，编排层就用这句空话兜底，并在提示词里**要求模型逐字使用**。
这句空话一旦被保存成"提示词已就绪"，就会：

1. 让准备状态判定为"已完成"（``project_asset_readiness.has_image_prompt``）；
2. 进入批量出图（``image_pipeline`` 断点①优先读已保存提示词）；
3. 花真钱生成一堆废图。

本模块把四类"不算提示词"的内容在**任何写库路径之前**拦下来，
返回**结构化中文错误**（可照做修）：

================  ==========================================  ========
错误码              判定                                        状态码
================  ==========================================  ========
``empty_prompt``   空文本 / 只有空白                           422
``vague_filler``   含「外观信息不足」「需人工补充」这类空话     422
``name_only_generic``  去掉资产名与通用摄影词后没有可辨识特征    422
``duplicate_prompt_text``  两个**不同**资产拿到逐字相同的内容    409
``near_duplicate_prompt_text``  两个不同资产高度重复（相似度≥阈值）409
================  ==========================================  ========

另外两条保护（不是"质量"而是"不许自动覆盖"）：

- :func:`ensure_image_prompts_not_silently_replaced`：已有的人工提示词默认不动，
  要覆盖必须显式传 ``confirm_replace_image_prompt=true``（否则结构化 409）；
- 已上传图片 / 定版图由既有的 ``primary_protection`` 负责（本模块不碰图片表，
  只在文档与错误码里指向它），保证"沿用既有定版保护"，不另开一套。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from fastapi import HTTPException

from app.services.studio.asset_profiles import (
    find_vague_markers,
    normalize_asset_type,
    profile_has_visual_content,
    type_label,
    visual_field_keys,
    field_label,
)

# ---------------------------------------------------------------------------
# 错误码
# ---------------------------------------------------------------------------

CODE_EMPTY_PROMPT = "empty_prompt"
CODE_VAGUE_FILLER = "vague_filler"
CODE_NAME_ONLY_GENERIC = "name_only_generic"
CODE_DUPLICATE_TEXT = "duplicate_prompt_text"
CODE_NEAR_DUPLICATE_TEXT = "near_duplicate_prompt_text"

#: 「必须人工处理」的跨资产冲突 → 409；本身就不合法的内容 → 422
CONFLICT_CODES: frozenset[str] = frozenset({CODE_DUPLICATE_TEXT, CODE_NEAR_DUPLICATE_TEXT})

#: 用户显式确认覆盖已有提示词的请求字段名（沿用 ``primary_protection.CONFIRM_FIELD`` 的口径）
IMAGE_PROMPT_CONFIRM_FIELD = "confirm_replace_image_prompt"

#: 去掉资产名与通用摄影词之后，至少还剩这么多字符才算"**不是**只有资产名 + 通用摄影词"。
#:
#: 阈值刻意压到 2（而不是 6 以上）：这条规则要拦的是**零特征**的内容
#: （"资产名 + 景别 + 背景 + 画质词"这类去掉通用词后一个字都不剩的文本），
#: 而不是给"描述得够不够细"打分。「雨夜咖啡店，木质吧台」这种很简短但确实写了
#: 具体特征（木质吧台）的提示词必须放行 —— 否则会误伤人工精心写过的提示词，
#: 也会让既有页面上已能保存的短提示词突然 422。
MIN_SPECIFIC_CHARS = 2

#: 判定"高度重复"的相似度阈值（两条 ≥16 字的文本）
NEAR_DUPLICATE_RATIO = 0.9
NEAR_DUPLICATE_MIN_CHARS = 16

# ---------------------------------------------------------------------------
# 「已保存提示词」的质量结论（三档，页面/批量出图**共用一份**判定）
# ---------------------------------------------------------------------------

#: 可用：这段已保存的提示词能直接出图。
VERDICT_OK = "ok"
#: 不可用但不是"旧数据要重判"：还没有保存过提示词（或本章还没有分析资料）。
VERDICT_BLOCKED = "blocked"
#: 旧数据里保存下来的、按现在的门禁**不允许出图**的内容（空话 / 只有名字+通用词 / 跨资产重复）。
VERDICT_NEEDS_REGENERATION = "needs_regeneration"

#: 质量结论的中文说明（用户看得懂，不含状态码、不含模型名）。
VERDICT_LABELS: dict[str, str] = {
    VERDICT_OK: "提示词可用",
    VERDICT_BLOCKED: "还不能出图",
    VERDICT_NEEDS_REGENERATION: "需要重新生成提示词",
}


#: 通用摄影/画质/构图词：这些词对**任何**资产都成立，因此不构成"该资产的特征"。
GENERIC_PROMPT_WORDS: tuple[str, ...] = (
    # 画幅/景别
    "特写", "大特写", "近景", "中景", "中近景", "全景", "远景", "广角", "establishing",
    "close-up", "close up", "medium shot", "wide shot", "full shot", "full body", "half body",
    "extreme close-up",
    # 机位/角度
    "平视", "俯拍", "仰拍", "俯视", "仰视", "过肩", "eye level", "high angle", "low angle",
    "over the shoulder", "bird eye",
    # 视角/展示
    "正面", "侧面", "背面", "斜侧", "全身", "半身", "front view", "side view", "back view",
    "three quarter", "reference sheet", "reference image", "参考图", "设定图", "资产图",
    "展示", "视角", "构图", "画面", "镜头", "机位",
    # 光线/画质/风格
    "柔和光", "柔和主光", "主光", "侧光", "顺光", "逆光", "顶光", "自然光", "打光",
    "高清", "超清", "高分辨率", "清晰", "锐利", "写实", "真实", "照片级", "电影感", "电影质感",
    "cinematic", "photorealistic", "photoreal", "sharp focus", "high resolution", "detailed",
    "detailed skin texture", "high consistency", "realistic", "live-action", "live action",
    "real human actor", "short drama style", "style",
    # 背景/底色
    "干净背景", "白色背景", "纯色背景", "浅灰色背景", "中性背景", "无背景", "留白",
    "clean white background", "clean neutral background", "clean background", "white background",
    "neutral background", "plain background", "isolated",
    # 负面/排除（提示词里常带一句"不要xx"）
    "不要文字", "不要水印", "无文字", "无水印", "no text", "no watermark", "no logo",
)

#: 需要一并剔除的标点与空白（中英文都覆盖）
_PUNCT_RE = re.compile(r"[\s,，。;；、:：/\\|·\-—_()（）\[\]【】\"'“”‘’!！?？~～<>=+*#@$%^&]+")


@dataclass(frozen=True, slots=True)
class PromptQualityIssue:
    """一条可照做修的质量问题（**结构化中文**，不含任何路径/密钥）。"""

    code: str
    message: str
    fix: str = ""
    asset_key: str = ""
    asset_name: str = ""
    asset_type: str = ""
    slot: str = ""
    matched: str = ""
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def status_code(self) -> int:
        return 409 if self.code in CONFLICT_CODES else 422

    def to_read(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "status_code": self.status_code,
        }
        for key, value in (
            ("fix", self.fix),
            ("asset_key", self.asset_key),
            ("asset_name", self.asset_name),
            ("asset_type", self.asset_type),
            ("field", self.slot),
            ("matched", self.matched),
        ):
            if value:
                payload[key] = value
        if self.detail:
            payload["detail"] = self.detail
        return payload


def normalize_for_compare(text: Any) -> str:
    """比较用归一化：小写 + 去掉全部标点与空白。"""
    return _PUNCT_RE.sub("", str(text or "").strip().lower())


def shared_boilerplate_phrases() -> tuple[str, ...]:
    """由后端**确定性逐字补齐**的共享版式 / 风格 / 画质 / 负面词。

    这些词来自 ``llm_orchestration.registry`` 的几张表，同一个槽位下
    **每个资产拿到的都完全一样**，因此它们携带**零资产身份信息**。

    为什么要单独列出来：角色设定图的版式词很长（左右分栏 + 三视图那一套），
    它们参与整段相似度计算时，会把"本来就该完全相同"的部分算成"重复"——
    后果是两个**真的被区分开**的角色也判成高度重复，卡在生图之前
    （需求清单第 4 条的卡点形态之一）。
    """
    from app.services.studio.llm_orchestration import registry  # 延迟导入，避免导入环

    phrases: list[str] = []
    for rules in registry.SLOT_STYLE_RULES.values():
        phrases.extend(rules)
    for extra in registry.SLOT_NEGATIVE_EXTRA.values():
        phrases.extend(extra)
    phrases.extend(registry.STYLE_WORDS_BY_ASSET_TYPE.values())
    phrases.append(registry.DEFAULT_STYLE_WORDS)
    phrases.append(registry.DEFAULT_QUALITY_WORDS)
    phrases.append(registry.DEFAULT_NEGATIVE_PROMPT)
    return tuple(dict.fromkeys(str(item).strip() for item in phrases if str(item).strip()))


def strip_shared_boilerplate(text: Any) -> str:
    """去掉共享版式 / 风格 / 画质 / 负面词，只留**资产特有内容**（查重比较用）。"""
    residue = normalize_for_compare(text)
    for phrase in sorted(shared_boilerplate_phrases(), key=len, reverse=True):
        key = normalize_for_compare(phrase)
        if key:
            residue = residue.replace(key, "")
    return residue


def strip_generic_words(text: Any, *, given_names: Iterable[str] = ()) -> str:
    """去掉资产名与通用摄影词，返回"剩下多少该资产特有的内容"。"""
    residue = normalize_for_compare(text)
    for name in given_names:
        key = normalize_for_compare(name)
        if key:
            residue = residue.replace(key, "")
    # 长词优先，避免"白色背景"被"背景"截断后留下"白色"
    for word in sorted(GENERIC_PROMPT_WORDS, key=len, reverse=True):
        key = normalize_for_compare(word)
        if key:
            residue = residue.replace(key, "")
    return residue


def check_single_prompt(
    text: Any,
    *,
    slot: str = "",
    asset_key: str = "",
    asset_name: str = "",
    asset_type: str = "",
    profile: Mapping[str, Any] | None = None,
) -> list[PromptQualityIssue]:
    """检查**一条**提示词；返回问题列表（空列表 = 通过）。"""
    issues: list[PromptQualityIssue] = []
    value = str(text or "").strip()
    label = slot or "提示词"

    if not value:
        issues.append(
            PromptQualityIssue(
                code=CODE_EMPTY_PROMPT,
                message=f"{asset_name or '该资产'}的{label}是空的，不能当作「提示词已就绪」保存，也不会进入批量出图。",
                fix="请重新生成，或手工填写一段包含该资产具体特征的提示词。",
                asset_key=asset_key,
                asset_name=asset_name,
                asset_type=asset_type,
                slot=slot,
            )
        )
        return issues

    markers = find_vague_markers(value)
    if markers:
        issues.append(
            PromptQualityIssue(
                code=CODE_VAGUE_FILLER,
                message=(
                    f"{asset_name or '该资产'}的{label}含空话「{markers[0]}」，"
                    "没有任何可出图的信息，不能保存为「提示词已就绪」，也不会进入批量出图。"
                ),
                fix=(
                    "这段空话来自上游资产资料缺失。请先补齐该资产的结构化资料"
                    "（角色：外貌/发型/服装配饰；场景：空间结构/陈设/光线色调；"
                    "道具：材质/颜色/形状/尺寸；服装：款式/颜色/材质/配饰），再重新生成。"
                ),
                asset_key=asset_key,
                asset_name=asset_name,
                asset_type=asset_type,
                slot=slot,
                matched=markers[0],
                detail={"matched_markers": markers},
            )
        )
        # 已经是空话，无需再叠加"特征不足"的重复结论
        return issues

    residue = strip_generic_words(value, given_names=[asset_name] if asset_name else [])
    if len(residue) < MIN_SPECIFIC_CHARS:
        missing_labels = [
            field_label(asset_type, key) for key in visual_field_keys(asset_type)
        ] or ["该资产的具体特征"]
        issues.append(
            PromptQualityIssue(
                code=CODE_NAME_ONLY_GENERIC,
                message=(
                    f"{asset_name or '该资产'}的{label}只有资产名和通用摄影词"
                    "（景别/机位/背景/画质一类），没有该资产的结构化特征，不能当作「提示词已就绪」。"
                ),
                fix=(
                    "请补上能直接落到画面上的特征，例如："
                    + "、".join(missing_labels[:6])
                    + "；也可先补齐资产结构化资料再重新生成。"
                ),
                asset_key=asset_key,
                asset_name=asset_name,
                asset_type=asset_type,
                slot=slot,
                detail={
                    "specific_residue_chars": len(residue),
                    "min_specific_chars": MIN_SPECIFIC_CHARS,
                    "note": "去掉资产名与景别/机位/背景/画质等通用摄影词后，这段文本没有剩下任何该资产特有的内容。",
                    "expected_visual_fields": list(missing_labels),
                },
            )
        )

    return issues


def check_prompt_map(
    prompts: Mapping[str, Any] | None,
    *,
    asset_key: str = "",
    asset_name: str = "",
    asset_type: str = "",
    profile: Mapping[str, Any] | None = None,
) -> list[PromptQualityIssue]:
    """检查一个资产的 ``{槽位: 提示词}`` 映射（空映射视为没问题，不报错）。"""
    issues: list[PromptQualityIssue] = []
    if not isinstance(prompts, Mapping):
        return issues
    for slot, text in prompts.items():
        issues.extend(
            check_single_prompt(
                text,
                slot=str(slot),
                asset_key=asset_key,
                asset_name=asset_name,
                asset_type=asset_type,
                profile=profile,
            )
        )
    return issues


def check_cross_asset_duplicates(
    items: Sequence[tuple[str, str, str]],
) -> list[PromptQualityIssue]:
    """跨资产查重：``items`` 是 ``(asset_key, asset_name, text)`` 列表。

    **不同资产**拿到逐字相同/高度重复的内容 → 一条 409 冲突（同资产多槽位不算）。
    只与"不同 asset_key"比较，避免把同一资产的正面/侧面（本来就该一致）误判成冲突。

    相似度比的是**剔掉共享版式词之后**的资产特有内容（见 :func:`strip_shared_boilerplate`）：
    版式 / 画质 / 负面词由后端逐字补齐，人人相同，拿它们算相似度只会制造假冲突。
    真正该拦的"内容没区分开"依然会拦（两个资产的资产特有内容一样时相似度仍是 100%）。
    长度门槛 ``NEAR_DUPLICATE_MIN_CHARS`` 仍然按**原文**判定，
    避免剔词之后文本变短、把本该查的资产整体跳过。
    """
    issues: list[PromptQualityIssue] = []
    normalized: list[tuple[str, str, str]] = []
    for asset_key, asset_name, text in items:
        if len(normalize_for_compare(text)) < NEAR_DUPLICATE_MIN_CHARS:
            continue
        normalized.append((str(asset_key), str(asset_name), strip_shared_boilerplate(text)))

    reported: set[tuple[str, str]] = set()
    for index, (left_key, left_name, left_text) in enumerate(normalized):
        for right_key, right_name, right_text in normalized[index + 1 :]:
            if left_key == right_key:
                continue
            pair = tuple(sorted((left_key, right_key)))
            if pair in reported:
                continue
            if left_text == right_text:
                code = CODE_DUPLICATE_TEXT
                message = (
                    f"「{left_name}」与「{right_name}」两个不同资产生成了**逐字相同**的提示词内容，"
                    "说明模型没有按资产特征区分，不能保存成提示词、更不能批量出图。"
                )
            else:
                ratio = SequenceMatcher(None, left_text, right_text).ratio()
                if ratio < NEAR_DUPLICATE_RATIO:
                    continue
                code = CODE_NEAR_DUPLICATE_TEXT
                message = (
                    f"「{left_name}」与「{right_name}」两个不同资产生成的提示词高度重复"
                    f"（相似度 {ratio:.0%}），说明模型没有按资产特征区分，"
                    "不能保存成提示词、更不能批量出图。"
                )
            reported.add(pair)
            issues.append(
                PromptQualityIssue(
                    code=code,
                    message=message,
                    fix=(
                        "请先补齐两个资产各自的结构化资料（外貌/材质/款式等硬特征），"
                        "再分别重新生成；确认内容确实不同后才允许保存。"
                    ),
                    asset_key=left_key,
                    asset_name=left_name,
                    detail={"other_asset_key": right_key, "other_asset_name": right_name},
                )
            )
    return issues


# ---------------------------------------------------------------------------
# 「旧数据里的已保存提示词」质量重判（只标记，不删改、不调模型）
# ---------------------------------------------------------------------------


#: 命中这些码的**已保存**提示词一律标「需要重新生成」并从批量出图里排除。
NEEDS_REGENERATION_CODES: frozenset[str] = frozenset(
    {
        CODE_EMPTY_PROMPT,
        CODE_VAGUE_FILLER,
        CODE_NAME_ONLY_GENERIC,
        CODE_DUPLICATE_TEXT,
        CODE_NEAR_DUPLICATE_TEXT,
    }
)


def saved_prompt_texts(prompts: Any) -> dict[str, str]:
    """``{槽位: 非空文本}``：只有键、值为空的槽位不算「已保存」。"""
    if not isinstance(prompts, Mapping):
        return {}
    return {
        str(slot): str(text).strip()
        for slot, text in prompts.items()
        if str(text or "").strip()
    }


def user_reason_for_issue(issue: PromptQualityIssue, *, other_name: str = "") -> str:
    """把一条质量问题翻译成**用户看得懂的中文原因**（不含状态码、不含模型名、不含路径）。

    ``other_name`` 只在跨资产重复时有意义：从"被看的那一方"的角度说"与谁重复"。
    """
    if issue.code == CODE_VAGUE_FILLER:
        return (
            f"这条提示词是旧规则下保存的：含「{issue.matched or '外观信息不足'}」这类空话，"
            "没有任何可出图的信息。"
        )
    if issue.code == CODE_NAME_ONLY_GENERIC:
        return "只有资产名 + 通用摄影词（景别/机位/背景/画质），没有该资产自己的特征。"
    if issue.code == CODE_EMPTY_PROMPT:
        return "这一格提示词是空的，不能当作「提示词已就绪」。"
    if issue.code == CODE_DUPLICATE_TEXT:
        return f"与「{other_name or issue.asset_name}」的提示词逐字相同，模型没有按资产特征区分。"
    if issue.code == CODE_NEAR_DUPLICATE_TEXT:
        return f"与「{other_name or issue.asset_name}」的提示词高度重复，两个不同资产共用了一段内容。"
    return issue.message


def audit_saved_prompts(entries: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """对**已经保存**的提示词逐资产做一次质量重判（**只判定，不写库、不调用模型**）。

    为什么要有它：新门禁上线**之前**保存的提示词里，有大量"外观信息不足，需人工补充"、
    "只有资产名 + 通用摄影词"、以及"两个不同人物共用同一段话"的内容。它们留在
    ``image_prompts`` 里，页面就会继续显示"可以生成图片"、批量出图也会照单全收。
    用户明确要求：这些必须标成「需要重新生成」并**排除出批量**，但不许自动删改。

    判定**完全复用**本模块既有的 :func:`check_prompt_map`（空 / 空话 / 只有名字+通用词）
    与 :func:`check_cross_asset_duplicates`（跨资产逐字相同 / 高度重复），不另写一套。

    ``entries`` 每项形如
    ``{"asset_key": "character:char-1", "asset_name": "苏晚棠", "asset_type": "character",
      "prompts": {"character_image_front": "…"}}``。

    返回 ``{asset_key: {"verdict", "reasons", "needs_regeneration", "codes", "issues",
    "saved_slots", "reason"}}``：

    - ``verdict``：``ok``（可用）/ ``needs_regeneration``（旧数据要重生成）/ ``blocked``（还没有提示词）；
    - ``reasons``：中文原因列表（页面直接展示）；
    - ``needs_regeneration``：**批量出图必须据此排除**。
    """
    audits: dict[str, dict[str, Any]] = {}
    names: dict[str, str] = {}
    flat: list[tuple[str, str, str]] = []

    for index, entry in enumerate(entries):
        asset_key = str(entry.get("asset_key") or f"asset-{index}")
        asset_name = str(entry.get("asset_name") or "")
        asset_type = str(entry.get("asset_type") or "")
        saved = saved_prompt_texts(entry.get("prompts"))
        names[asset_key] = asset_name or asset_key
        audit: dict[str, Any] = {
            "asset_key": asset_key,
            "asset_name": asset_name,
            "asset_type": asset_type,
            "verdict": VERDICT_OK,
            "reasons": [],
            "codes": [],
            "issues": [],
            "saved_slots": sorted(saved),
            "saved_total": len(saved),
            "needs_regeneration": False,
            "reason": "",
        }
        if not saved:
            audit["verdict"] = VERDICT_BLOCKED
            audit["reasons"].append("还没有保存这项资产的图片提示词，不能直接出图。")
            audits[asset_key] = audit
            continue
        for slot, text in saved.items():
            flat.append((asset_key, f"{asset_name or asset_key}（{slot}）", text))
        for issue in check_prompt_map(
            saved, asset_key=asset_key, asset_name=asset_name, asset_type=asset_type
        ):
            audit["issues"].append(issue.to_read())
            audit["codes"].append(issue.code)
            audit["reasons"].append(user_reason_for_issue(issue))
        audits[asset_key] = audit

    # 跨资产：两个**不同**资产拿到逐字相同 / 高度重复的内容 → 双方都要重新生成
    for issue in check_cross_asset_duplicates(flat):
        other_key = str((issue.detail or {}).get("other_asset_key") or "")
        for viewer_key in (issue.asset_key, other_key):
            audit = audits.get(viewer_key)
            if audit is None or issue.code in audit["codes"]:
                continue
            other_name = (
                str((issue.detail or {}).get("other_asset_name") or "")
                if viewer_key == issue.asset_key
                else issue.asset_name
            )
            audit["issues"].append(issue.to_read())
            audit["codes"].append(issue.code)
            audit["reasons"].append(user_reason_for_issue(issue, other_name=other_name))

    for audit in audits.values():
        audit["needs_regeneration"] = bool(set(audit["codes"]) & NEEDS_REGENERATION_CODES)
        if audit["needs_regeneration"]:
            audit["verdict"] = VERDICT_NEEDS_REGENERATION
        audit["reason"] = "；".join(audit["reasons"])
    return audits


def raise_for_quality(issues: Sequence[PromptQualityIssue]) -> None:
    """有质量问题就抛结构化 HTTP 错误（409 = 跨资产冲突，422 = 内容不合法）。"""
    if not issues:
        return
    conflict = next((item for item in issues if item.code in CONFLICT_CODES), None)
    primary = conflict or issues[0]
    detail: dict[str, Any] = {
        "code": primary.code,
        "message": primary.message,
        "fix": primary.fix,
        "issues": [item.to_read() for item in issues],
    }
    if primary.slot:
        detail["field"] = primary.slot
    if primary.asset_name:
        detail["asset_name"] = primary.asset_name
    raise HTTPException(status_code=primary.status_code, detail=detail)


def validate_asset_image_prompts(
    prompts: Mapping[str, Any] | None,
    *,
    asset_key: str = "",
    asset_name: str = "",
    asset_type: str = "",
    profile: Mapping[str, Any] | None = None,
) -> None:
    """单资产写入前的统一入口（**所有**写 ``image_prompts`` 的路径都该调它）。"""
    if not isinstance(prompts, Mapping) or not prompts:
        return
    raise_for_quality(
        check_prompt_map(
            prompts,
            asset_key=asset_key,
            asset_name=asset_name,
            asset_type=asset_type,
            profile=profile,
        )
    )


def describe_structured_gap(asset_type: str, profile: Mapping[str, Any] | None) -> str:
    """给错误/文案用：该资产"缺结构化资料"的一句话说明。"""
    asset_type_norm = normalize_asset_type(asset_type) or asset_type
    if profile and profile_has_visual_content(asset_type_norm, dict(profile)):
        return ""
    labels = "、".join(field_label(asset_type_norm, key) for key in visual_field_keys(asset_type_norm))
    return f"{type_label(asset_type_norm)}缺少可用于出图的结构化资料（{labels}）。"


# ---------------------------------------------------------------------------
# 「不许自动覆盖」保护
# ---------------------------------------------------------------------------


def _clip(text: Any, limit: int = 60) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else value[:limit] + "…"


def image_prompt_replace_conflicts(
    existing: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
) -> list[dict[str, str]]:
    """列出"会被顶掉"的已有提示词槽位。

    只算三种同时成立的情况：**本次确实提交了这个槽位** + 该槽位已有非空内容 +
    内容与已有值不同。刻意不看"本次没提交的槽位"——批量保存是**合并写入**
    （只动提交过的槽位），没提交的槽位本来就是"保持不动"，不该被当成覆盖。
    """
    conflicts: list[dict[str, str]] = []
    if not isinstance(existing, Mapping) or not isinstance(incoming, Mapping):
        return conflicts
    for slot, new_text in incoming.items():
        if slot not in existing:
            continue
        old_value = str(existing.get(slot) or "").strip()
        new_value = str(new_text or "").strip()
        if not old_value or new_value == old_value:
            continue
        conflicts.append(
            {
                "field": str(slot),
                "existing_excerpt": _clip(old_value),
                "incoming_excerpt": _clip(new_value),
            }
        )
    return conflicts


def confirm_image_prompt_replace_requested(body: Mapping[str, Any] | None) -> bool:
    """从**原始请求体**读「确认覆盖已有提示词」开关（兼容字符串写法）。"""
    if not isinstance(body, Mapping):
        return False
    value = body.get(IMAGE_PROMPT_CONFIRM_FIELD)
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def ensure_image_prompts_not_silently_replaced(
    existing: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
    *,
    raw_body: Mapping[str, Any] | None = None,
    asset_name: str = "",
) -> None:
    """已有提示词默认不动：要覆盖必须显式确认，否则抛结构化 409。

    与 ``primary_protection.ensure_primary_not_silently_replaced``（定版图）同一套口径：
    默认不覆盖、显式确认才覆盖、错误里给"即将被替换的是哪几个槽位"的只读摘要。
    """
    conflicts = image_prompt_replace_conflicts(existing, incoming)
    if not conflicts:
        return
    if confirm_image_prompt_replace_requested(raw_body):
        return
    slots = "、".join(item["field"] for item in conflicts)
    raise HTTPException(
        status_code=409,
        detail={
            "code": "image_prompt_replace_required",
            "message": (
                f"{asset_name or '该资产'}已有 {len(conflicts)} 个提示词槽位（{slots}）保存过内容，"
                "本次写入会把它们替换掉；已有提示词默认不动，需要你**显式确认**才会覆盖。"
            ),
            "fix": (
                "如果确实要用新内容覆盖，请**显式确认**：在同一请求里带上 "
                f'"{IMAGE_PROMPT_CONFIRM_FIELD}": true 再提交；'
                "否则请只提交需要新增/修改的槽位（没提交的槽位本来就不会被改动）。"
            ),
            "confirm_field": IMAGE_PROMPT_CONFIRM_FIELD,
            "conflicts": conflicts,
        },
    )


__all__ = [
    "CODE_DUPLICATE_TEXT",
    "CODE_EMPTY_PROMPT",
    "CODE_NAME_ONLY_GENERIC",
    "CODE_NEAR_DUPLICATE_TEXT",
    "CODE_VAGUE_FILLER",
    "CONFLICT_CODES",
    "GENERIC_PROMPT_WORDS",
    "IMAGE_PROMPT_CONFIRM_FIELD",
    "MIN_SPECIFIC_CHARS",
    "NEAR_DUPLICATE_RATIO",
    "NEEDS_REGENERATION_CODES",
    "PromptQualityIssue",
    "VERDICT_BLOCKED",
    "VERDICT_LABELS",
    "VERDICT_NEEDS_REGENERATION",
    "VERDICT_OK",
    "audit_saved_prompts",
    "check_cross_asset_duplicates",
    "check_prompt_map",
    "check_single_prompt",
    "confirm_image_prompt_replace_requested",
    "describe_structured_gap",
    "ensure_image_prompts_not_silently_replaced",
    "image_prompt_replace_conflicts",
    "normalize_for_compare",
    "raise_for_quality",
    "saved_prompt_texts",
    "strip_generic_words",
    "user_reason_for_issue",
    "validate_asset_image_prompts",
]
