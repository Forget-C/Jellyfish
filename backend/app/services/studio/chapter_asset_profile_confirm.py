"""第 2 步「资产准备」的**确认落库**：把结构化清单变成真实资产，并保留全部来源证据。

设计要点（每一条都是对"这条链路以前会丢资料"的直接回应）
========================================================

1. **无冲突可直接确认，有冲突必须人工**
   清单里每一项都已经在 :mod:`chapter_asset_profiles` 里判过冲突：

   - ``auto_confirmable=True``（库里没有同名项，或已有同名同类型项但描述不矛盾）
     → 默认动作就是"新建"或"选用已有"，**不需要人工逐个点**；
   - ``needs_review``（必有 ``conflict``）→ **只有显式在 selections 里给出决定、
     并且带 ``confirm_conflict=true``** 才会写入；否则原样跳过并如实回报原因。

2. **结构化资料落进既有列，不加列、不建表**
   - 资产：``characters/scenes/props/costumes.description``（Text，已存在）——
     内容由 :func:`asset_profiles.render_profile_text` 确定性拼装，
     **顺带把出场镜头写进描述**，这样图片提示词的画像卡直接就拿到剧本资料；
   - 候选：``shot_extracted_candidates.payload``（JSON，已存在）——
     写入 ``asset_profile`` / ``aliases`` / ``shot_refs`` / ``evidence``，
     原始候选一行不动（"保留所有来源证据"）。

3. **选用已有资产时绝不覆盖已有内容**
   已有 ``description`` / ``image_prompts`` / 图片行一律原样保留；
   只有"描述为空"时才补写结构化资料，并在回报里说明是补写还是保留。

4. **确认后立刻可被生产区读取**
   全部沿用既有口径：``project_*_links`` 关联、``mark_linked_by_name`` 回写候选状态，
   最后直接返回 ``build_project_asset_readiness`` 的就绪清单，页面无需再次拉取。
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Project, Shot
from app.services.common import entity_not_found
from app.services.studio.asset_overlays import (
    build_overlay_from_item,
    is_global_asset,
    overlay_to_profile_text,
)
from app.services.studio.asset_profiles import (
    ASSET_TYPES,
    field_keys,
    normalize_profile,
    render_profile_text,
    type_label,
)
from app.services.studio.chapter_asset_record_store import (
    list_chapter_records,
    mark_confirmed,
)
from app.services.studio.entity_crud import create_entity
from app.services.studio.project_asset_readiness import build_project_asset_readiness
from app.services.studio.shot_extracted_candidates import mark_linked_by_name
from app.utils.project_links import upsert_project_link

#: 资产类型 → 新建 ID 前缀（沿用既有 "char-/scene-…" 的短写法口径）
ID_PREFIX: dict[str, str] = {
    "character": "char",
    "scene": "scene",
    "prop": "prop",
    "costume": "costume",
}

#: 资产类型 → (关联模型, 关联列)
LINK_MODEL_BY_TYPE: dict[str, str] = {
    "scene": "scene_id",
    "prop": "prop_id",
    "costume": "costume_id",
}

ACTION_CREATE = "create_new"
ACTION_LINK = "link_existing"
ACTION_SKIP = "skip"
VALID_ACTIONS: tuple[str, ...] = (ACTION_CREATE, ACTION_LINK, ACTION_SKIP)


def _new_asset_id(asset_type: str) -> str:
    return f"{ID_PREFIX.get(asset_type, asset_type)}-{uuid.uuid4().hex[:12]}"


def _link_model_for(asset_type: str) -> type:
    from app.models.studio import ProjectCostumeLink, ProjectPropLink, ProjectSceneLink

    return {
        "scene": ProjectSceneLink,
        "prop": ProjectPropLink,
        "costume": ProjectCostumeLink,
    }[asset_type]


class _ChapterContext:
    """确认流程需要的一次性只读上下文。"""

    def __init__(self, *, chapter: Chapter, shots: list[Shot], project: Project) -> None:
        self.chapter = chapter
        self.shots = shots
        self.project = project

    @property
    def project_id(self) -> str:
        return str(self.project.id)

    @property
    def shot_ids(self) -> list[str]:
        return [str(shot.id) for shot in self.shots]


async def _load_context(db: AsyncSession, *, chapter_id: str) -> _ChapterContext:
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))
    project = await db.get(Project, chapter.project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Project"))
    shots = (
        (await db.execute(select(Shot).where(Shot.chapter_id == chapter_id).order_by(Shot.index))).scalars().all()
    )
    return _ChapterContext(chapter=chapter, shots=list(shots), project=project)


async def _resolve_profile_payload(
    db: AsyncSession,
    *,
    ctx: _ChapterContext,
    extra_instructions: str,
) -> dict[str, Any]:
    """取本次要确认的清单：**直接读数据库**（数据库是事实来源）。

    改造前这里只认"进程内缓存里签名一致的那一份"，于是后端一重启就再也确认不了
    （409 ``asset_profile_not_generated``），用户只能**再花一次钱**重新分析 —— 正式使用不可接受。

    现在：

    - 库里有资料行 → 用它组装清单（``build_chapter_asset_profiles(refresh=False,
      allow_generate=False)``，**一次模型调用都不会发**）；
    - 库里一行都没有 → 才如实报 409，并明确告诉用户该先调用哪个接口生成。

    ``use_cache=False``：确认动作必须基于**库里当下的行**（包括刚做过的人工修改），
    不能吃"同进程里的旧副本"。
    """
    from app.services.studio.chapter_asset_profiles import build_chapter_asset_profiles

    payload = await build_chapter_asset_profiles(
        db,
        chapter_id=ctx.chapter.id,
        extra_instructions=extra_instructions,
        refresh=False,
        allow_generate=False,
        use_cache=False,
    )
    if not (payload.get("persistence") or {}).get("generated"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "asset_profile_not_generated",
                "message": (
                    "本章还没有生成过结构化资产清单，无法确认落库。"
                    "确认动作必须基于已保存的清单，否则会把空资料写进资产。"
                ),
                "fix": (
                    f"请先调用 POST /api/v1/studio/chapters/{ctx.chapter.id}/asset-profiles "
                    "生成清单（会按需调用一次文本模型；若库里已有则直接读取、不再调用），再调用本接口确认。"
                ),
            },
        )
    return payload


def _selections_by_group(raw: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return result
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, Mapping):
            raise HTTPException(status_code=422, detail=f"selections 第 {index} 项不是对象。")
        key = str(item.get("group_key") or "").strip()
        if not key:
            raise HTTPException(status_code=422, detail=f"selections 第 {index} 项缺少 group_key。")
        action = str(item.get("action") or "").strip()
        if action not in VALID_ACTIONS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"selections 第 {index} 项的 action「{item.get('action') or '空'}」非法："
                    f"只能是 {list(VALID_ACTIONS)}。"
                ),
            )
        result[key] = dict(item)
    return result


def _decide_action(
    *,
    item: dict[str, Any],
    selection: dict[str, Any] | None,
    auto_confirm_unconflicted: bool,
    confirm_conflict: bool,
) -> tuple[str, str]:
    """决定这一项怎么办；返回 ``(action, reason)``（``skip`` 时 reason 是中文原因）。"""
    needs_review = bool(item.get("needs_review"))
    if selection is not None:
        action = str(selection.get("action") or ACTION_SKIP)
        if action == ACTION_SKIP:
            return ACTION_SKIP, str(selection.get("reason") or "用户选择本次不处理。")
        if needs_review and not (confirm_conflict or bool(selection.get("confirm_conflict"))):
            return (
                ACTION_SKIP,
                f"该项存在冲突（{(item.get('conflict') or {}).get('reason') or '未知原因'}），"
                "人工决定必须带 confirm_conflict=true 才会写入。",
            )
        return action, "按 selections 的人工决定处理。"
    if needs_review:
        return ACTION_SKIP, f"冲突项需人工处理：{(item.get('conflict') or {}).get('reason') or '未知原因'}"
    if not auto_confirm_unconflicted:
        return ACTION_SKIP, "本次没有开启「无冲突项直接确认」。"
    return (ACTION_LINK if item.get("existing_asset_id") else ACTION_CREATE), "无冲突，按建议动作直接确认。"


async def _mark_candidates_linked(
    db: AsyncSession,
    *,
    ctx: _ChapterContext,
    asset_type: str,
    name: str,
    asset_id: str,
) -> int:
    """把本章所有镜头的同名候选回写为 linked（沿用既有 mark_linked_by_name）。"""
    marked = 0
    for shot_id in ctx.shot_ids:
        row = await mark_linked_by_name(
            db,
            shot_id=shot_id,
            # 传**纯字符串**：``mark_linked_by_name`` 内部会做 ``ShotCandidateType(str(...))``，
            # 传枚举成员会得到 "ShotCandidateType.character" 这种非枚举值而报错
            # （与 entity_crud 的既有调用口径保持一致）。
            candidate_type=asset_type,
            candidate_name=name,
            linked_entity_id=asset_id,
        )
        if row is not None:
            marked += 1
    return marked


async def _write_candidate_evidence(
    db: AsyncSession,
    *,
    ctx: _ChapterContext,
    asset_type: str,
    names: list[str],
    profile: dict[str, str],
    shot_refs: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    asset_id: str,
) -> int:
    """把结构化资料与剧本依据写进候选 ``payload``（既有 JSON 列，原始候选行不动）。"""
    from app.models.studio import ShotExtractedCandidate
    from app.services.studio.llm_orchestration.json_utils import normalize_name

    wanted = {normalize_name(name) for name in names if normalize_name(name)}
    if not wanted:
        return 0
    stmt = select(ShotExtractedCandidate).where(ShotExtractedCandidate.shot_id.in_(ctx.shot_ids or [""]))
    rows = (await db.execute(stmt)).scalars().all()
    updated = 0
    for row in rows:
        if str(getattr(row.candidate_type, "value", row.candidate_type)) != asset_type:
            continue
        if normalize_name(row.candidate_name) not in wanted:
            continue
        payload = dict(row.payload or {})
        payload["asset_profile"] = profile
        payload["asset_profile_text"] = render_profile_text(asset_type, profile, include_evidence_fields=True)
        payload["aliases"] = sorted({name for name in names if normalize_name(name) != normalize_name(row.candidate_name)})
        payload["shot_refs"] = [
            {
                "shot_id": ref.get("shot_id"),
                "shot_index": ref.get("shot_index"),
                "script_excerpt": ref.get("script_excerpt"),
            }
            for ref in shot_refs
        ]
        payload["evidence"] = evidence
        payload["linked_entity_id"] = asset_id
        row.payload = payload
        updated += 1
    return updated


async def confirm_chapter_asset_profiles(
    db: AsyncSession,
    *,
    chapter_id: str,
    selections: Any = None,
    auto_confirm_unconflicted: bool = True,
    confirm_conflict: bool = False,
    extra_instructions: str = "",
) -> dict[str, Any]:
    """按结构化清单建/绑资产（**一次请求一个事务，全有或全无**）。

    本接口**不写图片表**：新资产只带结构化描述，已有资产只补空描述与项目关联；
    ``image_prompts`` / 图片行 / 定版图一律原样保留（定版保护由既有
    ``primary_protection`` 负责，这里连照片表都不碰）。
    """
    ctx = await _load_context(db, chapter_id=chapter_id)
    payload = await _resolve_profile_payload(db, ctx=ctx, extra_instructions=extra_instructions)
    items = list((payload.get("user_flow") or {}).get("items") or [])
    if not items:
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail={
                "code": "asset_profile_empty",
                "message": "本章结构化清单里没有任何资产，没什么可确认的。",
                "fix": "请确认剧本已导入、分镜已拆分，然后重新生成清单。",
            },
        )

    selection_map = _selections_by_group(selections)
    unknown = sorted(set(selection_map) - {str(item.get("group_key")) for item in items})
    if unknown:
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail={
                "code": "unknown_group_key",
                "message": f"selections 里的 group_key 不在本次清单中：{unknown}",
                "fix": "请用清单返回的 group_key（格式 类型:归一化名称）提交决定。",
            },
        )

    # 持久化行（按 group_key 索引）：确认成功后要把"已关联的真实资产 ID"与确认时间写回它。
    from app.services.studio.chapter_asset_record_store import group_key as record_group_key

    records_by_group = {
        record_group_key(record): record
        for record in await list_chapter_records(db, chapter_id=chapter_id)
    }

    # ---- 预检：link_existing 的目标资产必须存在（任何一项不合法 → 整批不改） ----
    planned: list[tuple[dict[str, Any], str, str, dict[str, Any] | None]] = []
    for item in items:
        group_key = str(item.get("group_key") or "")
        selection = selection_map.get(group_key)
        action, reason = _decide_action(
            item=item,
            selection=selection,
            auto_confirm_unconflicted=auto_confirm_unconflicted,
            confirm_conflict=confirm_conflict,
        )
        if action == ACTION_LINK:
            target_id = str((selection or {}).get("asset_id") or item.get("existing_asset_id") or "").strip()
            if not target_id:
                raise HTTPException(
                    status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
                    detail={
                        "code": "link_target_missing",
                        "message": f"「{item.get('name')}」选择了选用已有资产，但没有给出 asset_id。",
                        "fix": "请在 selections 里补上 asset_id，或改用 action=create_new。",
                    },
                )
            selection = {**(selection or {}), "asset_id": target_id}
        planned.append((item, action, reason, selection))

    # ---- 执行 ----
    results: list[dict[str, Any]] = []
    for item, action, reason, selection in planned:
        asset_type = str(item.get("asset_type") or "")
        if asset_type not in ASSET_TYPES:
            results.append(
                {
                    "group_key": item.get("group_key"),
                    "name": item.get("name"),
                    "asset_type": asset_type,
                    "action": ACTION_SKIP,
                    "ok": False,
                    "reason": f"资产类型 {asset_type!r} 不在支持范围内，已跳过。",
                }
            )
            continue
        if action == ACTION_SKIP:
            results.append(
                {
                    "group_key": item.get("group_key"),
                    "name": item.get("name"),
                    "asset_type": asset_type,
                    "action": ACTION_SKIP,
                    "ok": True,
                    "reason": reason,
                }
            )
            continue

        profile = normalize_profile(asset_type, item.get("fields") or {})
        profile_text = render_profile_text(asset_type, profile, include_evidence_fields=True)
        names = [str(item.get("name") or ""), *(item.get("aliases") or [])]
        shot_refs = list(item.get("shot_refs") or [])
        evidence = [
            {"snippet": entry.get("snippet"), "grounded": entry.get("grounded"), "from_name": entry.get("from_name")}
            for entry in (item.get("evidence") or [])
        ]

        if action == ACTION_LINK:
            asset_id = str(selection.get("asset_id"))
            linked = await _link_existing(
                db,
                ctx=ctx,
                asset_type=asset_type,
                asset_id=asset_id,
                profile_text=profile_text,
                profile=profile,
            )
            marked = await _mark_candidates_linked(
                db, ctx=ctx, asset_type=asset_type, name=str(item.get("name") or ""), asset_id=asset_id
            )
            evidence_rows = await _write_candidate_evidence(
                db,
                ctx=ctx,
                asset_type=asset_type,
                names=names,
                profile=profile,
                shot_refs=shot_refs,
                evidence=evidence,
                asset_id=asset_id,
            )
            record_result = await _mark_record_confirmed(
                db,
                item=item,
                records_by_group=records_by_group,
                asset_id=asset_id,
                action=ACTION_LINK,
            )
            results.append(
                {
                    "group_key": item.get("group_key"),
                    "name": item.get("name"),
                    "asset_type": asset_type,
                    "action": ACTION_LINK,
                    "ok": True,
                    "asset_id": asset_id,
                    "description_written": linked["description_written"],
                    "global_write_skipped": linked["global_write_skipped"],
                    "chapter_scoped": linked["chapter_scoped"],
                    "preserved": linked["preserved"],
                    "reason": reason,
                    "linked_candidates": marked,
                    "evidence_rows": evidence_rows,
                    "chapter_record": record_result,
                }
            )
            continue

        # create_new
        new_id = _new_asset_id(asset_type)
        # 全局资产（场景/道具/服装）写进全局行的只有"通用资料"；本章特有字段只进 overlay
        overlay_general_text = overlay_to_profile_text(
            build_overlay_from_item(
                item=item, chapter_id=ctx.chapter.id, project_id=ctx.project_id, asset_id=new_id
            ).to_payload(),
            include_temporal=False,
        )
        await _create_new_asset(
            db,
            ctx=ctx,
            asset_type=asset_type,
            asset_id=new_id,
            name=str(item.get("name") or ""),
            profile_text=(overlay_general_text if is_global_asset(asset_type) else profile_text),
        )
        marked = await _mark_candidates_linked(
            db, ctx=ctx, asset_type=asset_type, name=str(item.get("name") or ""), asset_id=new_id
        )
        evidence_rows = await _write_candidate_evidence(
            db,
            ctx=ctx,
            asset_type=asset_type,
            names=names,
            profile=profile,
            shot_refs=shot_refs,
            evidence=evidence,
            asset_id=new_id,
        )
        record_result = await _mark_record_confirmed(
            db,
            item=item,
            records_by_group=records_by_group,
            asset_id=new_id,
            action=ACTION_CREATE,
        )
        results.append(
            {
                "group_key": item.get("group_key"),
                "name": item.get("name"),
                "asset_type": asset_type,
                "action": ACTION_CREATE,
                "ok": True,
                "asset_id": new_id,
                "global_write_skipped": False,
                "chapter_scoped": is_global_asset(asset_type),
                "reason": reason,
                "linked_candidates": marked,
                "evidence_rows": evidence_rows,
                "chapter_record": record_result,
            }
        )

    readiness = await build_project_asset_readiness(db, project_id=ctx.project_id)
    created = [item for item in results if item["action"] == ACTION_CREATE and item["ok"]]
    linked = [item for item in results if item["action"] == ACTION_LINK and item["ok"]]
    skipped = [item for item in results if item["action"] == ACTION_SKIP]

    return {
        "chapter_id": chapter_id,
        "project_id": ctx.project_id,
        "results": results,
        "summary": {
            "total": len(results),
            "created": len(created),
            "linked": len(linked),
            "skipped": len(skipped),
            "chapter_scoped": len([item for item in results if item.get("chapter_scoped")]),
            "global_write_skipped": len([item for item in results if item.get("global_write_skipped")]),
            "chapter_records_bound": len(
                [item for item in results if (item.get("chapter_record") or {}).get("bound")]
            ),
            "pending_change_remaining": len(
                [item for item in results if (item.get("chapter_record") or {}).get("pending_change")]
            ),
            "needs_review_remaining": len(
                [item for item in skipped if str(item.get("reason") or "").startswith("冲突项需人工处理")]
            ),
        },
        "created_asset_ids": {item["asset_type"]: item["asset_id"] for item in created},
        "asset_readiness": readiness,
        "note": (
            "无冲突项已直接确认；冲突项未处理（见 skipped 的 reason）。"
            "结构化资料保存在**按项目 + 章节隔离**的 chapter_asset_profiles 表里"
            "（后端重启后直接读，不重复调用模型）；候选 payload 同步保留证据。"
            "已关联的真实资产 ID 与确认时间已写回该表，生产区读同一份 asset_readiness。"
            "**没有**写全局资产（场景/道具/服装）的通用资料、image_prompts、图片与定版图。"
        ),
    }


async def _create_new_asset(
    db: AsyncSession,
    *,
    ctx: _ChapterContext,
    asset_type: str,
    asset_id: str,
    name: str,
    profile_text: str,
) -> None:
    """新建资产 + 章节级项目关联（复用既有 create_entity，走同一套护栏）。

    风格字段取**项目**的 style / visual_style（章节本身不带风格），
    与页面「新建资产」的既有口径一致。

    **新建的全局资产也只写"通用资料"**：即使这一行是本次新建的，
    它仍然是全局资产（所有项目共用），所以本章特有的时间天气/光线色调/相关事件
    （场景）、状态/剧情作用（道具）、使用场合（服装）**不写进全局行**，
    只留在本章 overlay 里 —— 与"选用已有全局资产"完全同一条边界，不搞两套标准。
    """
    body: dict[str, Any] = {
        "id": asset_id,
        "name": name,
        "description": profile_text,
        "project_id": ctx.project_id,
        "chapter_id": ctx.chapter.id,
        "style": str(getattr(ctx.project, "style", "") or "真人都市"),
        "visual_style": str(getattr(ctx.project, "visual_style", "") or "现实"),
    }
    await create_entity(db, entity_type=asset_type, body=body)


async def _link_existing(
    db: AsyncSession,
    *,
    ctx: _ChapterContext,
    asset_type: str,
    asset_id: str,
    profile_text: str,
    profile: dict[str, str],
) -> dict[str, Any]:
    """选用已有资产：补项目关联；**是否写全局资产描述按资产边界决定**。

    边界（用户 2026-09 补充，优先级最高）
    ------------------------------------

    - **角色**归属项目（``characters.project_id``）→ 项目范围内的资料写进描述是允许的，
      且**只在描述为空时**补写（已有描述一律不动，人工写过的、上一轮生成过的都保留）；
    - **场景 / 道具 / 服装是全局资产** → **绝不写全局描述**：本章的剧情身份、出场依据、
      临时补充全部只进**章节 overlay**（``asset_overlays``）。要更新全局资产必须走
      ``global_asset_updates`` 的"差异预览 + 显式确认"接口。

    图片相关的一律不碰：``image_prompts`` / ``*_images``（含定版 ``is_primary``）
    全部原样保留。定版保护由既有 ``primary_protection`` 负责，本流程不写图片表，
    因此不存在"确认资产顺手把定版图换掉"的可能。
    """
    from app.services.studio.entity_specs import entity_spec

    spec = entity_spec(asset_type)
    row = await db.get(spec.model, asset_id)
    if row is None:
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail={
                "code": "link_target_not_found",
                "message": f"要选用的已有资产不存在：{asset_type}/{asset_id}",
                "fix": "请重新生成清单（会重新做一次同名匹配），或改用 action=create_new。",
            },
        )

    global_asset = is_global_asset(asset_type)
    preserved: list[str] = ["images"]
    description_written = False
    existing_description = str(getattr(row, "description", "") or "").strip()

    if global_asset:
        # 全局资产：一个字都不写全局列；资料全部留在章节 overlay 里
        preserved.append("description")
        preserved.append("global_description")
        global_write_skipped = True
    elif not existing_description and profile_text:
        row.description = profile_text
        description_written = True
        global_write_skipped = False
    else:
        # 角色：已有描述一律不动（人工写过的、上一轮生成过的一律保留）
        preserved.append("description")
        global_write_skipped = False
    if dict(getattr(row, "image_prompts", None) or {}):
        preserved.append("image_prompts")

    if asset_type != "character":
        await upsert_project_link(
            db,
            model=_link_model_for(asset_type),
            asset_field=LINK_MODEL_BY_TYPE[asset_type],  # type: ignore[arg-type]
            asset_id=asset_id,
            project_id=ctx.project_id,
            chapter_id=ctx.chapter.id,
            shot_id=None,
        )
    await db.flush()
    return {
        "description_written": description_written,
        "global_write_skipped": global_write_skipped,
        "chapter_scoped": global_asset,
        "preserved": sorted(set(preserved)),
        "visual_fields": sorted([key for key in field_keys(asset_type) if str(profile.get(key) or "").strip()]),
    }


async def _mark_record_confirmed(
    db: AsyncSession,
    *,
    item: dict[str, Any],
    records_by_group: dict[str, Any],
    asset_id: str,
    action: str,
) -> dict[str, Any]:
    """确认成功后把"已关联的真实资产 ID + 确认时间"写回持久化行。

    这是"付费生成并人工确认过的结构资产生效于真实资产"的最后一环：

    - 资料本体（``chapter_asset_profiles``）**不重写**：确认动作只补 ``asset_id`` /
      ``link_action`` / ``confirmed_at`` 与状态，人工修改与用户补充一个字都不动；
    - 行上若挂着"内容已变化，待用户决定"的新结果，确认**不会**顺手把它落下来，
      也不会把它丢掉 —— 仍然挂着，等用户显式选择覆盖 / 合并 / 保留；
    - 全局资产（场景/道具/服装）的通用资料依旧一个字都不写（见 :func:`_link_existing`）。
    """
    record = records_by_group.get(str(item.get("group_key") or ""))
    if record is None:
        return {
            "bound": False,
            "reason": "库里没有对应的章节资料行（可能是确认前清单被外部改动过），已跳过写回。",
        }
    pending = bool(getattr(record, "pending_profile", None))
    await mark_confirmed(db, record=record, asset_id=asset_id, action=action)
    return {
        "bound": True,
        "record_id": int(record.id),
        "asset_id": asset_id,
        "link_action": action,
        "status": str(record.status or ""),
        "pending_change": pending,
        "manual_preserved": bool(record.manual_overrides or record.user_notes),
        "scope": "chapter",
        "is_global_asset": is_global_asset(str(item.get("asset_type") or "")),
    }


__all__ = [
    "ACTION_CREATE",
    "ACTION_LINK",
    "ACTION_SKIP",
    "ID_PREFIX",
    "VALID_ACTIONS",
    "confirm_chapter_asset_profiles",
    "type_label",
]
