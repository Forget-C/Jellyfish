"""第 2 步「资产准备」的**工作台**读接口：一个资产一行，页面只读这一份数据。

要解决的问题（用户 2026-09 的真实反馈）
======================================

改造前这一页把三张表**纵向堆在一起**（原始候选确认表 → 资产生产表 → 图片提示词生成表），
同一批资产被重复展示三次，主页面还暴露了大量后台维度（候选多少条、聚合多少组、槽位、
项目内资产 / 全局资产、提示词质量未知、最终提示词及差异、生成依据内部计数、接口名…）。

真实项目「御兽嫡长女」第 1 集上还暴露了两个数据链路问题：

1. 11 个资产（人物 7 / 场景 1 / 道具 3）的 ``description`` 全是空、没有任何已保存提示词、
   ``chapter_asset_profiles`` 0 行 —— 页面却同时显示"可以生成图片"和"本次未提供生成依据"；
2. 旧数据里保存过的提示词（"外观信息不足，需人工补充"这类）仍然被当成"可出图"。

本模块是这一页的**单一数据源**，只读、不调用任何模型、不出图、不写库：

- ``items``：**一项资产只出现一次**，四类资产同构（人物 / 场景 / 道具 / 服装共用这一份）；
- ``pending_review``：只收**真正需要人工**的（别名指向两个不同资产、同名异类、
  同一名称的候选各自关联了不同资产、候选里有服装但还没有服装资产）；
  无冲突的候选按 ``auto_confirm_unconflicted`` 的既有口径**自动合并 / 自动匹配**，
  绝不要求用户逐条确认；
- ``analysis``：沿用既有 ``chapter_asset_profile_runs`` 的四种状态
  （``not_generated`` / ``generated`` / ``stale`` / ``records_only``）；
- ``technical``：候选条数 / 聚合组 / 匹配诊断等**后台维度**，前端默认收起。

复用的既有实现（**不另写一套**）：

============================  =========================================================
候选聚合与同名匹配             ``build_chapter_asset_candidates`` + ``_finalize_items``
冲突判定（= 自动确认口径）      ``detect_conflicts``（生成路径 / 读库路径共用的那一份）
资产资料 / 人工修改             ``chapter_asset_record_store``（生效画像 = 模型 ⊕ 人工）
提示词质量（含旧数据重判）      ``asset_prompt_quality.audit_saved_prompts``
图片与定版图                   ``entity_thumbnails.resolve_thumbnail_infos``
剧本/分镜变化判定               ``chapter_asset_profile_cache.build_chapter_profile_cache_key``
============================  =========================================================

**关于写库**：本模块一次写库动作都没有 —— 既有的 ``build_chapter_asset_profiles`` 在读路径上
会把内容已变化的 run 标成 ``stale``（轻量写）；工作台是页面轮询用的只读接口，
只如实回报 ``analysis.status="stale"``，**不改写任何行**（标记仍由既有读路径完成）。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter
from app.models.studio_asset_profiles import RUN_STATUS_STALE
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.services.common import entity_not_found
from app.services.studio.asset_overlays import plot_identity_for_fields
from app.services.studio.asset_profiles import (
    ASSET_TYPES,
    is_vague_text,
    normalize_profile,
    profile_missing_fields,
    render_profile_text,
    type_label,
)
from app.services.studio.asset_prompt_quality import (
    VERDICT_BLOCKED,
    VERDICT_LABELS,
    VERDICT_NEEDS_REGENERATION,
    VERDICT_OK,
    audit_saved_prompts,
    saved_prompt_texts,
)
from app.services.studio.chapter_asset_candidates import build_chapter_asset_candidates
from app.services.studio.chapter_asset_profile_cache import build_chapter_profile_cache_key
from app.services.studio.chapter_asset_profiles import (
    CONFLICT_ALIAS_SPLIT,
    CONFLICT_DUPLICATE_NAME,
    CONFLICT_TYPE_MISMATCH,
    _finalize_items,
    _load_shots,
    shot_refs_for_name,
)
from app.services.studio.chapter_asset_record_store import (
    RUN_STATUS_TEXT,
    effective_profile,
    get_latest_run,
    list_chapter_records,
    plot_identity_of,
)
from app.services.studio.entity_specs import entity_spec
from app.services.studio.entity_thumbnails import resolve_thumbnail_infos
from app.services.studio.image_pipeline.asset_strategies import SLOT_BY_ASSET_TYPE
from app.services.studio.llm_orchestration.context import load_chapter_source
from app.services.studio.llm_orchestration.json_utils import normalize_name
from app.services.studio.llm_orchestration.registry import (
    ASSET_IMAGE_PROMPT_SLOTS,
    IMAGE_PROMPT_SLOT_BY_CATEGORY,
)

# ---------------------------------------------------------------------------
# 常量：状态机 / 分析状态 / 待人工处理
# ---------------------------------------------------------------------------

#: 用户语言的状态机（页面只认这几个 key；label 是中文）
STATUS_NEEDS_PROFILE = "needs_profile"
STATUS_PRIMARY = "primary"
STATUS_HAS_IMAGE = "has_image"
STATUS_GENERATING = "generating"
STATUS_FAILED = "failed"
STATUS_READY = "ready"
STATUS_NEEDS_PROMPT = "needs_prompt"

#: 判定顺序（先"还没资料"，再"已经做完了"，最后才是"缺提示词"）
STATUS_ORDER: tuple[str, ...] = (
    STATUS_NEEDS_PROFILE,
    STATUS_PRIMARY,
    STATUS_HAS_IMAGE,
    STATUS_GENERATING,
    STATUS_FAILED,
    STATUS_READY,
    STATUS_NEEDS_PROMPT,
)

#: 分析状态（沿用 ``chapter_asset_profile_runs`` 的口径）
ANALYSIS_NOT_GENERATED = "not_generated"
ANALYSIS_GENERATED = "generated"
ANALYSIS_STALE = "stale"
ANALYSIS_RECORDS_ONLY = "records_only"

ANALYSIS_LABELS: dict[str, str] = {
    ANALYSIS_NOT_GENERATED: "本章尚未生成资产资料",
    ANALYSIS_GENERATED: "本章资产资料已生成",
    ANALYSIS_STALE: "内容已变化，建议重新分析",
    ANALYSIS_RECORDS_ONLY: "库里已有资料，但找不到生成记录",
}

#: 没有资产资料时的引导（**不出现接口名**，只说用户要点的按钮）
NOT_GENERATED_HINT = "本章还没有资产资料：点「分析本章资产」按本章剧本生成（需要一次文本模型调用）"

#: ``pending_review`` 的四类（前三个来自既有冲突码，第四类是本工作台特有的"服装待建"）
REVIEW_ALIAS_CONFLICT = "alias_conflict"
REVIEW_SAME_NAME_OTHER_TYPE = "same_name_other_type"
REVIEW_MULTIPLE_CANDIDATES = "multiple_candidates"
REVIEW_COSTUME_WITHOUT_ASSET = "costume_without_asset"

#: 既有冲突码 → 用户语言的 kind（``conflict_code`` 里保留原始码，信息不丢）
KIND_BY_CONFLICT_CODE: dict[str, str] = {
    CONFLICT_ALIAS_SPLIT: REVIEW_ALIAS_CONFLICT,
    CONFLICT_TYPE_MISMATCH: REVIEW_SAME_NAME_OTHER_TYPE,
    CONFLICT_DUPLICATE_NAME: REVIEW_SAME_NAME_OTHER_TYPE,
}

#: 在途 / 终态（与 ``app.models.task.GenerationTaskStatus`` 同名，读库时按字符串比较）
TASK_IN_FLIGHT: frozenset[str] = frozenset({"pending", "running", "streaming"})
TASK_FAILED = "failed"

#: 资产类型 → 出图任务关联类型（``GenerationTaskLink.relation_type`` 的既有取值）
TASK_RELATION_TYPE: dict[str, str] = {
    asset_type: f"{asset_type}_image" for asset_type in ASSET_TYPES
}


def _clip(text: Any, limit: int = 240) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else value[:limit].rstrip() + "…"


def _filled(values: Any) -> dict[str, str]:
    """只留非空字段（页面按它渲染"这项资产有什么资料"）。"""
    if not isinstance(values, dict):
        return {}
    return {
        str(key): str(value).strip()
        for key, value in values.items()
        if str(value or "").strip()
    }


def _has_material(values: Any) -> bool:
    """这段资料里有没有**能用的内容**（空值、空话、占位都不算）。"""
    for value in (values or {}).values():
        text = str(value or "").strip()
        if text and not is_vague_text(text):
            return True
    return False


def _entry_key(asset_type: str, asset_id: str, name: str) -> str:
    """合并键：有真实资产就按资产合并（同一资产绝不出现两次），否则按「类型 + 名称」。"""
    key = str(asset_id or "").strip()
    return f"{asset_type}:{key}" if key else f"{asset_type}:name:{normalize_name(name)}"


# ---------------------------------------------------------------------------
# 读库：资产行 / 图片 / 出图任务
# ---------------------------------------------------------------------------


async def _load_asset_rows(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_ids: list[str],
) -> dict[str, Any]:
    """按 id 取该类型的资产行（不按项目过滤：调用方已按本章口径收敛过 id）。"""
    if not asset_ids:
        return {}
    spec = entity_spec(asset_type)
    stmt = select(spec.model).where(spec.model.id.in_(sorted(set(asset_ids))))
    rows = (await db.execute(stmt)).scalars().all()
    return {str(row.id): row for row in rows}


async def _load_image_stats(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """图片与定版图（**只算有文件的图片行**：空槽位不算图、也不算定版）。"""
    if not asset_ids:
        return {}
    spec = entity_spec(asset_type)
    infos = await resolve_thumbnail_infos(
        db,
        image_model=spec.image_model,
        parent_field_name=spec.id_field,
        parent_ids=sorted(set(asset_ids)),
    )
    owner = getattr(spec.image_model, spec.id_field)
    rows = (
        (
            await db.execute(
                select(spec.image_model).where(
                    owner.in_(sorted(set(asset_ids))), spec.image_model.file_id.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "has_primary": False})
    for row in rows:
        if not str(row.file_id or "").strip():
            continue
        key = str(getattr(row, spec.id_field))
        stats[key]["count"] += 1
        if bool(row.is_primary):
            stats[key]["has_primary"] = True
    result: dict[str, dict[str, Any]] = {}
    for asset_id in sorted(set(asset_ids)):
        stat = stats.get(asset_id) or {"count": 0, "has_primary": False}
        info = infos.get(asset_id) or {}
        result[asset_id] = {
            "has_image": bool(stat["count"]),
            "has_primary": bool(stat["has_primary"]),
            "image_id": info.get("image_id"),
            "thumbnail": str(info.get("thumbnail") or ""),
            "image_count": int(stat["count"]),
        }
    return result


async def _load_task_stats(db: AsyncSession, *, asset_ids: list[str]) -> dict[str, dict[str, bool]]:
    """在途 / 最近一次失败的出图任务（沿用 ``generation_tasks`` + 关联表的既有口径）。"""
    wanted = sorted({str(x) for x in asset_ids if str(x).strip()})
    if not wanted:
        return {}
    rows = (
        await db.execute(
            select(
                GenerationTaskLink.relation_entity_id,
                GenerationTask.status,
                GenerationTask.updated_at,
            )
            .join(GenerationTask, GenerationTask.id == GenerationTaskLink.task_id)
            .where(
                GenerationTaskLink.resource_type == "image",
                GenerationTaskLink.relation_type.in_(sorted(TASK_RELATION_TYPE.values())),
                GenerationTaskLink.relation_entity_id.in_(wanted),
            )
        )
    ).all()
    stats: dict[str, dict[str, Any]] = {}
    for entity_id, raw_status, updated_at in rows:
        key = str(entity_id or "")
        value = str(getattr(raw_status, "value", raw_status) or "")
        stat = stats.setdefault(key, {"generating": False, "failed": False, "failed_at": None})
        if value in TASK_IN_FLIGHT:
            stat["generating"] = True
        elif value == TASK_FAILED:
            stamp = getattr(updated_at, "timestamp", None)
            current = stat["failed_at"]
            if not stat["failed"] or (callable(stamp) and (current is None or stamp() > current)):
                stat["failed"] = True
                stat["failed_at"] = stamp() if callable(stamp) else 0.0
    return {
        key: {"generating": bool(stat["generating"]), "failed": bool(stat["failed"])}
        for key, stat in stats.items()
    }


# ---------------------------------------------------------------------------
# 分析状态（沿用 chapter_asset_profile_runs 的口径，不另算）
# ---------------------------------------------------------------------------


async def _build_analysis_block(
    db: AsyncSession,
    *,
    chapter_id: str,
    cache_key: str,
) -> tuple[dict[str, Any], Any | None, list[Any], bool]:
    """返回 ``(analysis, run, records, analysis_generated)``。"""
    run = await get_latest_run(db, chapter_id=chapter_id)
    records = await list_chapter_records(db, chapter_id=chapter_id)
    content_changed = bool(run is not None and str(run.cache_key or "") != cache_key)

    if run is not None:
        stale = content_changed or str(run.status or "") == RUN_STATUS_STALE
        state = ANALYSIS_STALE if stale else ANALYSIS_GENERATED
    elif records:
        state = ANALYSIS_RECORDS_ONLY
    else:
        state = ANALYSIS_NOT_GENERATED

    generated = run is not None or bool(records)
    generated_at = (
        run.generated_at.isoformat() if run is not None and run.generated_at is not None else None
    )
    hint = ""
    if state == ANALYSIS_NOT_GENERATED:
        hint = NOT_GENERATED_HINT
    elif state == ANALYSIS_STALE:
        reason = str(getattr(run, "stale_reason", "") or "") if run is not None else ""
        hint = (
            "内容已变化，建议重新分析：本章原文或分镜与生成这份资料时不一致"
            + (f"（{reason}）" if reason else "")
            + "。现有资料与人工内容都已保留，未做任何覆盖。"
        )
    elif state == ANALYSIS_RECORDS_ONLY:
        hint = (
            "库里有资产资料行但没有生成记录（可能是从旧结构迁移过来的）："
            "可以直接用，也可以重新分析一遍。"
        )

    analysis = {
        "generated": bool(generated),
        "status": state,
        "status_label": (
            RUN_STATUS_TEXT.get(str(run.status), ANALYSIS_LABELS[state])
            if state in {ANALYSIS_GENERATED, ANALYSIS_STALE} and run is not None
            else ANALYSIS_LABELS[state]
        ),
        "content_changed": content_changed,
        "records_total": len(records),
        "generated_at": generated_at,
        "hint": hint,
    }
    return analysis, run, records, bool(generated)


# ---------------------------------------------------------------------------
# 候选侧：合并 / 匹配 / 冲突（与 confirm 的 auto_confirm_unconflicted 同一份口径）
# ---------------------------------------------------------------------------


async def _finalize_candidate_groups(
    db: AsyncSession,
    *,
    project_id: str,
    candidate_items: list[dict[str, Any]],
    shots: list[dict[str, Any]],
    records: list[Any] | None = None,
) -> list[dict[str, Any]]:
    """把本章候选聚合成"一行一个资产"的组，并打上匹配与冲突结论。

    这里刻意复用既有 ``_finalize_items``（生成路径与读库路径共用的那一份）：
    ``existing_asset_id`` / ``conflict`` / ``needs_review`` / ``auto_confirmable``
    与 ``POST .../asset-profiles/confirm`` 的 ``auto_confirm_unconfirmed`` 完全同源。

    ``records``（本章资料行）会并入同一批：**别名只能从资料行来**（分析产出的
    ``aliases``），"别名指向库里两个不同资产"这类冲突正是靠它才可能被发现；
    资料行自己没被候选覆盖到的，也单独成一组（它们同样要对账）。
    """
    seeds: list[dict[str, Any]] = []
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in candidate_items:
        name = str(item.get("name") or "")
        aliases = [str(alias) for alias in (item.get("aliases") or [])]
        refs = shot_refs_for_name(name, aliases, shots)
        row_total = sum(int(count) for count in (item.get("statuses") or {}).values())
        seed = {
            "group_key": f"{item.get('candidate_type')}:{normalize_name(name)}",
            "asset_type": str(item.get("candidate_type") or ""),
            "name": name,
            "aliases": aliases,
            "summary": "",
            "shot_refs": refs,
            "shot_count": max(len(refs), row_total),
            "linked_entity_id": item.get("linked_entity_id"),
            "statuses": dict(item.get("statuses") or {}),
            "candidate_total": row_total,
        }
        seeds.append(seed)
        by_key[(seed["asset_type"], normalize_name(name))] = seed

    for record in records or []:
        asset_type = str(record.asset_type or "")
        name = str(record.name or "")
        record_aliases = [str(alias) for alias in (record.aliases or [])]
        key = (asset_type, normalize_name(name))
        seed = by_key.get(key)
        if seed is None:
            refs = shot_refs_for_name(name, record_aliases, shots)
            seed = {
                "group_key": f"{asset_type}:{normalize_name(name)}",
                "asset_type": asset_type,
                "name": name,
                "aliases": record_aliases,
                "summary": "",
                "shot_refs": refs,
                "shot_count": len(refs),
                "linked_entity_id": record.asset_id,
                "statuses": {},
                "candidate_total": 0,
                "from_record_only": True,
            }
            seeds.append(seed)
            by_key[key] = seed
        else:
            seed["aliases"] = sorted({*seed.get("aliases", []), *record_aliases})
            if not seed.get("linked_entity_id") and record.asset_id:
                seed["linked_entity_id"] = record.asset_id
        # 资料行里的生效画像可以给冲突判定做"与库里描述有没有共同用词"的参考
        seed["summary"] = str(seed.get("summary") or "") or render_profile_text(
            asset_type, effective_profile(record)
        )

    if not seeds:
        return []
    return await _finalize_items(db, project_id=project_id, items=seeds)


def _linked_ids_of(seed: dict[str, Any]) -> set[str]:
    """该组候选里出现过的关联资产 id（>1 说明自动合并会选错，需要人工）。"""
    return {str(seed["linked_entity_id"])} if seed.get("linked_entity_id") else set()


def _build_pending_review(
    *,
    seeds: list[dict[str, Any]],
    name_keys_with_asset: set[tuple[str, str]],
) -> list[dict[str, Any]]:
    """需要人工 / 需要处理的事项（**只收真问题**：无冲突的不进这张表）。"""
    pending: list[dict[str, Any]] = []
    for seed in seeds:
        common = {
            "asset_type": str(seed.get("asset_type") or ""),
            "type_label": type_label(str(seed.get("asset_type") or "")),
            "name": str(seed.get("name") or ""),
            "candidate_count": int(seed.get("candidate_total") or 0),
            "group_key": str(seed.get("group_key") or ""),
        }
        for conflict in seed.get("conflicts") or []:
            code = str(conflict.get("code") or "")
            pending.append(
                {
                    **common,
                    "kind": KIND_BY_CONFLICT_CODE.get(code, REVIEW_SAME_NAME_OTHER_TYPE),
                    "reason": str(conflict.get("reason") or seed.get("action_reason") or ""),
                    "conflict_code": code,
                    "existing_asset_id": conflict.get("existing_asset_id"),
                    "existing_asset_ids": conflict.get("existing_asset_ids") or [],
                }
            )
        linked = _linked_ids_of(seed)
        if len(linked) > 1:
            pending.append(
                {
                    **common,
                    "kind": REVIEW_MULTIPLE_CANDIDATES,
                    "reason": (
                        "同一名称的候选分别关联了不同资产（"
                        + "、".join(sorted(linked))
                        + "）：自动合并会选错，需要人工决定用哪一个。"
                    ),
                    "conflict_code": REVIEW_MULTIPLE_CANDIDATES,
                    "existing_asset_ids": sorted(linked),
                }
            )
        # 服装候选：项目里还没有这件服装的资产 → 需要先处理（服装不出现在人物/场景/道具里）
        if (
            str(seed.get("asset_type") or "") == "costume"
            and not linked
            and (str(seed.get("asset_type") or ""), normalize_name(seed.get("name")))
            not in name_keys_with_asset
        ):
            pending.append(
                {
                    **common,
                    "kind": REVIEW_COSTUME_WITHOUT_ASSET,
                    "reason": (
                        f"本章候选里有服装「{seed.get('name')}」，但项目里还没有这件服装的资产："
                        "需要先建出服装资产，才能给它写提示词、出图。"
                    ),
                    "conflict_code": REVIEW_COSTUME_WITHOUT_ASSET,
                    "existing_asset_id": None,
                    "existing_asset_ids": [],
                }
            )
    return pending


# ---------------------------------------------------------------------------
# 组装
# ---------------------------------------------------------------------------


def summarize_workbench_items(
    items: list[dict[str, Any]], *, pending_review_total: int
) -> dict[str, Any]:
    """由 ``items`` 现算全部计数（**顶部统计与列表同源**，不允许两套算法）。"""
    by_type: dict[str, int] = {asset_type: 0 for asset_type in ASSET_TYPES}
    summary: dict[str, Any] = {
        "total": len(items),
        "by_type": by_type,
        "needs_profile": 0,
        "needs_prompt": 0,
        "prompt_ready": 0,
        "prompt_needs_regeneration": 0,
        "generating": 0,
        "failed": 0,
        "has_image": 0,
        "primary": 0,
        "pending_review": int(pending_review_total),
    }
    for item in items:
        asset_type = str(item.get("asset_type") or "")
        if asset_type in by_type:
            by_type[asset_type] += 1
        key = str((item.get("status") or {}).get("key") or "")
        if key == STATUS_NEEDS_PROFILE:
            summary["needs_profile"] += 1
        elif key == STATUS_NEEDS_PROMPT:
            summary["needs_prompt"] += 1
        elif key == STATUS_READY:
            summary["prompt_ready"] += 1
        elif key == STATUS_GENERATING:
            summary["generating"] += 1
        elif key == STATUS_FAILED:
            summary["failed"] += 1
        image = item.get("image") or {}
        if image.get("has_image"):
            summary["has_image"] += 1
        if image.get("has_primary"):
            summary["primary"] += 1
        if (item.get("prompt") or {}).get("quality", {}).get("needs_regeneration"):
            summary["prompt_needs_regeneration"] += 1
    return summary


def _decide_status(
    *,
    has_profile: bool,
    analysis_generated: bool,
    image: dict[str, Any],
    task: dict[str, bool],
    quality: dict[str, Any],
    has_prompt_text: bool,
) -> dict[str, str]:
    """用户语言的状态机（顺序见 :data:`STATUS_ORDER`）。"""
    if not analysis_generated:
        # 本章一行资料都没有：这一页**不许**出现"可以生成图片"的假象，
        # 所有资产一律先说清"先分析本章资产"（提示词文本也不展示，见调用处）。
        return {
            "key": STATUS_NEEDS_PROFILE,
            "label": "待补资料",
            "reason": (
                "本章还没有分析资产资料：先点「分析本章资产」按本章剧本生成资料，"
                "或者直接人工补充这项资产的资料。"
            ),
        }
    if not has_profile:
        return {
            "key": STATUS_NEEDS_PROFILE,
            "label": "待补资料",
            "reason": "这项资产还没有结构化资料（身份 / 外貌 / 材质这类）：先补资料，再写提示词。",
        }
    if image.get("has_primary"):
        return {"key": STATUS_PRIMARY, "label": "已定版", "reason": "已有定版图，可以直接进入后续步骤。"}
    if image.get("has_image"):
        return {
            "key": STATUS_HAS_IMAGE,
            "label": "已有图片（未定版）",
            "reason": "已经有图片但还没有定版图：先去定版，或者重新出图。",
        }
    if task.get("generating"):
        return {"key": STATUS_GENERATING, "label": "正在生成", "reason": "这项资产的出图任务正在生成，等它跑完。"}
    if task.get("failed"):
        return {
            "key": STATUS_FAILED,
            "label": "上次生成失败",
            "reason": "上一次生成没有成功，需要重新出图（可以在技术详情里核对）。",
        }
    if has_prompt_text and quality.get("verdict") == VERDICT_OK:
        return {"key": STATUS_READY, "label": "可以生成图片", "reason": "已有可用的图片提示词，可以进入批量出图。"}
    if quality.get("needs_regeneration"):
        reasons = "；".join(str(reason) for reason in (quality.get("reasons") or [])[:2])
        return {
            "key": STATUS_NEEDS_PROMPT,
            "label": "提示词需重新生成",
            "reason": f"已保存的提示词不能直接出图：{reasons}",
        }
    return {
        "key": STATUS_NEEDS_PROMPT,
        "label": "待写提示词",
        "reason": "还没有可用的图片提示词：生成或手工填写后再出图。",
    }


def _normalize_shot_refs(
    raw: Any,
    *,
    title_by_index: dict[int, str],
) -> list[dict[str, Any]]:
    """出场镜头依据（统一成页面要的四个字段，缺标题时用本章分镜补齐）。"""
    refs: list[dict[str, Any]] = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        index = int(entry.get("shot_index") or 0)
        refs.append(
            {
                "shot_id": str(entry.get("shot_id") or ""),
                "shot_index": index,
                "title": str(entry.get("title") or title_by_index.get(index, "")),
                "script_excerpt": _clip(entry.get("script_excerpt"), 240),
            }
        )
    refs.sort(key=lambda ref: (int(ref["shot_index"]), str(ref["shot_id"])))
    return refs


def _evidence_from_refs(
    refs: list[dict[str, Any]],
    *,
    chapter_haystack: str,
) -> list[dict[str, Any]]:
    """由出场镜头的原文摘录给出「依据」（片段逐字来自分镜原文；能在本章原文里找到才算 grounded）。"""
    evidence: list[dict[str, Any]] = []
    for ref in refs:
        text = str(ref.get("script_excerpt") or "").strip()
        if not text:
            continue
        key = normalize_name(text)
        grounded = bool(key[:20] in chapter_haystack) if len(key) >= 6 else True
        evidence.append(
            {"snippet": text, "grounded": grounded, "shot_index": ref.get("shot_index")}
        )
    return evidence


def _evidence_from_record(raw: Any) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        snippet = str(entry.get("snippet") or "").strip()
        if not snippet:
            continue
        evidence.append({"snippet": _clip(snippet), "grounded": bool(entry.get("grounded"))})
    return evidence


def _prompt_slots(asset_type: str) -> tuple[str, str]:
    """该资产类型的**主槽位**与中文标签（槽位口径来自既有分流表与注册表）。"""
    category = SLOT_BY_ASSET_TYPE.get(asset_type)
    slot = str(getattr(category, "value", category) or "")
    spec = IMAGE_PROMPT_SLOT_BY_CATEGORY.get(slot)
    return slot, str(getattr(spec, "label", "") or slot)


def _display_slot(asset_type: str, saved: dict[str, str]) -> str:
    """页面展示哪一格：主槽位优先，其次该类型的另一个槽位（有内容才展示）。"""
    primary, _label = _prompt_slots(asset_type)
    if saved.get(primary):
        return primary
    for category in ASSET_IMAGE_PROMPT_SLOTS.get(asset_type, ()):
        candidate = str(getattr(category, "value", category) or "")
        if saved.get(candidate):
            return candidate
    return primary


def _slot_label(slot: str) -> str:
    spec = IMAGE_PROMPT_SLOT_BY_CATEGORY.get(slot)
    return str(getattr(spec, "label", "") or slot)


async def build_chapter_asset_workbench(db: AsyncSession, *, chapter_id: str) -> dict[str, Any]:
    """资产生产工作台：**只读**一份数据，供人物/场景/道具/服装四个页签渲染。

    响应形状见模块 docstring；``summary`` 的每个计数都由 ``items`` 现算（同源一致）。
    """
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter")
        )

    source = await load_chapter_source(db, chapter_id)
    shots = await _load_shots(db, chapter_id=chapter_id)
    cache_key = build_chapter_profile_cache_key(
        project_id=source.project_id,
        chapter_id=chapter_id,
        chapter_text=source.text,
        shots=shots,
        extra_instructions="",
    )
    chapter_haystack = normalize_name(source.text)
    title_by_index = {int(shot.get("index") or 0): str(shot.get("title") or "") for shot in shots}

    analysis, _run, records, analysis_generated = await _build_analysis_block(
        db, chapter_id=chapter_id, cache_key=cache_key
    )

    candidates = await build_chapter_asset_candidates(db, chapter_id=chapter_id)
    candidate_items = [item for item in (candidates.get("items") or []) if isinstance(item, dict)]
    seeds = await _finalize_candidate_groups(
        db,
        project_id=str(source.project_id),
        candidate_items=candidate_items,
        shots=shots,
        records=records,
    )
    seeds_by_name: dict[tuple[str, str], dict[str, Any]] = {
        (str(seed.get("asset_type") or ""), normalize_name(seed.get("name"))): seed
        for seed in seeds
    }

    # ---- 合并三处来源：本章资料行 / 本章候选 / 库里同名资产（同一资产只留一行）----
    entries: dict[str, dict[str, Any]] = {}

    def _ensure(asset_type: str, asset_id: str, name: str, aliases: list[str]) -> dict[str, Any]:
        key = _entry_key(asset_type, asset_id, name)
        entry = entries.get(key)
        if entry is None:
            entry = {
                "key": key,
                "asset_type": asset_type,
                "asset_id": str(asset_id or ""),
                "name": name,
                "aliases": set(),
                "record": None,
                "seed": None,
                "shot_refs": [],
                "evidence": [],
                "record_shot_refs": [],
                "record_evidence": [],
            }
            entries[key] = entry
        if name:
            entry["name"] = entry["name"] or name
        entry["aliases"].update(alias for alias in aliases if alias and alias != entry["name"])
        return entry

    # ① 候选组：linked_entity_id 是"本章确实用了哪个资产"，existing_asset_id 是"库里同名同类型资产"
    for seed in seeds:
        name_key = (str(seed.get("asset_type") or ""), normalize_name(seed.get("name")))
        asset_id = str(seed.get("linked_entity_id") or seed.get("existing_asset_id") or "")
        entry = _ensure(
            name_key[0],
            asset_id,
            str(seed.get("name") or ""),
            [str(alias) for alias in seed.get("aliases") or []],
        )
        entry["seed"] = seed
        entry["shot_refs"] = list(seed.get("shot_refs") or [])

    # ② 本章资料行：有 asset_id 的按资产合并；没有的按名称与候选组对齐
    for record in records:
        asset_type = str(record.asset_type or "")
        seed = seeds_by_name.get((asset_type, normalize_name(record.name)))
        asset_id = str(record.asset_id or (seed.get("linked_entity_id") if seed else "") or "")
        entry = _ensure(
            asset_type,
            asset_id,
            str(record.name or ""),
            [str(alias) for alias in (record.aliases or [])],
        )
        entry["record"] = record
        entry["record_shot_refs"] = [
            ref for ref in (record.shot_refs or []) if isinstance(ref, dict)
        ]
        entry["record_evidence"] = [
            item for item in (record.evidence or []) if isinstance(item, dict)
        ]
        if not entry["shot_refs"]:
            entry["shot_refs"] = list(entry["record_shot_refs"])

    # **一项资产只出现一次**：真资产一行（本章候选 / 资料行合并而来）；
    # 只有资料行、还没建出真实资产的也算一行（它有资料、有下一步），
    # 但"光有候选、既没资产也没资料"的组不进列表 —— 它们是待确认的候选，
    # 由顶部批量操作按 auto_confirm_unconflicted 一次处理（需要人工的见 pending_review）。
    entries = {
        key: entry
        for key, entry in entries.items()
        if entry["name"] and (entry["asset_id"] or entry["record"] is not None)
    }

    # ---- 批量取资产行 / 图片 / 任务 ----
    ids_by_type: dict[str, list[str]] = {asset_type: [] for asset_type in ASSET_TYPES}
    for entry in entries.values():
        if entry["asset_id"]:
            ids_by_type.setdefault(entry["asset_type"], []).append(entry["asset_id"])
    asset_rows: dict[str, Any] = {}
    image_stats: dict[str, dict[str, Any]] = {}
    for asset_type, ids in ids_by_type.items():
        asset_rows.update(await _load_asset_rows(db, asset_type=asset_type, asset_ids=ids))
        image_stats.update(await _load_image_stats(db, asset_type=asset_type, asset_ids=ids))
    task_stats = await _load_task_stats(db, asset_ids=list(asset_rows))

    # ---- 提示词质量：**一次**跨资产重判（含"旧数据要重新生成"与跨资产重复）----
    audit_entries: list[dict[str, Any]] = []
    for entry in entries.values():
        asset = asset_rows.get(entry["asset_id"]) if entry["asset_id"] else None
        audit_entries.append(
            {
                "asset_key": entry["key"],
                "asset_name": entry["name"],
                "asset_type": entry["asset_type"],
                "prompts": dict(getattr(asset, "image_prompts", None) or {}) if asset else {},
            }
        )
    audits = audit_saved_prompts(audit_entries)

    hidden_prompt_total = 0
    items: list[dict[str, Any]] = []
    for entry in entries.values():
        asset_type = entry["asset_type"]
        asset = asset_rows.get(entry["asset_id"]) if entry["asset_id"] else None
        record = entry["record"]
        record_fields = effective_profile(record) if record is not None else {}
        description = str(getattr(asset, "description", "") or "") if asset is not None else ""
        described_fields = normalize_profile(asset_type, description) if description.strip() else {}
        manual_overrides = dict(record.manual_overrides or {}) if record is not None else {}
        user_notes = [str(note) for note in (record.user_notes or [])] if record is not None else []

        if record is not None and (_has_material(record_fields) or manual_overrides or user_notes):
            fields, profile_source = record_fields, "chapter_record"
        elif _has_material(described_fields):
            fields, profile_source = described_fields, "asset_description"
        else:
            fields, profile_source = {}, "none"
        has_profile = profile_source != "none"

        primary_slot, _primary_label = _prompt_slots(asset_type)
        saved = (
            saved_prompt_texts(getattr(asset, "image_prompts", None)) if asset is not None else {}
        )
        audit = audits.get(entry["key"]) or {
            "verdict": VERDICT_BLOCKED,
            "reasons": ["还没有保存这项资产的图片提示词，不能直接出图。"],
            "needs_regeneration": False,
            "saved_slots": [],
        }
        saved_slots = [str(slot) for slot in (audit.get("saved_slots") or [])]
        if not analysis_generated and record is None:
            # 本章资料一行都没有：**不展示旧提示词文本**（否则页面会一边说"可以先分析本章资产"、
            # 一边把库里那条老提示词摆出来，自相矛盾）；但质量重判照旧如实给出 ——
            # 老提示词该重新生成就要标出来，只是不把它当成"可出图的文本"。
            if saved:
                hidden_prompt_total += 1
            display_slot, text = primary_slot, ""
            analysis_reason = (
                "本章还没有分析资产资料：先点「分析本章资产」，再看这项资产的图片提示词。"
            )
            old_prompt_reasons = (
                [str(reason) for reason in (audit.get("reasons") or [])]
                if audit.get("needs_regeneration")
                else []
            )
            quality = {
                "verdict": (
                    VERDICT_NEEDS_REGENERATION
                    if audit.get("needs_regeneration")
                    else VERDICT_BLOCKED
                ),
                "reasons": [analysis_reason, *old_prompt_reasons],
                "needs_regeneration": bool(audit.get("needs_regeneration")),
            }
        else:
            display_slot = _display_slot(asset_type, saved)
            text = str(saved.get(display_slot) or "")
            quality = {
                "verdict": str(audit.get("verdict") or VERDICT_OK),
                "reasons": [str(reason) for reason in (audit.get("reasons") or [])],
                "needs_regeneration": bool(audit.get("needs_regeneration")),
            }

        quality["label"] = VERDICT_LABELS.get(str(quality["verdict"]), str(quality["verdict"]))
        image = image_stats.get(entry["asset_id"]) or {
            "has_image": False,
            "has_primary": False,
            "image_id": None,
            "thumbnail": "",
            "image_count": 0,
        }
        task = task_stats.get(entry["asset_id"]) or {"generating": False, "failed": False}
        decision = _decide_status(
            has_profile=has_profile,
            analysis_generated=analysis_generated,
            image=image,
            task=task,
            quality=quality,
            has_prompt_text=bool(text),
        )
        shot_refs = _normalize_shot_refs(
            entry["record_shot_refs"] or entry["shot_refs"], title_by_index=title_by_index
        )
        evidence = (
            _evidence_from_record(entry["record_evidence"])
            if entry["record_evidence"]
            else _evidence_from_refs(shot_refs, chapter_haystack=chapter_haystack)
        )
        plot_identity = (
            plot_identity_of(record)
            if record is not None
            else plot_identity_for_fields(asset_type, fields)
        )
        items.append(
            {
                "asset_type": asset_type,
                "type_label": type_label(asset_type),
                "asset_id": entry["asset_id"],
                "group_key": f"{asset_type}:{normalize_name(entry['name'])}",
                "name": entry["name"],
                "aliases": sorted(entry["aliases"] - {entry["name"]}),
                "asset_exists": bool(entry["asset_id"]),
                "profile_source": profile_source,
                "profile_digest": render_profile_text(asset_type, _filled(fields)),
                "profile_fields": _filled(fields),
                "missing_fields": profile_missing_fields(asset_type, fields),
                "manual_overrides": {
                    str(key): str(value)
                    for key, value in manual_overrides.items()
                    if str(value or "").strip()
                },
                "user_notes": user_notes,
                "record_id": (int(record.id) if record is not None else None),
                "record_status": (str(record.status or "") if record is not None else ""),
                "script_relation": {
                    "plot_identity": plot_identity,
                    "shot_refs": shot_refs,
                    "evidence": evidence,
                },
                "prompt": {
                    "slot": display_slot,
                    "slot_label": _slot_label(display_slot),
                    "text": text,
                    "saved": bool(text),
                    "saved_slots": saved_slots,
                    "quality": quality,
                },
                "image": image,
                "status": decision,
                "batch_eligible": bool(
                    decision["key"] in {STATUS_READY, STATUS_HAS_IMAGE, STATUS_PRIMARY}
                    and quality["verdict"] == VERDICT_OK
                    and text
                ),
            }
        )

    items.sort(
        key=lambda item: (
            (
                ASSET_TYPES.index(item["asset_type"])
                if item["asset_type"] in ASSET_TYPES
                else len(ASSET_TYPES)
            ),
            -len(item["script_relation"]["shot_refs"]),
            item["name"],
        )
    )

    name_keys_with_asset: set[tuple[str, str]] = set()
    for entry in entries.values():
        if entry["asset_id"]:
            name_keys_with_asset.add((entry["asset_type"], normalize_name(entry["name"])))
    pending_review = _build_pending_review(seeds=seeds, name_keys_with_asset=name_keys_with_asset)

    # ---- 技术详情（后台维度，前端默认收起）----
    candidates_by_type_status: dict[str, dict[str, int]] = {
        asset_type: {} for asset_type in ASSET_TYPES
    }
    candidates_total = 0
    for item in candidate_items:
        asset_type = str(item.get("candidate_type") or "")
        bucket = candidates_by_type_status.setdefault(asset_type, {})
        for raw_status, count in (item.get("statuses") or {}).items():
            bucket[str(raw_status)] = bucket.get(str(raw_status), 0) + int(count)
            candidates_total += int(count)
    notes = [
        "本页数据来自数据库：本章候选（shot_extracted_candidates）、本章资产资料"
        "（chapter_asset_profiles）、资产库（characters / scenes / props / costumes）"
        "与图片表；只读装配，没有调用任何模型。",
        "本章候选按「类型 + 名称」自动合并、并按库里的同名同类型资产自动匹配"
        "（与「确认」按钮的 auto_confirm_unconflicted 同一份判定），"
        "只有 pending_review 里的冲突/待建项才需要人工。",
    ]
    dangling = [
        seed
        for seed in seeds
        if not seed.get("linked_entity_id") and not seed.get("existing_asset_id")
    ]
    if dangling:
        notes.append(
            f"另有 {len(dangling)} 组候选还没有对应的真实资产（见 candidate_groups_without_asset 与"
            " match_diagnostics）：它们不进资产列表，由顶部批量操作一次确认建资产；"
            "无冲突的不需要逐条点。"
        )
    if hidden_prompt_total:
        notes.append(
            f"有 {hidden_prompt_total} 项资产在资产库里其实存有旧提示词，但本章还没有分析资料："
            "本页不展示它们的文本（避免页面自相矛盾）；先点「分析本章资产」，再逐项重判/重新生成。"
        )
    notes.append(
        "旧的已保存提示词会被**重新做质量判定**（空话 / 只有资产名+通用摄影词 / 两个资产高度重复）："
        "命中的会标成「需要重新生成」并被批量出图排除，但不会自动删改你保存过的内容。"
    )

    technical = {
        "candidates_total": candidates_total,
        "candidates_by_type_status": {
            key: value for key, value in candidates_by_type_status.items() if value
        },
        "candidate_groups": len(candidate_items),
        "candidate_groups_without_asset": len(dangling),
        "match_diagnostics": [
            {
                "name": str(seed.get("name") or ""),
                "asset_type": str(seed.get("asset_type") or ""),
                "matched_asset_id": seed.get("existing_asset_id"),
                "linked_entity_id": seed.get("linked_entity_id"),
                "candidate_count": int(seed.get("candidate_total") or 0),
                "auto_confirmable": bool(seed.get("auto_confirmable")),
                "needs_review": bool(seed.get("needs_review")),
                "reason": str(seed.get("action_reason") or ""),
            }
            for seed in seeds
        ],
        "hidden_library_prompts": hidden_prompt_total,
        "analysis_cache_key": cache_key,
        "source_hash": str(getattr(_run, "source_hash", "") or ""),
        "records_total": len(records),
        "notes": notes,
    }

    return {
        "chapter_id": chapter_id,
        "project_id": str(source.project_id),
        "chapter_title": str(source.title or ""),
        "script_chars": len(source.text),
        "analysis": analysis,
        "summary": summarize_workbench_items(items, pending_review_total=len(pending_review)),
        "items": items,
        "pending_review": pending_review,
        "technical": technical,
    }


__all__ = [
    "ANALYSIS_GENERATED",
    "ANALYSIS_LABELS",
    "ANALYSIS_NOT_GENERATED",
    "ANALYSIS_RECORDS_ONLY",
    "ANALYSIS_STALE",
    "NOT_GENERATED_HINT",
    "REVIEW_ALIAS_CONFLICT",
    "REVIEW_COSTUME_WITHOUT_ASSET",
    "REVIEW_MULTIPLE_CANDIDATES",
    "REVIEW_SAME_NAME_OTHER_TYPE",
    "STATUS_FAILED",
    "STATUS_GENERATING",
    "STATUS_HAS_IMAGE",
    "STATUS_NEEDS_PROFILE",
    "STATUS_NEEDS_PROMPT",
    "STATUS_ORDER",
    "STATUS_PRIMARY",
    "STATUS_READY",
    "build_chapter_asset_workbench",
    "summarize_workbench_items",
]
