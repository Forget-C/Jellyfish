"""4.1 实体提取编排服务。

统一内部模式：组装上下文 → 构建提示词 → 调 LLM（经守卫）→ 解析 JSON + 确定性后校验 → 返回预览。

边界（硬约束）：
- 只返回草稿预览，**不自动建实体**、不写任何表；
- 人工确认后建实体走现有 ``/api/v1/studio/entities``，不在本服务范围内。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.studio.llm_orchestration import (
    DroppedEntityRead,
    EntityDraftItemRead,
    EntityExtractionPreviewRead,
    EntityExtractionPreviewRequest,
)
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import (
    LLMRequestError,
    TextLLMCaller,
    TextLLMTarget,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.context import load_chapter_source
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_float,
    coerce_str,
    coerce_str_list,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import ENTITY_EXTRACTION_TEMPLATE
from app.services.studio.llm_orchestration.registry import (
    ENTITY_TYPE_REJECT_HINTS,
    ENTITY_TYPE_WHITELIST,
    normalize_entity_type,
)
from app.services.studio.llm_orchestration.support import (
    build_run_meta,
    dry_run_warning,
    raise_llm_failure,
    raise_parse_failure,
)

DEFAULT_CONFIDENCE = 0.5

# DRY_RUN 占位用的确定性类型猜测词表（**仅用于占位预览**，不参与真实结果的后校验）。
_SCENE_HINTS = ("厅", "院", "街", "巷", "房", "室", "楼", "店", "场", "园", "门", "桥", "路")
_PROP_HINTS = ("刀", "剑", "盒", "信", "机", "戒", "杖", "钥", "包", "杯", "册", "牌", "链", "书")


# ---------------------------------------------------------------------------
# 提示词
# ---------------------------------------------------------------------------


def build_entity_extraction_prompt(
    *,
    chapter_id: str,
    chapter_text: str,
    candidate_names: list[str],
    max_items: int,
    extra_instructions: str = "",
) -> str:
    """构建实体提取提示词。"""
    candidates = [str(x).strip() for x in candidate_names if str(x).strip()]
    if candidates:
        candidate_block = "只允许返回以下候选实体名（不在名单内的一律不要返回）：\n" + "、".join(candidates)
    else:
        candidate_block = "本次没有预置候选名单，请完全依据原文提取。"
    return ENTITY_EXTRACTION_TEMPLATE.safe_substitute(
        chapter_id=chapter_id or "未指定",
        chapter_text=chapter_text,
        candidate_names=candidate_block,
        max_items=max_items,
        extra_instructions=str(extra_instructions or "").strip() or "无。",
    )


# ---------------------------------------------------------------------------
# 确定性后校验
# ---------------------------------------------------------------------------


def extract_raw_entity_items(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """从模型 JSON 里取出实体数组，兼容几种常见的顶层写法。"""
    for key in ("entities", "items", "entity_list", "results"):
        value = parsed.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    if isinstance(parsed.get("name"), str):
        # 模型只返回了单个实体对象的情况。
        return [parsed]
    for value in parsed.values():
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            return list(value)
    raise JSONParseError("模型返回的 JSON 里找不到实体数组（entities）。")


def _grounded_in_source(name: str, source_haystack: str) -> bool:
    normalized = normalize_name(name)
    return bool(normalized) and normalized in source_haystack


def _passes_candidate_whitelist(name: str, aliases: list[str], whitelist: set[str]) -> bool:
    if not whitelist:
        return True
    for value in (name, *aliases):
        normalized = normalize_name(value)
        if normalized and normalized in whitelist:
            return True
    return False


def _clean_aliases(
    *,
    raw_name: str,
    aliases: list[str],
    whitelist: set[str],
    haystack: str,
) -> tuple[list[str], list[str]]:
    """别名归一：去重、剔除与本体同名项、剔除未在原文/候选名单中出现的疑似幻觉别名。"""
    key = normalize_name(raw_name)
    kept: list[str] = []
    kept_keys: set[str] = set()
    rejected: list[str] = []
    for alias in aliases:
        alias_key = normalize_name(alias)
        if not alias_key or alias_key == key or alias_key in kept_keys:
            continue
        if whitelist and alias_key not in whitelist:
            rejected.append(str(alias).strip())
            continue
        if haystack and alias_key not in haystack:
            rejected.append(str(alias).strip())
            continue
        kept_keys.add(alias_key)
        kept.append(str(alias).strip())
    return kept, rejected


def _coerce_confidence(raw: dict[str, Any], name: str, warnings: list[str]) -> float:
    confidence = coerce_float(raw.get("confidence"))
    if confidence is None:
        warnings.append(f"实体「{name}」缺少可解析的 confidence，已按默认 {DEFAULT_CONFIDENCE} 处理。")
        return DEFAULT_CONFIDENCE
    if confidence < 0 or confidence > 1:
        clamped = min(1.0, max(0.0, confidence))
        warnings.append(f"实体「{name}」的 confidence={confidence} 越界，已钳制为 {clamped}。")
        return clamped
    return float(confidence)


def postprocess_entities(
    raw_items: list[dict[str, Any]],
    *,
    source_text: str,
    candidate_names: list[str] | None = None,
    max_items: int = 40,
) -> tuple[list[EntityDraftItemRead], list[DroppedEntityRead], list[str]]:
    """确定性后校验：类型白名单 + 别名归一 + 去重合并 + 幻觉拦截 + 置信度钳制。

    返回 ``(items, dropped, warnings)``。纯函数，便于单测直接覆盖。
    """
    warnings: list[str] = []
    dropped: list[DroppedEntityRead] = []
    haystack = normalize_name(source_text)
    whitelist = {normalize_name(x) for x in (candidate_names or []) if normalize_name(x)}

    items_by_key: dict[str, EntityDraftItemRead] = {}
    alias_index: dict[str, str] = {}
    raw_names_by_key: dict[str, list[str]] = {}
    order: list[str] = []

    for index, raw in enumerate(raw_items, start=1):
        raw_name = coerce_str(raw.get("name") or raw.get("entity_name") or raw.get("title"))
        raw_type = coerce_str(raw.get("entity_type") or raw.get("type"))
        if not raw_name:
            dropped.append(DroppedEntityRead(reason=f"第 {index} 条缺少 name 字段", raw=raw))
            warnings.append(f"第 {index} 条实体缺少 name，已丢弃。")
            continue

        normalized_type = normalize_entity_type(raw_type)
        if normalized_type is None or normalized_type not in ENTITY_TYPE_WHITELIST:
            reason = ENTITY_TYPE_REJECT_HINTS.get(
                str(raw_type or "").strip().lower(),
                f"entity_type 非法：{raw_type or '空'}（白名单：{'/'.join(ENTITY_TYPE_WHITELIST)}）",
            )
            dropped.append(DroppedEntityRead(name=raw_name, entity_type=raw_type, reason=reason, raw=raw))
            warnings.append(f"实体「{raw_name}」类型非法已丢弃：{reason}")
            continue

        aliases_raw = coerce_str_list(raw.get("aliases") or raw.get("alias"))
        if not _passes_candidate_whitelist(raw_name, aliases_raw, whitelist):
            reason = "不在候选名单内（疑似幻觉实体）"
            dropped.append(DroppedEntityRead(name=raw_name, entity_type=normalized_type, reason=reason, raw=raw))
            warnings.append(f"实体「{raw_name}」{reason}，已丢弃。")
            continue

        if haystack and not _grounded_in_source(raw_name, haystack):
            reason = "名称未在原文中出现（疑似幻觉实体）"
            dropped.append(DroppedEntityRead(name=raw_name, entity_type=normalized_type, reason=reason, raw=raw))
            warnings.append(f"实体「{raw_name}」{reason}，已丢弃。")
            continue

        key = normalize_name(raw_name)
        clean_aliases, rejected_aliases = _clean_aliases(
            raw_name=raw_name,
            aliases=aliases_raw,
            whitelist=whitelist,
            haystack=haystack,
        )
        if rejected_aliases:
            warnings.append(f"实体「{raw_name}」的别名 {rejected_aliases} 未在原文/候选名单中出现，已剔除。")

        confidence = round(_coerce_confidence(raw, raw_name, warnings), 4)
        profile = coerce_str(raw.get("profile") or raw.get("description"))

        # 合并目标：同名优先；其次匹配到已有实体的别名（别名归一合并）。
        target_key = key if key in items_by_key else alias_index.get(key)
        if target_key is None:
            target_key = key
            items_by_key[key] = EntityDraftItemRead(
                name=raw_name,
                aliases=clean_aliases,
                entity_type=normalized_type,  # type: ignore[arg-type]
                profile=profile,
                confidence=confidence,
                grounded=True,
            )
            order.append(key)
            raw_names_by_key[key] = [raw_name]
        else:
            existing = items_by_key[target_key]
            existing_keys = {normalize_name(x) for x in existing.aliases}
            existing_keys.add(target_key)
            for alias in clean_aliases:
                alias_key = normalize_name(alias)
                if alias_key and alias_key not in existing_keys:
                    existing_keys.add(alias_key)
                    existing.aliases.append(alias)
            if len(profile) > len(existing.profile):
                existing.profile = profile
            existing.confidence = max(existing.confidence, confidence)
            raw_names_by_key.setdefault(target_key, []).append(raw_name)

        for alias in items_by_key[target_key].aliases:
            alias_key = normalize_name(alias)
            if alias_key:
                alias_index.setdefault(alias_key, target_key)

    for key in order:
        item = items_by_key[key]
        names = [name.strip() for name in raw_names_by_key.get(key, []) if name.strip()]
        extras = sorted({name for name in names if name != item.name.strip()})
        if extras:
            item.merged_from = extras
        if len(names) > 1:
            detail = f"（合并来源：{extras}）" if extras else "（同名重复）"
            warnings.append(f"实体「{item.name}」共出现 {len(names)} 次，已合并为一条{detail}。")

    items = [items_by_key[key] for key in order]
    if len(items) > max_items:
        warnings.append(f"模型返回 {len(items)} 条，超出 max_items={max_items}，已截断。")
        items = items[:max_items]

    return items, dropped, warnings


# ---------------------------------------------------------------------------
# DRY_RUN 占位
# ---------------------------------------------------------------------------


def _placeholder_type_guess(name: str) -> str:
    if any(hint in name for hint in _SCENE_HINTS):
        return "scene"
    if any(hint in name for hint in _PROP_HINTS):
        return "prop"
    return "character"


def build_dry_run_placeholder(
    *,
    source_text: str,
    candidate_names: list[str],
    max_items: int,
) -> tuple[list[EntityDraftItemRead], list[DroppedEntityRead], list[str]]:
    """DRY_RUN 下的占位结果：只做确定性拼装，不含任何模型创作内容。"""
    warnings = [dry_run_warning(skill="实体提取")]
    items: list[EntityDraftItemRead] = []
    seen: set[str] = set()
    haystack = normalize_name(source_text)
    for name in candidate_names:
        clean = str(name).strip()
        key = normalize_name(clean)
        if not clean or not key or key in seen:
            continue
        seen.add(key)
        items.append(
            EntityDraftItemRead(
                name=clean,
                aliases=[],
                entity_type=_placeholder_type_guess(clean),  # type: ignore[arg-type]
                profile="[DRY_RUN 占位] 未调用模型，画像待真实调用后生成。",
                confidence=0.0,
                grounded=_grounded_in_source(clean, haystack),
            )
        )
        if len(items) >= max_items:
            break

    if not items:
        warnings.append("DRY_RUN 占位结果为空：未提供 candidate_names，且未调用模型，因此不编造任何实体草稿。")
    return items, [], warnings


# ---------------------------------------------------------------------------
# 解析 + 后校验
# ---------------------------------------------------------------------------


def _postprocess_raw(
    *,
    raw_text: str,
    source_text: str,
    candidate_names: list[str],
    max_items: int,
) -> tuple[list[EntityDraftItemRead], list[DroppedEntityRead], list[str]]:
    """解析 + 后校验；解析失败走结构化 422。"""
    try:
        parsed, repairs = parse_json_object_with_repairs(raw_text)
        raw_items = extract_raw_entity_items(parsed)
    except JSONParseError as exc:
        raise_parse_failure(exc, raw_text=raw_text)
        raise  # pragma: no cover - raise_parse_failure 一定抛异常

    items, dropped, warnings = postprocess_entities(
        raw_items,
        source_text=source_text,
        candidate_names=candidate_names,
        max_items=max_items,
    )
    if repairs:
        warnings.insert(0, f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")
    return items, dropped, warnings


# ---------------------------------------------------------------------------
# 编排入口
# ---------------------------------------------------------------------------


async def preview_entity_extraction(
    db: AsyncSession,
    *,
    body: EntityExtractionPreviewRequest,
    llm_caller: TextLLMCaller | None = None,
) -> EntityExtractionPreviewRead:
    """实体提取预览：组装上下文 → 提示词 → LLM（或占位）→ 后校验 → 预览。"""
    if body.chapter_text and body.chapter_text.strip():
        chapter_id = body.chapter_id or ""
        source_text = body.chapter_text.strip()
    elif body.chapter_id:
        source = await load_chapter_source(db, body.chapter_id)
        chapter_id = source.chapter_id
        source_text = source.text
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chapter_id 与 chapter_text 至少需要提供一个。",
        )

    if not source_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="章节原文为空，无法提取实体。",
        )

    target, target_warning = await _try_resolve_target(db, needed=llm_caller is None)

    if llm_caller is not None:
        return await _run_with_caller(
            llm_caller=llm_caller,
            chapter_id=chapter_id,
            source_text=source_text,
            body=body,
            target=target,
        )

    if dry_run.dry_run_enabled():
        items, dropped, warnings = build_dry_run_placeholder(
            source_text=source_text,
            candidate_names=body.candidate_names,
            max_items=body.max_items,
        )
        if target_warning:
            warnings.append(target_warning)
        return EntityExtractionPreviewRead(
            chapter_id=chapter_id or None,
            source_chars=len(source_text),
            items=items,
            dropped=dropped,
            warnings=warnings,
            meta=build_run_meta(
                target=target,
                llm_called=False,
                raw_output_chars=0,
                dry_run_reason=dry_run.short_status(),
            ),
        )

    if target is None:  # pragma: no cover - dry_run 关闭时 _try_resolve_target 必然抛出
        target, _ = await _try_resolve_target(db, needed=True)

    prompt = build_entity_extraction_prompt(
        chapter_id=chapter_id,
        chapter_text=source_text,
        candidate_names=body.candidate_names,
        max_items=body.max_items,
        extra_instructions=body.extra_instructions,
    )
    try:
        completion = await call_text_llm(prompt, target=target)
    except LLMRequestError as exc:
        raise_llm_failure(exc)
        raise  # pragma: no cover - raise_llm_failure 一定抛异常

    items, dropped, warnings = _postprocess_raw(
        raw_text=completion.text,
        source_text=source_text,
        candidate_names=body.candidate_names,
        max_items=body.max_items,
    )
    return EntityExtractionPreviewRead(
        chapter_id=chapter_id or None,
        source_chars=len(source_text),
        items=items,
        dropped=dropped,
        warnings=warnings,
        meta=build_run_meta(
            target=target,
            llm_called=True,
            latency_ms=completion.latency_ms,
            raw_output_chars=len(completion.text),
        ),
    )


async def _try_resolve_target(
    db: AsyncSession,
    *,
    needed: bool,
) -> tuple[TextLLMTarget | None, str | None]:
    """解析默认文本模型；DRY_RUN 下解析失败只记 warning，不阻断预览。"""
    try:
        return await resolve_text_llm_target(db), None
    except HTTPException as exc:
        if needed and not dry_run.dry_run_enabled():
            raise
        return None, f"未能解析默认文本模型配置：{exc.detail}"


async def _run_with_caller(
    *,
    llm_caller: TextLLMCaller,
    chapter_id: str,
    source_text: str,
    body: EntityExtractionPreviewRequest,
    target: TextLLMTarget | None,
) -> EntityExtractionPreviewRead:
    """测试/嵌入式调用路径：用注入的 caller 替代真实 HTTP。"""
    prompt = build_entity_extraction_prompt(
        chapter_id=chapter_id,
        chapter_text=source_text,
        candidate_names=body.candidate_names,
        max_items=body.max_items,
        extra_instructions=body.extra_instructions,
    )
    raw_text = await llm_caller(prompt)
    items, dropped, warnings = _postprocess_raw(
        raw_text=raw_text,
        source_text=source_text,
        candidate_names=body.candidate_names,
        max_items=body.max_items,
    )
    return EntityExtractionPreviewRead(
        chapter_id=chapter_id or None,
        source_chars=len(source_text),
        items=items,
        dropped=dropped,
        warnings=warnings,
        meta=build_run_meta(
            target=target,
            llm_called=True,
            raw_output_chars=len(raw_text),
        ),
    )


def dump_raw_items(raw_text: str) -> str:
    """调试辅助：把模型原始输出格式化成可读 JSON 片段（不落库）。"""
    try:
        parsed, _ = parse_json_object_with_repairs(raw_text)
    except JSONParseError:
        return raw_text[:800]
    return json.dumps(parsed, ensure_ascii=False, indent=2)[:800]
