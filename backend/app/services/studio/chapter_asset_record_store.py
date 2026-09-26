"""章节资产资料的**持久化读写**：数据库是事实来源，进程内缓存只是性能优化。

这一层提供四类动作（其余模块只通过它读写这两张表）：

1. **写入一次分析结果**（:func:`save_analysis_result`）——
   逐条与库里的行对账：新资产插入；未确认且未人工改过的行**更新**；
   **已确认或人工改过的行一律不动**，把新结果落到 ``pending_*`` 并标
   ``pending_change``，等用户决定 覆盖 / 合并 / 保留（用户明确要求的行为）；
   这次分析没再提到的行**不删除**，只标 ``missing_in_latest``。
2. **读回**（:func:`list_chapter_records` / :func:`load_chapter_record_map`）——
   后端重启后直接读，不需要再问模型；章节隔离由 ``chapter_id`` 落地。
3. **人工编辑**（:func:`apply_manual_edit`）——人工改的字段进 ``manual_overrides``，
   用户补充进 ``user_notes``；两者都不会被后续模型结果覆盖。
4. **变更决议**（:func:`resolve_pending_changes`）——覆盖 / 合并 / 保留。

作者口径（与用户边界一致）
==========================

- 本模块**只碰这两张新表**：不写全局资产（场景/道具/服装）的任何列，
  不写 ``image_prompts``、不写图片行、不碰定版图；
- 全局资产的通用资料更新仍然只能走 ``global_asset_updates`` 的差异预览 + 显式确认；
- 记录里不存任何密钥、不存绝对路径。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import ChapterAssetProfile, ChapterAssetProfileRun
from app.models.studio_asset_profiles import (
    RUN_STATUS_GENERATED,
    RUN_STATUS_STALE,
    STATUS_CONFIRMED,
    STATUS_GENERATED,
    STATUS_MISSING_IN_LATEST,
    STATUS_PENDING_CHANGE,
    STATUS_LABELS,
)
from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache
from app.services.studio.asset_profiles import (
    ASSET_TYPES,
    field_label,
    normalize_asset_type,
    normalize_profile,
    profile_completeness,
    profile_missing_fields,
    render_profile_text,
    type_label,
)
from app.services.studio.llm_orchestration.json_utils import normalize_name

#: 记录状态 → 页面用的中文
STATUS_TEXT = STATUS_LABELS

#: 生成状态 → 页面用的中文
RUN_STATUS_TEXT: dict[str, str] = {
    RUN_STATUS_GENERATED: "已生成（与当前剧本一致）",
    RUN_STATUS_STALE: "内容已变化，建议重新分析",
}

#: 变更决议的合法动作
RESOLVE_OVERWRITE = "overwrite"
RESOLVE_MERGE = "merge"
RESOLVE_KEEP = "keep"
VALID_RESOLVE_ACTIONS: tuple[str, ...] = (RESOLVE_OVERWRITE, RESOLVE_MERGE, RESOLVE_KEEP)

RESOLVE_LABELS: dict[str, str] = {
    RESOLVE_OVERWRITE: "覆盖：用新分析结果替换模型侧资料（人工修改与补充保留）",
    RESOLVE_MERGE: "合并：以现有资料为准，只补上还没有的字段与依据",
    RESOLVE_KEEP: "保留：丢弃本次新结果，现有资料一个字都不动",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_map(raw: Any) -> dict[str, str]:
    """把任意来源的字段映射归一成"非空字符串字典"。"""
    if not isinstance(raw, dict):
        return {}
    return {str(key): str(value).strip() for key, value in raw.items() if str(value or "").strip()}


def _as_list(raw: Any) -> list[Any]:
    return list(raw) if isinstance(raw, list) else []


# ---------------------------------------------------------------------------
# 读
# ---------------------------------------------------------------------------


def effective_profile(record: ChapterAssetProfile) -> dict[str, str]:
    """最终生效画像 = 模型资料 ⊕ 人工修改（人工优先）。"""
    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    merged = {
        **_strip_map(record.profile),
        **_strip_map(record.manual_overrides),
    }
    return normalize_profile(asset_type, merged)


def plot_identity_of(record: ChapterAssetProfile) -> str:
    """本章剧情身份（按**生效画像**现算，人工改了字段立刻反映）。"""
    from app.services.studio.asset_overlays import plot_identity_for_fields

    return plot_identity_for_fields(str(record.asset_type or ""), effective_profile(record))


def temporary_notes_of(record: ChapterAssetProfile) -> list[str]:
    """本章特有的临时补充（按生效画像现算，口径与 overlay 完全一致）。"""
    from app.services.studio.asset_overlays import temporary_notes_for_fields

    return temporary_notes_for_fields(str(record.asset_type or ""), effective_profile(record))


def evidence_scope_of(record: ChapterAssetProfile) -> str:
    """出场依据的级别：``shot`` = 有具体镜头摘录；``chapter_only`` = 只在本章原文出现。

    ``chapter_only`` 时 ``shot_refs`` 为空 —— **不伪造**出场依据（沿用改造前的口径）。
    """
    from app.services.studio.asset_overlays import EVIDENCE_SCOPE_CHAPTER_ONLY, EVIDENCE_SCOPE_SHOT

    return EVIDENCE_SCOPE_SHOT if _as_list(record.shot_refs) else EVIDENCE_SCOPE_CHAPTER_ONLY


def profile_source_label(record: ChapterAssetProfile) -> str:
    """这份生效画像里有没有人工参与（页面与图片提示词依据都要如实说）。"""
    model_part = bool(_strip_map(record.profile))
    manual_part = bool(_strip_map(record.manual_overrides))
    if model_part and manual_part:
        return "model+manual"
    if manual_part:
        return "manual"
    return "model"


def has_pending_change(record: ChapterAssetProfile) -> bool:
    return record.status == STATUS_PENDING_CHANGE and bool(_strip_map(record.pending_profile))


def group_key(record: ChapterAssetProfile) -> str:
    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    return f"{asset_type}:{record.name_key or normalize_name(record.name)}"


def record_evidence_text(record: ChapterAssetProfile) -> str:
    """渲染成"给图片提示词用"的一段资料（含本章特有字段与剧情向字段）。"""
    asset_type = normalize_asset_type(record.asset_type) or ""
    return render_profile_text(asset_type, effective_profile(record), include_evidence_fields=True)


def record_to_read(record: ChapterAssetProfile, *, include_pending: bool = True) -> dict[str, Any]:
    """对外的只读形态（脱敏：不含密钥、不含本机路径）。"""
    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    fields = effective_profile(record)
    shot_refs = _as_list(record.shot_refs)
    data: dict[str, Any] = {
        "id": int(record.id),
        "project_id": str(record.project_id),
        "chapter_id": str(record.chapter_id),
        "asset_type": asset_type,
        "type_label": type_label(asset_type),
        "name": str(record.name or ""),
        "name_key": str(record.name_key or ""),
        "group_key": group_key(record),
        "aliases": [str(alias) for alias in _as_list(record.aliases)],
        "fields": fields,
        "profile_text": record_evidence_text(record),
        "manual_overrides": _strip_map(record.manual_overrides),
        "user_notes": [str(note) for note in _as_list(record.user_notes)],
        "profile_source": profile_source_label(record),
        "plot_identity": plot_identity_of(record),
        "temporary_notes": temporary_notes_of(record),
        "shot_refs": shot_refs,
        "evidence": _as_list(record.evidence),
        "evidence_scope": evidence_scope_of(record),
        "asset_id": record.asset_id,
        "link_action": str(record.link_action or ""),
        "status": str(record.status or ""),
        "status_label": STATUS_TEXT.get(str(record.status or ""), str(record.status or "")),
        "source_hash": str(record.source_hash or ""),
        "source_summary": dict(record.source_summary or {}),
        "missing_fields": profile_missing_fields(asset_type, fields),
        "missing_visual_fields": profile_missing_fields(asset_type, fields, visual_only=True),
        "completeness": profile_completeness(asset_type, fields),
        "generated_at": _iso(record.generated_at),
        "confirmed_at": _iso(record.confirmed_at),
        "manual_edited_at": _iso(record.manual_edited_at),
        "updated_at": _iso(_loaded_updated_at(record)),
    }
    if include_pending:
        data["has_pending_change"] = has_pending_change(record)
        data["pending"] = (
            {
                "fields": _strip_map(record.pending_profile),
                "aliases": [str(alias) for alias in _as_list(record.pending_aliases)],
                "shot_refs": _as_list(record.pending_shot_refs),
                "evidence": _as_list(record.pending_evidence),
                "source_hash": str(record.pending_source_hash or ""),
                "at": _iso(record.pending_at),
                "diff": profile_diff(
                    current=effective_profile(record),
                    incoming=record.pending_profile,
                    asset_type=normalize_asset_type(record.asset_type) or "",
                ),
            }
            if has_pending_change(record)
            else None
        )
    return data


def record_to_overlay(record: ChapterAssetProfile) -> dict[str, Any]:
    """章节隔离层（overlay）视图：与改造前 ``load_chapter_overlays`` 的输出形状保持一致。

    改造前 overlay 挂在候选行 ``payload.chapter_overlay`` 上；现在它由**专用表**承载，
    这个函数保证老读者的字段名和语义不变（``scope=chapter`` /
    ``global_asset`` / 出场依据 / 临时补充 / 剧情身份）。
    """
    from app.services.studio.asset_overlays import is_global_asset

    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    return {
        "chapter_id": str(record.chapter_id),
        "project_id": str(record.project_id),
        "asset_type": asset_type,
        "type_label": type_label(asset_type),
        "name": str(record.name or ""),
        "aliases": [str(alias) for alias in _as_list(record.aliases)],
        "asset_id": record.asset_id,
        "global_asset": is_global_asset(asset_type),
        "scope": "chapter",
        "plot_identity": plot_identity_of(record),
        "chapter_fields": effective_profile(record),
        "temporary_notes": temporary_notes_of(record),
        "shot_refs": _as_list(record.shot_refs),
        "evidence": _as_list(record.evidence),
        "evidence_scope": evidence_scope_of(record),
        "source_kind": "chapter_record",
        "overlay_source": "chapter_asset_profiles",
        "record_id": int(record.id),
        "status": str(record.status or ""),
    }


def _loaded_updated_at(record: ChapterAssetProfile) -> Any:
    """``updated_at`` 的"已加载才读"版本。

    为什么需要：``updated_at`` 带 ``onupdate=func.now()``，一次 UPDATE 之后该属性可能被标记为
    过期；如果在**同步**函数里访问它，SQLAlchemy 会尝试发一次 IO，
    在 async 会话里就直接抛 ``MissingGreenlet``。这里先看 state，没加载就如实返回 None
    （响应里少一个时间戳，好过接口 500）。
    """
    try:
        from sqlalchemy import inspect as sa_inspect

        state = sa_inspect(record)
        if "updated_at" in state.unloaded:
            return None
    except Exception:  # noqa: BLE001 - 只为"不炸"，取不到就当作没有
        return None
    return getattr(record, "updated_at", None)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def profile_diff(*, current: Any, incoming: Any, asset_type: str = "") -> dict[str, Any]:
    """字段级差异（给"内容已变化"的界面用）：新增 / 改动 / 消失。

    值的比较按**去空**后的字符串，避免"空字符串 vs 缺失"这种噪声被当成变化。
    ``asset_type`` 给了就用该类型的字段标签，没给就把字段名原样给出。
    """

    def _label(key: str) -> str:
        return field_label(asset_type, key) if asset_type else key

    before = _strip_map(current)
    after = _strip_map(incoming)
    added: list[dict[str, str]] = []
    changed: list[dict[str, str]] = []
    removed: list[dict[str, str]] = []
    for key, value in after.items():
        if key not in before:
            added.append({"key": key, "label": _label(key), "after": value})
        elif before[key] != value:
            changed.append({"key": key, "label": _label(key), "before": before[key], "after": value})
    for key, value in before.items():
        if key not in after:
            removed.append({"key": key, "label": _label(key), "before": value})
    return {
        "added": added,
        "changed": changed,
        "removed": removed,
        "changed_any": bool(added or changed or removed),
        "changed_labels": [item["label"] for item in [*added, *changed, *removed]],
    }


async def get_latest_run(db: AsyncSession, *, chapter_id: str) -> ChapterAssetProfileRun | None:
    """本章最近一次分析记录（按 id 倒序，最新的那份）。"""
    stmt = (
        select(ChapterAssetProfileRun)
        .where(ChapterAssetProfileRun.chapter_id == chapter_id)
        .order_by(ChapterAssetProfileRun.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def list_chapter_records(
    db: AsyncSession,
    *,
    chapter_id: str,
    include_missing_in_latest: bool = True,
) -> list[ChapterAssetProfile]:
    """本章全部资产资料行（**只按章节隔离读**，与进程状态无关）。"""
    stmt = (
        select(ChapterAssetProfile)
        .where(ChapterAssetProfile.chapter_id == chapter_id)
        .order_by(ChapterAssetProfile.id)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if include_missing_in_latest:
        return list(rows)
    return [row for row in rows if str(row.status or "") != STATUS_MISSING_IN_LATEST]


async def list_records_for_scope(
    db: AsyncSession,
    *,
    project_id: str | None = None,
    chapter_id: str | None = None,
) -> list[ChapterAssetProfile]:
    """按**范围**读资料行：给了 ``chapter_id`` 就收窄到本章，否则按项目读。

    存在的理由：图片提示词的资产画像既支持"按本章读"（章节隔离），
    也支持"按整个项目读"（既有行为）；两种读法都必须落在同一张事实表上。
    """
    stmt = select(ChapterAssetProfile)
    if chapter_id:
        stmt = stmt.where(ChapterAssetProfile.chapter_id == chapter_id)
    if project_id:
        stmt = stmt.where(ChapterAssetProfile.project_id == project_id)
    return list((await db.execute(stmt.order_by(ChapterAssetProfile.id))).scalars().all())


async def get_chapter_record(
    db: AsyncSession,
    *,
    chapter_id: str,
    asset_type: str,
    name: str,
) -> ChapterAssetProfile | None:
    key = normalize_name(name)
    stmt = select(ChapterAssetProfile).where(
        ChapterAssetProfile.chapter_id == chapter_id,
        ChapterAssetProfile.asset_type == asset_type,
        ChapterAssetProfile.name_key == key,
    )
    return (await db.execute(stmt)).scalars().first()


async def load_chapter_record_map(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> dict[tuple[str, str], ChapterAssetProfile]:
    """``{(资产类型, 归一化名称): 记录}``（供富化与全局差异计算使用）。"""
    rows = await list_chapter_records(db, chapter_id=chapter_id)
    return {
        (normalize_asset_type(row.asset_type) or str(row.asset_type), row.name_key or normalize_name(row.name)): row
        for row in rows
    }


async def list_pending_changes(db: AsyncSession, *, chapter_id: str) -> list[dict[str, Any]]:
    """本章所有"内容已变化，待用户决定"的行（页面只需要决定，不需要重新分析）。"""
    rows = await list_chapter_records(db, chapter_id=chapter_id)
    return [record_to_read(row) for row in rows if has_pending_change(row)]


# ---------------------------------------------------------------------------
# 写：一次分析结果入库（逐条对账）
# ---------------------------------------------------------------------------


def _protected(record: ChapterAssetProfile) -> bool:
    """这一行是否"受保护"（重新提取不得改动它的资料）。

    受保护 = 已确认（已关联真实资产）或有人工修改 / 用户补充。
    """
    return bool(
        str(record.status or "") == STATUS_CONFIRMED
        or record.confirmed_at is not None
        or record.manual_edited_at is not None
        or _strip_map(record.manual_overrides)
        or _as_list(record.user_notes)
    )


def _normalized_fields(asset_type: str, raw: Any, manual: Any = None) -> dict[str, str]:
    merged = {**_strip_map(raw), **_strip_map(manual)}
    return normalize_profile(asset_type, merged)


async def save_analysis_result(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str,
    cache_key: str,
    source_hash: str,
    source_summary: dict[str, Any],
    items: list[dict[str, Any]],
    run: ChapterAssetProfileRun,
    extra_instructions: str = "",
) -> dict[str, Any]:
    """把一次分析结果**对账**进库里（不删除任何已有行；受保护行只记待决定）。

    ``items`` 是"用户主流程"形态的清单项（``asset_type`` / ``name`` / ``aliases`` /
    ``fields`` / ``shot_refs`` / ``evidence``），对账规则见模块文档。
    """
    existing_rows = await list_chapter_records(db, chapter_id=chapter_id)
    by_key: dict[tuple[str, str], ChapterAssetProfile] = {
        (normalize_asset_type(row.asset_type) or str(row.asset_type), row.name_key or normalize_name(row.name)): row
        for row in existing_rows
    }

    created: list[str] = []
    updated: list[str] = []
    unchanged: list[str] = []
    requires_decision: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    now = _now()

    for item in items:
        asset_type = normalize_asset_type(item.get("asset_type")) or ""
        if asset_type not in ASSET_TYPES:
            continue
        name = str(item.get("name") or "").strip()
        key = (asset_type, normalize_name(name))
        if not key[1]:
            continue
        seen.add(key)
        fields = _normalized_fields(asset_type, item.get("fields"))
        aliases = sorted({str(alias) for alias in (item.get("aliases") or []) if str(alias).strip()})
        shot_refs = [ref for ref in (item.get("shot_refs") or []) if isinstance(ref, dict)]
        evidence = [entry for entry in (item.get("evidence") or []) if isinstance(entry, dict)]
        record = by_key.get(key)

        from app.services.studio.asset_overlays import (
            plot_identity_for_fields,
            temporary_notes_for_fields,
        )

        derived_identity = plot_identity_for_fields(asset_type, fields)
        derived_notes = temporary_notes_for_fields(asset_type, fields)

        if record is None:
            record = ChapterAssetProfile(
                project_id=project_id,
                chapter_id=chapter_id,
                asset_type=asset_type,
                name=name,
                name_key=key[1],
                aliases=aliases,
                profile=fields,
                manual_overrides={},
                user_notes=[],
                shot_refs=shot_refs,
                evidence=evidence,
                merge_sources=list(item.get("merge_sources") or []),
                plot_identity=derived_identity,
                temporary_notes=derived_notes,
                status=STATUS_GENERATED,
                source_hash=source_hash,
                source_summary=source_summary,
                generated_at=now,
                run_id=run.id,
            )
            db.add(record)
            by_key[key] = record
            created.append(f"{asset_type}:{key[1]}")
            continue

        current = effective_profile(record)
        diff = profile_diff(current=current, incoming=fields, asset_type=asset_type)
        if not diff["changed_any"]:
            # 与库里生效资料一致 → 只刷新"依据"与来源，不动资料本体。
            record.aliases = sorted({*[str(a) for a in _as_list(record.aliases)], *aliases})
            record.shot_refs = shot_refs or _as_list(record.shot_refs)
            record.evidence = evidence or _as_list(record.evidence)
            if item.get("merge_sources"):
                record.merge_sources = list(item.get("merge_sources") or [])
            record.source_hash = source_hash
            record.source_summary = source_summary
            record.generated_at = now
            record.run_id = run.id
            if record.status == STATUS_PENDING_CHANGE:
                # 上一轮挂着待决定、这一轮结果又和库里一致 → 待决定自动作废
                _clear_pending(record)
                record.status = STATUS_CONFIRMED if record.confirmed_at else STATUS_GENERATED
            elif record.status == STATUS_MISSING_IN_LATEST:
                record.status = STATUS_CONFIRMED if record.confirmed_at else STATUS_GENERATED
            unchanged.append(f"{asset_type}:{key[1]}")
            continue

        if _protected(record):
            # **受保护行绝不覆盖**：新结果进 pending_*，等用户显式决定。
            record.pending_profile = fields
            record.pending_aliases = aliases
            record.pending_shot_refs = shot_refs
            record.pending_evidence = evidence
            record.pending_source_hash = source_hash
            record.pending_at = now
            record.status = STATUS_PENDING_CHANGE
            requires_decision.append(
                {
                    "group_key": f"{asset_type}:{key[1]}",
                    "name": name,
                    "asset_type": asset_type,
                    "type_label": type_label(asset_type),
                    "asset_id": record.asset_id,
                    "reason": "该行已确认或有人工修改；本次新结果不会自动覆盖它，请决定覆盖 / 合并 / 保留。",
                    "diff": diff,
                }
            )
            continue

        record.profile = fields
        record.aliases = sorted({*[str(a) for a in _as_list(record.aliases)], *aliases})
        record.shot_refs = shot_refs
        record.evidence = evidence
        if item.get("merge_sources"):
            record.merge_sources = list(item.get("merge_sources") or [])
        record.plot_identity = derived_identity
        record.temporary_notes = derived_notes
        record.source_hash = source_hash
        record.source_summary = source_summary
        record.generated_at = now
        record.run_id = run.id
        _clear_pending(record)
        record.status = STATUS_CONFIRMED if record.confirmed_at else STATUS_GENERATED
        updated.append(f"{asset_type}:{key[1]}")

    # 本次分析没提到的行：**保留**（受保护行尤其不能丢），只如实标记
    missing: list[dict[str, Any]] = []
    for key, record in by_key.items():
        if key in seen:
            continue
        record.status = STATUS_MISSING_IN_LATEST
        record.source_summary = {
            **dict(record.source_summary or {}),
            "absent_in_latest_analysis": True,
            "absent_since": now.isoformat(),
        }
        missing.append(
            {
                "group_key": f"{key[0]}:{key[1]}",
                "name": str(record.name or ""),
                "asset_type": key[0],
                "asset_id": record.asset_id,
                "reason": "最近一次分析没有再提到它；已保留原有资料与关联，未删除。",
            }
        )

    # 库里已经变了 → 进程内缓存立刻失效（它只是性能优化，不能盖过事实来源）
    clear_chapter_profile_cache()
    await db.flush()
    return {
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "requires_decision": requires_decision,
        "missing_in_latest": missing,
        "protected_preserved": [
            f"{normalize_asset_type(row.asset_type) or row.asset_type}:{row.name_key}"
            for row in by_key.values()
            if _protected(row)
        ],
        "extra_instructions": extra_instructions,
    }


def _clear_pending(record: ChapterAssetProfile) -> None:
    record.pending_profile = {}
    record.pending_aliases = []
    record.pending_shot_refs = []
    record.pending_evidence = []
    record.pending_source_hash = ""
    record.pending_at = None


async def create_run(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str,
    cache_key: str,
    source_hash: str,
    source_summary: dict[str, Any],
    item_total: int,
    llm_called: bool,
    dry_run: bool,
    extra_instructions: str = "",
    meta: dict[str, Any] | None = None,
    technical: dict[str, Any] | None = None,
    warnings: list[Any] | None = None,
) -> ChapterAssetProfileRun:
    """登记一次整章分析（章节级生成状态 + 内容签名）。"""
    run = ChapterAssetProfileRun(
        project_id=project_id,
        chapter_id=chapter_id,
        cache_key=cache_key,
        source_hash=source_hash,
        source_summary=source_summary,
        status=RUN_STATUS_GENERATED,
        item_total=item_total,
        llm_called=bool(llm_called),
        dry_run=bool(dry_run),
        extra_instructions=str(extra_instructions or "")[:512],
        meta=dict(meta or {}),
        technical=dict(technical or {}),
        warnings=list(warnings or []),
        generated_at=_now(),
    )
    db.add(run)
    await db.flush()
    return run


async def mark_run_stale(
    db: AsyncSession,
    *,
    run: ChapterAssetProfileRun,
    reason: str,
) -> None:
    """把某次分析标成"内容已变化，建议重新分析"（只标注，绝不删除数据）。"""
    run.status = RUN_STATUS_STALE
    run.stale_at = _now()
    run.stale_reason = str(reason or "")[:255]
    await db.flush()


# ---------------------------------------------------------------------------
# 写：人工修改与变更决议
# ---------------------------------------------------------------------------


async def apply_manual_edit(
    db: AsyncSession,
    *,
    record: ChapterAssetProfile,
    fields: dict[str, Any] | None = None,
    notes: list[str] | None = None,
    aliases: list[str] | None = None,
) -> ChapterAssetProfile:
    """人工修改资产资料：字段进 ``manual_overrides``，补充进 ``user_notes``。

    这两处是"人工成果"：后续任何一次模型分析都不会覆盖它们（只会进 ``pending_*``
    等用户决定）。
    """
    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    if fields:
        overrides = {**_strip_map(record.manual_overrides)}
        overrides.update(normalize_profile(asset_type, _strip_map(fields)))
        record.manual_overrides = {key: value for key, value in overrides.items() if value}
    if notes:
        existing = [str(note) for note in _as_list(record.user_notes)]
        for note in notes:
            text = str(note or "").strip()
            if text and text not in existing:
                existing.append(text)
        record.user_notes = existing
    if aliases:
        record.aliases = sorted({*[str(a) for a in _as_list(record.aliases)], *[str(a).strip() for a in aliases if str(a).strip()]})
    if fields or notes:
        clear_chapter_profile_cache()
        record.manual_edited_at = _now()
        if record.status == STATUS_PENDING_CHANGE:
            # 人工编辑优先：新结果仍然挂着待决定，但不影响"人工资料已生效"这一事实
            pass
        elif record.status == STATUS_MISSING_IN_LATEST:
            record.status = STATUS_CONFIRMED if record.confirmed_at else STATUS_GENERATED
    await db.flush()
    return record


async def mark_confirmed(
    db: AsyncSession,
    *,
    record: ChapterAssetProfile,
    asset_id: str,
    action: str,
) -> ChapterAssetProfile:
    """确认落库后回写真实资产 ID 与状态（**不动人工修改**）。"""
    clear_chapter_profile_cache()
    record.asset_id = asset_id
    record.link_action = action
    record.confirmed_at = _now()
    if record.status != STATUS_PENDING_CHANGE:
        record.status = STATUS_CONFIRMED
    await db.flush()
    return record


def _decorate_decisions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "decision_empty",
                "message": "没有给出任何决定。",
                "fix": f"decisions 每项需要 group_key 与 action（{list(VALID_RESOLVE_ACTIONS)}）。",
            },
        )
    result: list[dict[str, Any]] = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail=f"decisions 第 {index} 项不是对象。")
        key = str(item.get("group_key") or "").strip()
        action = str(item.get("action") or "").strip()
        if not key:
            raise HTTPException(status_code=422, detail=f"decisions 第 {index} 项缺少 group_key。")
        if action not in VALID_RESOLVE_ACTIONS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"decisions 第 {index} 项的 action「{item.get('action') or '空'}」非法："
                    f"只能是 {list(VALID_RESOLVE_ACTIONS)}。"
                ),
            )
        result.append({**item, "group_key": key, "action": action})
    return result


async def resolve_pending_changes(
    db: AsyncSession,
    *,
    chapter_id: str,
    decisions: Any,
) -> dict[str, Any]:
    """按用户显式决定处理"内容已变化"的行：覆盖 / 合并 / 保留。"""
    plan = _decorate_decisions(decisions)
    rows = await list_chapter_records(db, chapter_id=chapter_id)
    by_group = {group_key(row): row for row in rows}
    unknown = sorted({item["group_key"] for item in plan} - set(by_group))
    if unknown:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unknown_group_key",
                "message": f"decisions 里的 group_key 不在本章资料里：{unknown}",
                "fix": "请用 GET .../asset-profiles/records 返回的 group_key。",
            },
        )

    results: list[dict[str, Any]] = []
    for item in plan:
        record = by_group[item["group_key"]]
        action = item["action"]
        if not has_pending_change(record):
            results.append(
                {
                    "group_key": item["group_key"],
                    "name": record.name,
                    "action": action,
                    "ok": False,
                    "reason": "这一行当前没有待决定的新结果（可能已被处理）。",
                }
            )
            continue
        asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type)
        pending_fields = normalize_profile(asset_type, _strip_map(record.pending_profile))
        before = effective_profile(record)
        if action == RESOLVE_OVERWRITE:
            record.profile = pending_fields
            record.aliases = sorted({*[str(a) for a in _as_list(record.aliases)], *[str(a) for a in _as_list(record.pending_aliases)]})
            record.shot_refs = _as_list(record.pending_shot_refs) or _as_list(record.shot_refs)
            record.evidence = _as_list(record.pending_evidence) or _as_list(record.evidence)
        elif action == RESOLVE_MERGE:
            merged = dict(pending_fields)
            merged.update(_strip_map(record.profile) | _strip_map(record.manual_overrides))
            record.profile = merged
            record.aliases = sorted({*[str(a) for a in _as_list(record.aliases)], *[str(a) for a in _as_list(record.pending_aliases)]})
            record.shot_refs = _merge_dicts(_as_list(record.shot_refs), _as_list(record.pending_shot_refs), key="shot_id")
            record.evidence = _merge_dicts(_as_list(record.evidence), _as_list(record.pending_evidence), key="snippet")
        # RESOLVE_KEEP：一个字都不动
        if action != RESOLVE_KEEP:
            record.source_hash = str(record.pending_source_hash or record.source_hash or "")
        _clear_pending(record)
        if record.status == STATUS_PENDING_CHANGE:
            record.status = STATUS_CONFIRMED if record.confirmed_at else STATUS_GENERATED
        results.append(
            {
                "group_key": item["group_key"],
                "name": record.name,
                "asset_type": asset_type,
                "action": action,
                "ok": True,
                "label": RESOLVE_LABELS[action],
                "before": before,
                "after": effective_profile(record),
                "asset_id": record.asset_id,
                "manual_preserved": bool(_strip_map(record.manual_overrides) or _as_list(record.user_notes)),
            }
        )
    clear_chapter_profile_cache()
    await db.flush()
    return {
        "chapter_id": chapter_id,
        "results": results,
        "summary": {
            "total": len(results),
            "applied": len([item for item in results if item.get("ok")]),
            "skipped": len([item for item in results if not item.get("ok")]),
        },
        "note": (
            "覆盖只替换模型侧资料，人工修改与用户补充一律保留；"
            "合并以现有资料为准只补空字段；保留则丢弃本次新结果。"
        ),
    }


def _merge_dicts(left: list[Any], right: list[Any], *, key: str) -> list[Any]:
    """两个依据列表取并集（按 ``key`` 去重，保持先出现者顺序）。"""
    merged: list[Any] = []
    seen: set[str] = set()
    for entry in [*left, *right]:
        if not isinstance(entry, dict):
            continue
        marker = str(entry.get(key) or "") or repr(sorted(entry.items()))
        if marker in seen:
            continue
        seen.add(marker)
        merged.append(entry)
    return merged


__all__ = [
    "RESOLVE_KEEP",
    "RESOLVE_LABELS",
    "RESOLVE_MERGE",
    "RESOLVE_OVERWRITE",
    "RUN_STATUS_TEXT",
    "STATUS_TEXT",
    "VALID_RESOLVE_ACTIONS",
    "apply_manual_edit",
    "create_run",
    "effective_profile",
    "get_chapter_record",
    "get_latest_run",
    "group_key",
    "has_pending_change",
    "list_chapter_records",
    "list_pending_changes",
    "load_chapter_record_map",
    "mark_confirmed",
    "mark_run_stale",
    "profile_diff",
    "profile_source_label",
    "record_evidence_text",
    "record_to_overlay",
    "record_to_read",
    "resolve_pending_changes",
    "save_analysis_result",
]
