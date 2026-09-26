"""P2 资产绑定编排服务：LLM 实体链接 + 置信度分层 + 与启发式/已有绑定对账。

统一内部模式与 P1 一致：组装候选清单 → 构建提示词 → 调 LLM（经守卫）→ 解析 + 确定性后校验
→ 返回预览。

边界（硬约束）：
- **只产生建议，绝不写库**：本模块没有 db.add / db.commit / db.flush；
- 人工确认写库复用现有端点，不新增 apply 路由（对应用户方案文档 §3.3 的决策）：
  - 角色 → POST /api/v1/studio/shot-character-links
  - 场景 → POST /api/v1/studio/shot-links/scene
  - 道具 → POST /api/v1/studio/shot-links/prop
  - 服装 → POST /api/v1/studio/shot-links/costume
- 不改数据库结构：已有绑定状态从 ProjectSceneLink / ProjectPropLink / ProjectCostumeLink
  / ShotCharacterLink 读取（这些表早就存在，不需要新表）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    Chapter,
    Character,
    Costume,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    Scene,
    Shot,
    ShotCharacterLink,
)
from app.schemas.studio.llm_orchestration import (
    AssetBindingPreviewRead,
    AssetBindingPreviewRequest,
    AssetBindingShotRead,
    BindingCandidateRead,
    BindingDroppedRead,
    BindingSuggestionRead,
    BindingUnmatchedRead,
)
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import (
    LLMRequestError,
    TextLLMCaller,
    TextLLMTarget,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_float,
    coerce_str,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import LLM_BINDING_TEMPLATE
from app.services.studio.llm_orchestration.support import (
    build_run_meta,
    dry_run_warning,
    raise_llm_failure,
    raise_parse_failure,
)

# 置信度分层阈值（模块常量，与用户方案文档 §6 一致）。
AUTO_TIER = 0.85
REVIEW_TIER = 0.5

# 槽位定义：槽位名 → 该槽位允许的资产类型。
SLOT_ASSET_TYPES: dict[str, tuple[str, ...]] = {
    "characters": ("character",),
    "scene": ("scene",),
    "props": ("prop",),
    "costumes": ("costume",),
}

# 槽位是否允许多个（场景每镜头最多 1 个）。
SLOT_MULTI: dict[str, bool] = {
    "characters": True,
    "scene": False,
    "props": True,
    "costumes": True,
}

DEFAULT_BATCH_SIZE = 8
MAX_BATCH_SIZE = 20
DEFAULT_MAX_SHOTS = 40
MAX_CANDIDATES = 200
DESCRIPTION_CLIP = 60
SHOT_TEXT_CLIP = 800

# 人工确认写库的端点映射（只作文档用途，本模块不调用）。
CONFIRM_ENDPOINTS: dict[str, str] = {
    "character": "POST /api/v1/studio/shot-character-links",
    "scene": "POST /api/v1/studio/shot-links/scene",
    "prop": "POST /api/v1/studio/shot-links/prop",
    "costume": "POST /api/v1/studio/shot-links/costume",
}


def _clip(text: Any, limit: int) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else value[:limit].rstrip() + "…"


# ---------------------------------------------------------------------------
# 1) 候选清单
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class BindingCandidate:
    asset_id: str
    asset_type: str
    name: str
    aliases: list[str] = field(default_factory=list)
    description: str = ""

    def to_read(self) -> BindingCandidateRead:
        return BindingCandidateRead(
            asset_id=self.asset_id,
            asset_type=self.asset_type,
            name=self.name,
            aliases=list(self.aliases),
            description=self.description,
        )


def build_catalog_from_rows(rows: list[tuple[str, str, str, str, list[str]]]) -> list[BindingCandidate]:
    """把 (asset_id, asset_type, name, description, tags) 行压成候选清单。

    别名来源：场景/道具/服装/演员表有 ``tags`` 列 → 直接当别名；
    角色表（characters）没有 tags 列，因此 aliases 只做名称归一，不编造别名。
    """
    catalog: list[BindingCandidate] = []
    seen: set[tuple[str, str]] = set()
    for asset_id, asset_type, name, description, tags in rows:
        clean_name = str(name or "").strip()
        if not clean_name:
            continue
        key = (asset_type, asset_id)
        if key in seen:
            continue
        seen.add(key)
        aliases: list[str] = []
        for tag in tags or []:
            text = str(tag or "").strip()
            if text and normalize_name(text) != normalize_name(clean_name) and text not in aliases:
                aliases.append(text)
        catalog.append(
            BindingCandidate(
                asset_id=str(asset_id),
                asset_type=asset_type,
                name=clean_name,
                aliases=aliases,
                description=_clip(description, DESCRIPTION_CLIP),
            )
        )
    return catalog[:MAX_CANDIDATES]


async def load_candidate_catalog(db: AsyncSession, *, project_id: str) -> list[BindingCandidate]:
    """装载项目内可绑定资产：角色（项目内）+ 场景/道具/服装（项目关联）。"""
    rows: list[tuple[str, str, str, str, list[str]]] = []

    characters = (
        (await db.execute(select(Character).where(Character.project_id == project_id).order_by(Character.id)))
        .scalars()
        .all()
    )
    for row in characters:
        rows.append((row.id, "character", row.name, row.description, []))

    scene_rows = (
        (
            await db.execute(
                select(Scene)
                .join(ProjectSceneLink, ProjectSceneLink.scene_id == Scene.id)
                .where(ProjectSceneLink.project_id == project_id)
                .order_by(Scene.id)
            )
        )
        .scalars()
        .all()
    )
    for row in scene_rows:
        rows.append((row.id, "scene", row.name, row.description, list(row.tags or [])))

    prop_rows = (
        (
            await db.execute(
                select(Prop)
                .join(ProjectPropLink, ProjectPropLink.prop_id == Prop.id)
                .where(ProjectPropLink.project_id == project_id)
                .order_by(Prop.id)
            )
        )
        .scalars()
        .all()
    )
    for row in prop_rows:
        rows.append((row.id, "prop", row.name, row.description, list(row.tags or [])))

    costume_rows = (
        (
            await db.execute(
                select(Costume)
                .join(ProjectCostumeLink, ProjectCostumeLink.costume_id == Costume.id)
                .where(ProjectCostumeLink.project_id == project_id)
                .order_by(Costume.id)
            )
        )
        .scalars()
        .all()
    )
    for row in costume_rows:
        rows.append((row.id, "costume", row.name, row.description, list(row.tags or [])))

    return build_catalog_from_rows(rows)


# ---------------------------------------------------------------------------
# 2) 镜头批次
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class BindingShot:
    shot_id: str
    index: int
    title: str
    script_text: str
    bound_ids: dict[str, set[str]] = field(default_factory=dict)


async def load_shots_for_binding(
    db: AsyncSession,
    *,
    project_id: str,
    shot_ids: list[str] | None = None,
    max_shots: int = DEFAULT_MAX_SHOTS,
) -> list[BindingShot]:
    """取镜头（默认整项目）+ 其已有绑定状态（作为对账的第二意见）。"""
    stmt = (
        select(Shot)
        .join(Chapter, Chapter.id == Shot.chapter_id)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.index, Shot.index)
    )
    if shot_ids:
        stmt = stmt.where(Shot.id.in_(list(shot_ids)))
    shots = (await db.execute(stmt)).scalars().all()
    if shot_ids:
        # 保持调用方给的顺序，同时暴露无效 ID。
        order = {sid: i for i, sid in enumerate(shot_ids)}
        shots = sorted(shots, key=lambda item: order.get(item.id, len(order)))
    if not shots:
        return []

    trimmed = list(shots)[:max_shots]
    ids = [item.id for item in trimmed]
    bound: dict[str, dict[str, set[str]]] = {
        shot_id: {"characters": set(), "scene": set(), "props": set(), "costumes": set()} for shot_id in ids
    }

    for row in (await db.execute(select(ShotCharacterLink).where(ShotCharacterLink.shot_id.in_(ids)))).scalars():
        bound[row.shot_id]["characters"].add(str(row.character_id))
    for row in (await db.execute(select(ProjectSceneLink).where(ProjectSceneLink.shot_id.in_(ids)))).scalars():
        bound[str(row.shot_id)]["scene"].add(str(row.scene_id))
    for row in (await db.execute(select(ProjectPropLink).where(ProjectPropLink.shot_id.in_(ids)))).scalars():
        bound[str(row.shot_id)]["props"].add(str(row.prop_id))
    for row in (await db.execute(select(ProjectCostumeLink).where(ProjectCostumeLink.shot_id.in_(ids)))).scalars():
        bound[str(row.shot_id)]["costumes"].add(str(row.costume_id))

    return [
        BindingShot(
            shot_id=item.id,
            index=item.index,
            title=item.title or "",
            script_text=_clip(item.script_excerpt, SHOT_TEXT_CLIP),
            bound_ids=bound.get(item.id, {}),
        )
        for item in trimmed
    ]


def missing_shot_ids(requested: list[str], shots: list[BindingShot]) -> list[str]:
    found = {shot.shot_id for shot in shots}
    return [sid for sid in requested if sid not in found]


# ---------------------------------------------------------------------------
# 3) 提示词
# ---------------------------------------------------------------------------


def _render_catalog(catalog: list[BindingCandidate]) -> str:
    if not catalog:
        return "（候选清单为空：项目内还没有可绑定资产，请先创建实体资产。）"
    groups: dict[str, list[str]] = {"character": [], "scene": [], "prop": [], "costume": []}
    for item in catalog:
        alias_text = "、".join(item.aliases) if item.aliases else "无"
        line = f"- {item.asset_id} | 名称: {item.name} | 别名: {alias_text}"
        if item.description:
            line += f" | 简介: {item.description}"
        groups.setdefault(item.asset_type, []).append(line)
    labels = {"character": "人物", "scene": "场景", "prop": "道具", "costume": "服装"}
    blocks: list[str] = []
    for key in ("character", "scene", "prop", "costume"):
        items = groups.get(key) or []
        if items:
            blocks.append(f"[{labels[key]}]\n" + "\n".join(items))
    return "\n".join(blocks)


def _render_shots(shots: list[BindingShot]) -> str:
    blocks: list[str] = []
    for shot in shots:
        blocks.append(f"[S{shot.index:03d}] {shot.shot_id}\n剧情: {shot.script_text or '（无剧情文本）'}")
    return "\n".join(blocks)


def build_binding_prompt(*, catalog: list[BindingCandidate], shots: list[BindingShot], episode_id: str = "") -> str:
    """按用户方案文档 §4 模板组装（并按 Jellyfish 需求补了服装槽）。"""
    return LLM_BINDING_TEMPLATE.safe_substitute(
        catalog=_render_catalog(catalog),
        shots=_render_shots(shots),
        episode_id=episode_id or "（未指定）",
    )


# ---------------------------------------------------------------------------
# 4) 启发式第二意见（确定性，不调模型）
# ---------------------------------------------------------------------------


def heuristic_suggestions(shot_text: str, catalog: list[BindingCandidate]) -> dict[str, list[str]]:
    """最小规则版实体链接：名称/别名在镜头文本中直接出现即算命中。

    仅作为"第二意见"参与对账，不参与最终建议的生成，也不会写库。
    """
    result: dict[str, list[str]] = {slot: [] for slot in SLOT_ASSET_TYPES}
    haystack = normalize_name(shot_text)
    if not haystack:
        return result
    for item in catalog:
        slot = _slot_for_asset_type(item.asset_type)
        if slot is None:
            continue
        names = [item.name, *item.aliases]
        if any(normalize_name(n) and normalize_name(n) in haystack for n in names):
            result[slot].append(item.asset_id)
    return result


def _slot_for_asset_type(asset_type: str) -> str | None:
    for slot, types in SLOT_ASSET_TYPES.items():
        if asset_type in types:
            return slot
    return None


# ---------------------------------------------------------------------------
# 5) 解析 + 确定性后校验（对应方案文档 §5 的 7 条规则）
# ---------------------------------------------------------------------------


def parse_binding_response(
    raw_text: str,
    *,
    catalog: list[BindingCandidate],
    shots: list[BindingShot],
) -> tuple[dict[str, list[dict[str, Any]]], list[BindingDroppedRead], list[str], list[str]]:
    """解析模型输出并逐条后校验。

    返回 ``(shot_id -> 正文化后的槽位数据, dropped, unmatched, warnings)``。
    """
    try:
        parsed, repairs = parse_json_object_with_repairs(raw_text)
    except JSONParseError as exc:
        raise_parse_failure(exc, raw_text=raw_text)
        raise  # pragma: no cover

    warnings: list[str] = []
    if repairs:
        warnings.append(f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")

    raw_shots = parsed.get("shots")
    if not isinstance(raw_shots, list):
        raise_parse_failure(
            JSONParseError("模型返回的 JSON 里找不到 shots 数组。", raw_text=raw_text),
            raw_text=raw_text,
        )

    by_id = {item.asset_id: item for item in catalog}
    valid_shot_ids = {shot.shot_id for shot in shots}
    normalized: dict[str, list[dict[str, Any]]] = {}
    dropped: list[BindingDroppedRead] = []
    unmatched: list[BindingUnmatchedRead] = []

    for index, raw_shot in enumerate(raw_shots, start=1):
        if not isinstance(raw_shot, dict):
            warnings.append(f"第 {index} 个镜头结果不是对象，已忽略。")
            continue
        shot_id = coerce_str(raw_shot.get("shot_id"))
        # 规则 1：shot_id 必须在请求批次内（防串镜头）
        if shot_id not in valid_shot_ids:
            dropped.append(BindingDroppedRead(shot_id=shot_id or f"第{index}条", reason="shot_id 不在请求批次内"))
            warnings.append(f"模型返回了批次外的 shot_id「{shot_id}」，整条丢弃。")
            continue

        rows: list[dict[str, Any]] = []
        for slot, allowed_types in SLOT_ASSET_TYPES.items():
            raw_slot = raw_shot.get(slot)
            if raw_slot is None:
                continue
            items = raw_slot if isinstance(raw_slot, list) else [raw_slot]
            seen_ids: dict[str, dict[str, Any]] = {}
            for item in items:
                if not isinstance(item, dict):
                    continue
                asset_id = coerce_str(item.get("asset_id"))
                # 规则 2：asset_id 必须在候选清单内（防幻觉）
                candidate = by_id.get(asset_id)
                if candidate is None:
                    dropped.append(
                        BindingDroppedRead(
                            shot_id=shot_id,
                            slot=slot,
                            asset_id=asset_id,
                            reason=f"asset_id「{asset_id}」不在候选清单内（疑似幻觉）",
                        )
                    )
                    continue
                # 规则 3：槽位类型一致
                if candidate.asset_type not in allowed_types:
                    dropped.append(
                        BindingDroppedRead(
                            shot_id=shot_id,
                            slot=slot,
                            asset_id=asset_id,
                            reason=f"类型不匹配：{candidate.asset_type} 不能放进 {slot} 槽位",
                        )
                    )
                    continue
                # 规则 4：confidence 数值化并 clamp
                confidence = coerce_float(item.get("confidence"))
                if confidence is None:
                    confidence = 0.0
                    warnings.append(f"{shot_id} / {asset_id} 缺少可解析的 confidence，按 0 处理。")
                elif confidence < 0 or confidence > 1:
                    clamped = min(1.0, max(0.0, confidence))
                    warnings.append(f"{shot_id} / {asset_id} 的 confidence={confidence} 越界，已钳制为 {clamped}。")
                    confidence = clamped

                # 规则 5：同槽位去重，保留置信度最高者
                previous = seen_ids.get(asset_id)
                if previous is not None:
                    if confidence > previous["confidence"]:
                        previous["confidence"] = confidence
                        previous["reason"] = coerce_str(item.get("reason")) or previous["reason"]
                    warnings.append(f"{shot_id} / {slot} 中 {asset_id} 重复出现，已保留置信度最高的一条。")
                    continue
                seen_ids[asset_id] = {
                    "slot": slot,
                    "asset_id": asset_id,
                    "asset_type": candidate.asset_type,
                    "asset_name": candidate.name,
                    "confidence": round(float(confidence), 4),
                    "reason": coerce_str(item.get("reason")),
                }
                rows.append(seen_ids[asset_id])

            # 规则 6：单值槽位（场景）超过 1 个 → 保留置信度最高者
            if not SLOT_MULTI[slot]:
                slot_rows = [row for row in rows if row["slot"] == slot]
                if len(slot_rows) > 1:
                    best = max(slot_rows, key=lambda row: row["confidence"])
                    for row in slot_rows:
                        if row is not best:
                            rows.remove(row)
                            warnings.append(
                                f"{shot_id} 的 {slot} 槽位返回了多个资产，已保留置信度最高的"
                                f"「{best['asset_name']}」，其余转 warning。"
                            )
        normalized[shot_id] = rows

        for raw_unmatched in raw_shot.get("unmatched_names") or []:
            if isinstance(raw_unmatched, dict):
                name = coerce_str(raw_unmatched.get("name"))
                if name:
                    unmatched.append(
                        BindingUnmatchedRead(
                            shot_id=shot_id,
                            name=name,
                            guessed_type=coerce_str(raw_unmatched.get("guessed_type")),
                            evidence=coerce_str(raw_unmatched.get("evidence")),
                        )
                    )
            elif isinstance(raw_unmatched, str) and raw_unmatched.strip():
                unmatched.append(
                    BindingUnmatchedRead(shot_id=shot_id, name=raw_unmatched.strip(), guessed_type="", evidence="")
                )

    if dropped:
        by_reason: dict[str, int] = {}
        for item in dropped:
            by_reason[item.reason] = by_reason.get(item.reason, 0) + 1
        summary = "；".join(f"{reason}×{count}" for reason, count in by_reason.items())
        warnings.append(f"后校验丢弃 {len(dropped)} 条绑定：{summary}")

    return normalized, dropped, unmatched, warnings


# ---------------------------------------------------------------------------
# 6) 对账 + 分层
# ---------------------------------------------------------------------------


def classify_tier(*, confidence: float, agreement: str) -> str:
    """置信度分层（方案文档 §6）。"""
    if confidence < REVIEW_TIER:
        return "discard"
    if agreement in {"conflict", "heuristic_only"}:
        return "review"
    if confidence >= AUTO_TIER and agreement in {"both", "llm_only"}:
        return "auto"
    return "review"


def reconcile_with_heuristic(
    *,
    rows: list[dict[str, Any]],
    heuristic: dict[str, list[str]],
    bound_ids: dict[str, set[str]],
) -> tuple[list[BindingSuggestionRead], dict[str, set[str]]]:
    """逐条打标 agreement，并标出是否已绑定。

    agreement 取值：
    - both：LLM 与启发式都建议
    - llm_only：只有 LLM 建议（通常是启发式漏了）
    - conflict：同槽位已有另外的绑定，但 LLM 没建议它
    - heuristic_only：启发式建议了但 LLM 没建议（作为备选行追加）
    """
    suggestions: list[BindingSuggestionRead] = []
    llm_keys: dict[str, set[str]] = {slot: set() for slot in SLOT_ASSET_TYPES}

    for row in rows:
        slot = row["slot"]
        asset_id = row["asset_id"]
        llm_keys[slot].add(asset_id)
        in_heuristic = asset_id in set(heuristic.get(slot, []))
        already = asset_id in (bound_ids.get(slot) or set())
        if in_heuristic:
            agreement = "both"
            confidence = min(1.0, float(row["confidence"]) + 0.05)
        else:
            agreement = "llm_only"
            confidence = float(row["confidence"])
        suggestions.append(
            BindingSuggestionRead(
                slot=slot,
                asset_id=asset_id,
                asset_type=row["asset_type"],
                asset_name=row["asset_name"],
                confidence=round(confidence, 4),
                reason=row["reason"],
                agreement=agreement,  # type: ignore[arg-type]
                tier=classify_tier(confidence=confidence, agreement=agreement),  # type: ignore[arg-type]
                already_bound=already,
                confirm_endpoint=CONFIRM_ENDPOINTS.get(row["asset_type"], ""),
            )
        )

    # heuristic_only：启发式命中但 LLM 没建议 → 作为 review 备选
    by_key: dict[tuple[str, str], BindingSuggestionRead] = {
        (item.slot, item.asset_id): item for item in suggestions
    }
    for slot, ids in heuristic.items():
        for asset_id in ids:
            if asset_id in llm_keys[slot]:
                continue
            key = (slot, asset_id)
            if key in by_key:
                continue
            by_key[key] = BindingSuggestionRead(
                slot=slot,
                asset_id=asset_id,
                asset_type=(SLOT_ASSET_TYPES[slot][0]),
                asset_name="",
                confidence=0.0,
                reason="启发式命中但 LLM 未建议，作为备选供人工判断",
                agreement="heuristic_only",
                tier="review",
                already_bound=asset_id in (bound_ids.get(slot) or set()),
                confirm_endpoint=CONFIRM_ENDPOINTS.get(SLOT_ASSET_TYPES[slot][0], ""),
            )

    # conflict：已有绑定但 LLM 没建议它（同槽位同资产已存在备选行时，升级为 conflict 而不是加重复行）
    for slot, ids in (bound_ids or {}).items():
        for asset_id in ids:
            if asset_id in llm_keys.get(slot, set()):
                continue
            key = (slot, asset_id)
            existing = by_key.get(key)
            if existing is not None:
                existing.agreement = "conflict"
                existing.tier = "review"
                existing.already_bound = True
                existing.reason = "镜头已绑定该资产且启发式也命中，但 LLM 未建议，需人工复核是否解绑"
                continue
            by_key[key] = BindingSuggestionRead(
                slot=slot,
                asset_id=asset_id,
                asset_type=(SLOT_ASSET_TYPES[slot][0]),
                asset_name="",
                confidence=0.0,
                reason="镜头已绑定该资产，但 LLM 未建议，需人工复核是否要解绑",
                agreement="conflict",
                tier="review",
                already_bound=True,
                confirm_endpoint=CONFIRM_ENDPOINTS.get(SLOT_ASSET_TYPES[slot][0], ""),
            )

    return list(by_key.values()), llm_keys


def summarize_tiers(suggestions: list[BindingSuggestionRead]) -> dict[str, int]:
    counts = {"auto": 0, "review": 0, "discard": 0}
    for item in suggestions:
        counts[item.tier] = counts.get(item.tier, 0) + 1
    return counts


def estimate_cost_note(*, batches: int, catalog_size: int, shot_count: int) -> str:
    """粗略成本提示（不精确，只为让操作者知道量级）。"""
    input_tokens = batches * (catalog_size * 25 + min(shot_count, DEFAULT_BATCH_SIZE) * 300)
    output_tokens = batches * 600
    return (
        f"估算 {batches} 批，输入约 {input_tokens} tokens、输出约 {output_tokens} tokens"
        f"（deepseek-chat 量级 < ¥0.1）；DRY_RUN 下不产生任何费用。"
    )


# ---------------------------------------------------------------------------
# 7) DRY_RUN 占位
# ---------------------------------------------------------------------------


def build_dry_run_preview(
    *,
    shots: list[BindingShot],
    catalog: list[BindingCandidate],
) -> tuple[list[AssetBindingShotRead], list[str]]:
    """DRY_RUN 占位：只跑确定性启发式，不编造 LLM 建议。"""
    warnings = [dry_run_warning(skill="资产绑定")]
    result: list[AssetBindingShotRead] = []
    for shot in shots:
        heuristic = heuristic_suggestions(shot.script_text, catalog)
        suggestions, _ = reconcile_with_heuristic(
            rows=[],
            heuristic=heuristic,
            bound_ids=shot.bound_ids,
        )
        result.append(
            AssetBindingShotRead(
                shot_id=shot.shot_id,
                index=shot.index,
                title=shot.title,
                script_excerpt=shot.script_text,
                suggestions=suggestions,
                heuristic_suggestions=heuristic,
                bound={slot: sorted(ids) for slot, ids in (shot.bound_ids or {}).items()},
                warnings=["[DRY_RUN 占位] 未调用模型；上方建议仅来自启发式规则，不是 LLM 判断。"],
            )
        )
    return result, warnings


# ---------------------------------------------------------------------------
# 编排入口
# ---------------------------------------------------------------------------


async def preview_asset_binding(
    db: AsyncSession,
    *,
    body: AssetBindingPreviewRequest,
    llm_caller: TextLLMCaller | None = None,
) -> AssetBindingPreviewRead:
    """资产绑定预览：候选清单 → 分批提示词 → LLM（或占位）→ 后校验 → 分层 → 预览。"""
    catalog = await load_candidate_catalog(db, project_id=body.project_id)
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"项目 {body.project_id} 内没有可绑定资产，请先创建角色/场景/道具/服装。",
        )

    requested = [str(x).strip() for x in (body.shot_ids or []) if str(x).strip()]
    shots = await load_shots_for_binding(
        db,
        project_id=body.project_id,
        shot_ids=requested or None,
        max_shots=body.max_shots,
    )
    if not shots:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"项目 {body.project_id} 内没有找到可处理的镜头。",
        )

    warnings: list[str] = []
    missing = missing_shot_ids(requested, shots)
    if missing:
        warnings.append(f"以下 shot_id 不属于该项目或不存在，已忽略：{missing}。")
    if len(shots) >= body.max_shots and not requested:
        warnings.append(f"镜头数达到 max_shots={body.max_shots} 上限，本次只处理前 {len(shots)} 个镜头。")

    batch_size = max(1, min(int(body.batch_size or DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE))
    batches = [shots[i : i + batch_size] for i in range(0, len(shots), batch_size)]

    target, target_warning = await _try_resolve_target(db, needed=llm_caller is None)
    if target_warning:
        warnings.append(target_warning)

    cost_note = estimate_cost_note(batches=len(batches), catalog_size=len(catalog), shot_count=len(shots))

    if llm_caller is None and dry_run.dry_run_enabled():
        shot_reads, dry_warnings = build_dry_run_preview(shots=shots, catalog=catalog)
        warnings.extend(dry_warnings)
        return AssetBindingPreviewRead(
            project_id=body.project_id,
            catalog=[item.to_read() for item in catalog],
            shots=shot_reads,
            dropped=[],
            parse_warnings=warnings,
            batch_count=len(batches),
            batch_size=batch_size,
            tier_summary=summarize_tiers([s for shot in shot_reads for s in shot.suggestions]),
            cost_note=cost_note,
            meta=build_run_meta(
                target=target,
                llm_called=False,
                raw_output_chars=0,
                dry_run_reason=dry_run.short_status(),
            ),
        )

    if llm_caller is None and target is None:  # pragma: no cover
        target, _ = await _try_resolve_target(db, needed=True)

    shot_reads = []
    dropped_all: list[BindingDroppedRead] = []
    unmatched_all: list[BindingUnmatchedRead] = []
    errors: list[str] = []
    raw_chars = 0
    latency_ms = 0

    for batch_index, batch in enumerate(batches, start=1):
        prompt = build_binding_prompt(catalog=catalog, shots=batch, episode_id=body.episode_id or "")
        try:
            if llm_caller is not None:
                raw_text = await llm_caller(prompt)
                batch_latency = 0
            else:
                assert target is not None
                completion = await call_text_llm(prompt, target=target)
                raw_text = completion.text
                batch_latency = completion.latency_ms
        except LLMRequestError as exc:
            if batch_index == 1 and len(batches) == 1:
                raise_llm_failure(exc)
            errors.append(f"第 {batch_index} 批调用失败：{exc}")
            warnings.append(f"第 {batch_index} 批调用失败，已跳过该批（其余批次继续）。")
            continue

        raw_chars += len(raw_text)
        latency_ms += batch_latency
        try:
            normalized, dropped, unmatched, parse_warnings = parse_binding_response(
                raw_text, catalog=catalog, shots=batch
            )
        except (JSONParseError, HTTPException) as exc:
            # 单批请求：解析失败直接给结构化 422；多批请求：标 error 但不中断其他批次。
            if len(batches) == 1:
                if isinstance(exc, HTTPException):
                    raise
                raise_parse_failure(exc, raw_text=raw_text)
                raise  # pragma: no cover
            message = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            errors.append(f"第 {batch_index} 批解析失败：{message}")
            warnings.append(f"第 {batch_index} 批模型输出无法解析，已跳过该批。")
            continue

        dropped_all.extend(dropped)
        unmatched_all.extend(unmatched)
        warnings.extend(parse_warnings)

        for shot in batch:
            heuristic = (
                heuristic_suggestions(shot.script_text, catalog) if body.include_heuristic else {}
            )
            suggestions, _ = reconcile_with_heuristic(
                rows=normalized.get(shot.shot_id, []),
                heuristic=heuristic,
                bound_ids=shot.bound_ids,
            )
            shot_warnings: list[str] = []
            if not suggestions:
                shot_warnings.append("模型未给出任何绑定建议，请人工判断。")
            shot_reads.append(
                AssetBindingShotRead(
                    shot_id=shot.shot_id,
                    index=shot.index,
                    title=shot.title,
                    script_excerpt=shot.script_text,
                    suggestions=suggestions,
                    heuristic_suggestions=heuristic,
                    bound={slot: sorted(ids) for slot, ids in (shot.bound_ids or {}).items()},
                    warnings=shot_warnings,
                )
            )

    all_suggestions = [item for shot in shot_reads for item in shot.suggestions]
    return AssetBindingPreviewRead(
        project_id=body.project_id,
        catalog=[item.to_read() for item in catalog],
        shots=shot_reads,
        dropped=dropped_all,
        unmatched_names=unmatched_all,
        parse_warnings=warnings,
        batch_count=len(batches),
        batch_size=batch_size,
        tier_summary=summarize_tiers(all_suggestions),
        errors=errors,
        cost_note=cost_note,
        meta=build_run_meta(
            target=target,
            llm_called=llm_caller is not None or raw_chars > 0,
            latency_ms=latency_ms or None,
            raw_output_chars=raw_chars,
        ),
    )


async def _try_resolve_target(
    db: AsyncSession,
    *,
    needed: bool,
) -> tuple[TextLLMTarget | None, str | None]:
    try:
        return await resolve_text_llm_target(db), None
    except HTTPException as exc:
        if needed and not dry_run.dry_run_enabled():
            raise
        return None, f"未能解析默认文本模型配置：{exc.detail}"
