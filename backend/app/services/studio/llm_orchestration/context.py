"""编排服务的上下文装配：把 DB 里的章节/镜头/实体画像整理成提示词可用的稳定结构。

这一层是**只读**的：只 select，不 add / update / delete，符合"LLM 结果只预览、不落库"的约束。
"""

from __future__ import annotations

from dataclasses import dataclass
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
    Project,
    Prop,
    Scene,
    Shot,
    ShotExtractedCandidate,
)
from app.services.common import entity_not_found
from app.services.studio.llm_orchestration.json_utils import normalize_name
from app.schemas.studio.llm_orchestration import EntityProfileCardRead, EntityProfileInput

MAX_ENTITY_PROFILES = 60
MAX_PROFILE_CHARS = 600
MAX_SOURCE_CHARS = 24000
#: 资产资料富化时，单条候选的扫描上限（防止超大项目拖慢）与剧本片段窗口
MAX_CANDIDATE_SCAN = 5000
SCRIPT_WINDOW_CHARS = 120

ENTITY_TYPE_ZH: dict[str, str] = {
    "character": "角色",
    "scene": "场景",
    "prop": "道具",
    "costume": "服装",
    "actor": "演员",
}


@dataclass(slots=True)
class ChapterSource:
    chapter_id: str
    project_id: str
    title: str
    text: str


@dataclass(slots=True)
class ShotContext:
    shot_id: str
    chapter_id: str
    project_id: str
    title: str
    script_excerpt: str
    style: str
    visual_style: str
    project_name: str


def _clip(text: Any, limit: int) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "…（已截断）"


def profile_canonical_subject(*, name: str, entity_type: str, profile: str) -> str:
    """确定性画像卡主体描述：同一实体在所有槽位共用同一段文字。"""
    type_zh = ENTITY_TYPE_ZH.get(entity_type, entity_type or "实体")
    body = str(profile or "").strip() or "外观信息不足，需人工补充"
    return f"{name}（{type_zh}）：{body}"


def build_profile_card(profile: EntityProfileInput, *, source: str = "request") -> EntityProfileCardRead:
    """把一条画像输入转成画像卡（含确定性主体描述）。"""
    entity_type = str(profile.entity_type or "character").strip().lower()
    merged_profile = "；".join(
        part
        for part in (
            str(profile.profile or "").strip(),
            str(profile.base_prompt or "").strip(),
            str(profile.image_prompt or "").strip(),
        )
        if part
    )
    clipped = _clip(merged_profile, MAX_PROFILE_CHARS)
    profile_source = str(profile.profile_source or "").strip() or _infer_profile_source(
        profile_source="", profile=clipped
    )
    return EntityProfileCardRead(
        name=str(profile.name).strip(),
        entity_type=entity_type,
        source=source,  # type: ignore[arg-type]
        profile=clipped,
        canonical_subject=profile_canonical_subject(
            name=str(profile.name).strip(),
            entity_type=entity_type,
            profile=clipped,
        ),
        profile_source=profile_source,
        has_structured_profile=bool(clipped) and not _is_vague_profile(clipped),
    )


def _is_vague_profile(text: Any) -> bool:
    """画像文本里是否只有空话（「外观信息不足」「需人工补充」之类）。"""
    from app.services.studio.asset_profiles import is_vague_text

    return is_vague_text(text)


def _infer_profile_source(*, profile_source: str, profile: str) -> str:
    """装载方没标来源时，按"有没有内容"给一个诚实的兜底标签。"""
    if profile_source:
        return profile_source
    return "asset_description" if str(profile or "").strip() else "none"


def build_profile_cards(
    profiles: list[EntityProfileInput],
    *,
    source: str = "request",
) -> list[EntityProfileCardRead]:
    """批量生成画像卡，按名称去重（先到先得）。"""
    cards: list[EntityProfileCardRead] = []
    seen: set[str] = set()
    for profile in profiles:
        key = str(profile.name or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        cards.append(build_profile_card(profile, source=source))
    return cards


def render_profile_cards(cards: list[EntityProfileCardRead]) -> str:
    """渲染成提示词里的画像卡段落。"""
    if not cards:
        return "（本次未提供实体画像卡；请只依据镜头文本推断主体，不要编造具体人名与外观细节。）"
    lines = []
    for card in cards:
        lines.append(f"- 画像卡主体描述（必须逐字使用）：{card.canonical_subject}")
    return "\n".join(lines)


async def load_chapter_source(db: AsyncSession, chapter_id: str) -> ChapterSource:
    """读取章节原文（优先精简后的 condensed_text）。"""
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))
    raw = str(chapter.condensed_text or "").strip() or str(chapter.raw_text or "").strip()
    return ChapterSource(
        chapter_id=chapter.id,
        project_id=chapter.project_id,
        title=chapter.title or "",
        text=_clip(raw, MAX_SOURCE_CHARS),
    )


async def load_shot_context(db: AsyncSession, shot_id: str) -> ShotContext:
    """读取镜头上下文（含所属章节与项目风格）。"""
    shot = await db.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Shot"))
    chapter = await db.get(Chapter, shot.chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{entity_not_found('Chapter')} for shot")
    project = await db.get(Project, chapter.project_id)
    return ShotContext(
        shot_id=shot.id,
        chapter_id=chapter.id,
        project_id=chapter.project_id,
        title=shot.title or "",
        script_excerpt=str(shot.script_excerpt or "").strip(),
        style=str(getattr(project, "style", "") or ""),
        visual_style=str(getattr(project, "visual_style", "") or ""),
        project_name=str(getattr(project, "name", "") or ""),
    )


async def resolve_project_id(
    db: AsyncSession,
    *,
    shot_id: str | None,
    chapter_id: str | None,
    project_id: str | None,
) -> str | None:
    """按 显式 project_id → shot → chapter 的顺序推断项目 ID。"""
    if project_id:
        return project_id
    if shot_id:
        shot = await db.get(Shot, shot_id)
        if shot is not None:
            chapter = await db.get(Chapter, shot.chapter_id)
            if chapter is not None:
                return chapter.project_id
    if chapter_id:
        chapter = await db.get(Chapter, chapter_id)
        if chapter is not None:
            return chapter.project_id
    return None


def _overlay_in_scope(overlay: dict[str, Any], chapter_id: str | None) -> bool:
    """这份 overlay 是否适用于本次请求的章节（没指定章节时一律适用）。"""
    if not chapter_id:
        return True
    overlay_chapter = str(overlay.get("chapter_id") or "")
    return (not overlay_chapter) or overlay_chapter == str(chapter_id)


def _merge_profile_segments(*texts: Any) -> str:
    """按「；」分段合并几段画像文本：**去重、保序、不丢新信息**。

    为什么必须去重：确认落库时已经把结构化资料写进了资产 ``description``，
    富化又会从候选 ``payload`` 里读到同一份 —— 直接拼会把同一段资料写两遍，
    画像卡立刻被撑爆（``MAX_PROFILE_CHARS`` 截断），提示词里也会出现大段重复。
    分段去重后，"已经在描述里写过的结构化字段"不会重复，而
    "只存在于候选里的剧本依据 / 出场镜头"这类**新信息**仍会被补进来。
    """
    parts: list[str] = []
    seen: set[str] = set()
    for text in texts:
        value = str(text or "").strip()
        if not value:
            continue
        for segment in value.replace("\n", "；").split("；"):
            seg = segment.strip()
            if not seg:
                continue
            key = seg.lower()
            if key in seen:
                continue
            seen.add(key)
            parts.append(seg)
    return "；".join(parts)


async def load_project_entity_profiles(
    db: AsyncSession,
    *,
    project_id: str,
    limit: int = MAX_ENTITY_PROFILES,
    enrich: bool = True,
    chapter_id: str | None = None,
) -> list[EntityProfileInput]:
    """装载项目内的实体画像：角色（项目内）+ 场景/道具/服装（项目关联）。

    **为什么必须富化**（这是「图片提示词大量出现『外观信息不足，需人工补充』」的根因修复）
    ---------------------------------------------------------------------------------

    此前这里只读 ``<entities>.description`` 一列。可是资产描述常常是空的（甚至从没被写过），
    于是 :func:`profile_canonical_subject` 落到「外观信息不足，需人工补充」，
    而图片提示词模板又**要求模型逐字使用**这段文字 —— 结果必然是一堆废提示词。

    而剧本里的资料其实是有的，只是散落在两个既有位置、此前没人读：

    1. ``shot_extracted_candidates.payload``——第 2 步聚合出的结构化资产资料
       （``asset_profile`` / ``asset_profile_text`` / ``shot_refs`` / ``evidence``），
       由 ``chapter_asset_profile_confirm`` 写入；**JSON 列，已存在，未加列**；
    2. ``shots.script_excerpt`` / ``chapters.condensed_text``——该资产出现过的剧本原文。

    ``enrich=True`` 时按「资产描述 → **本章 overlay** → 候选结构化资料 → 剧本片段」的顺序
    拼一段画像文本，空话兜底只在**四处都没有**时才可能出现。整个过程只读、
    查询次数与资产数量无关（候选与章节各一次查询）。

    ``chapter_id`` 决定"哪一章的资料"（**全局资产的章节隔离**）：

    - 给了 ``chapter_id``：只读该章的 overlay 与镜头依据 —— 场景/道具/服装这些
      **全局资产**的通用描述可能属于别的项目/章节，本章的剧情身份、出场依据、
      临时补充来自 overlay，不会互相污染；
    - 没给：按整个项目范围读（镜头级既有行为不变）。
    """
    profiles: list[EntityProfileInput] = []
    assets: list[tuple[str, Any]] = []

    character_rows = (
        (await db.execute(select(Character).where(Character.project_id == project_id).order_by(Character.id)))
        .scalars()
        .all()
    )
    assets.extend(("character", row) for row in character_rows)

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
    assets.extend(("scene", row) for row in scene_rows)

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
    assets.extend(("prop", row) for row in prop_rows)

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
    assets.extend(("costume", row) for row in costume_rows)

    enrichments: dict[tuple[str, str], tuple[str, str]] = {}
    if enrich:
        enrichments = await load_asset_profile_enrichments(db, project_id=project_id, chapter_id=chapter_id)

    for entity_type, row in assets:
        description = _clip(row.description, MAX_PROFILE_CHARS)
        enrichment_text, enrichment_source = enrichments.get(
            (entity_type, normalize_name(row.name)), ("", "")
        )
        merged = _merge_profile_segments(description, enrichment_text)
        if description and enrichment_source:
            profile_source = f"asset_description+{enrichment_source}"
        elif enrichment_source:
            profile_source = enrichment_source
        elif description:
            profile_source = "asset_description"
        else:
            profile_source = "none"
        profiles.append(
            EntityProfileInput(
                name=row.name,
                entity_type=entity_type,
                profile=_clip(merged, MAX_PROFILE_CHARS),
                profile_source=profile_source,
            )
        )

    return profiles[:limit]


async def load_asset_profile_enrichments(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str | None = None,
) -> dict[tuple[str, str], tuple[str, str]]:
    """装载「候选结构化资料 + 剧本片段」拼成的资产资料补充文本。

    返回 ``{(entity_type, 归一化名称): (文本, 来源标签)}``；没有补充资料时键不存在。

    来源标签（供页面「生成依据」如实显示这段资料是从哪来的）：

    - ``chapter_record``：**专用表** ``chapter_asset_profiles`` 里按项目 + 章节持久化保存的
      本章资料（数据库是事实来源：重启不丢、重新提取候选也不丢）；
    - ``chapter_overlay``：旧结构（候选 ``payload.chapter_overlay``，迁移前的历史数据）；
    - ``chapter_overlay+candidate_profile``：旧结构里 overlay 与候选结构化资料都有；
    - ``candidate_profile``：候选 payload 里的结构化资料；
    - ``script_window``：只从剧本摘录/章节原文取的上下文窗口（最弱的兜底）。

    数据来源（先读专用表，再回退既有列）：

    - ``chapter_asset_profiles``（**优先**）：结构化字段、出场镜头、剧本依据、人工修改；
    - ``shot_extracted_candidates.payload.asset_profile``（结构化字段，dict）
      → 由 :mod:`app.services.studio.asset_profiles` 的字段表渲染成 ``字段标签：值``；
    - ``payload.shot_refs`` → ``出场镜头 #1、#3``（"哪一段原文、哪个镜头"的直接体现）；
    - ``payload.evidence`` → 剧本原文片段（可追溯）；
    - **本章 overlay**（``payload.chapter_overlay``，由 ``asset_overlays`` 写入）：
      全局资产（场景/道具/服装）的章节资料**只存在这里**——剧情身份、本章字段、
      本章特有的时间/天气/光线/状态/场合、出场依据；``chapter_id`` 给定时只读本章的；
    - 兜底：候选 payload 里没有结构化资料时，用 ``shots.script_excerpt`` 里
      出现该名称的那一句作为剧本依据；连分镜都没有时，再去章节原文里取一个上下文窗口。
    """
    from app.services.studio.asset_profiles import (
        is_vague_text,
        normalize_asset_type,
        normalize_profile,
        render_profile_text,
    )

    # ``chapter_id`` 给定时，两张查询都收窄到本章 —— 全局资产的章节隔离靠这一步落地：
    # 别的章节写的 overlay / 镜头依据不会被这一章读到。
    candidate_stmt = (
        select(ShotExtractedCandidate)
        .join(Shot, Shot.id == ShotExtractedCandidate.shot_id)
        .join(Chapter, Chapter.id == Shot.chapter_id)
        .where(Chapter.project_id == project_id)
    )
    shot_stmt = (
        select(Shot, Chapter.project_id)
        .join(Chapter, Chapter.id == Shot.chapter_id)
        .where(Chapter.project_id == project_id)
    )
    chapter_select = select(Chapter).where(Chapter.project_id == project_id)
    if chapter_id:
        candidate_stmt = candidate_stmt.where(Shot.chapter_id == chapter_id)
        shot_stmt = shot_stmt.where(Shot.chapter_id == chapter_id)
        chapter_select = chapter_select.where(Chapter.id == chapter_id)

    candidate_rows = (
        (await db.execute(candidate_stmt.order_by(ShotExtractedCandidate.id).limit(MAX_CANDIDATE_SCAN)))
        .scalars()
        .all()
    )
    shots_by_id = {
        str(shot.id): shot for shot, _pid in (await db.execute(shot_stmt.order_by(Shot.index))).all()
    }
    chapter_rows = (await db.execute(chapter_select.order_by(Chapter.index))).scalars().all()
    chapter_text_by_id = {
        str(chapter.id): (str(chapter.condensed_text or "").strip() or str(chapter.raw_text or "").strip())
        for chapter in chapter_rows
    }

    result: dict[tuple[str, str], tuple[str, str]] = {}

    # ⓪ **专用表优先**（数据库是事实来源）：章节资产资料按项目 + 章节持久化保存，
    #    后端重启、重新提取候选都不会让它消失 —— 这是"图片提示词拿得到剧本资料"的主路径。
    #    旧结构（候选 payload）留作兜底，见下面 ① ②。
    from app.services.studio.chapter_asset_record_store import list_records_for_scope

    for record in await list_records_for_scope(db, project_id=project_id, chapter_id=chapter_id):
        entity_type = normalize_asset_type(record.asset_type)
        if entity_type is None:
            continue
        key = (entity_type, record.name_key or normalize_name(record.name))
        if key in result:
            continue
        text = _enrichment_from_record(
            record,
            shots_by_id=shots_by_id,
            chapter_text_by_id=chapter_text_by_id,
        )
        if text:
            result[key] = (text, "chapter_record")

    for row in candidate_rows:
        entity_type = normalize_asset_type(getattr(row.candidate_type, "value", row.candidate_type))
        name = str(row.candidate_name or "").strip()
        if entity_type is None or not name:
            continue
        key = (entity_type, normalize_name(name))
        if key in result:
            continue
        payload = row.payload if isinstance(row.payload, dict) else {}
        parts: list[str] = []

        # ① 本章 overlay 优先：全局资产的章节资料只存在这里（剧情身份 + 本章字段 +
        #    本章特有的时间/天气/光线/状态/场合 + 出场依据）。
        overlay_used = False
        candidate_used = False
        overlay = payload.get("chapter_overlay")
        if isinstance(overlay, dict) and _overlay_in_scope(overlay, chapter_id):
            from app.services.studio.asset_overlays import overlay_to_profile_text

            rendered_overlay = overlay_to_profile_text(overlay)
            if rendered_overlay and not is_vague_text(rendered_overlay):
                parts.append(rendered_overlay)
                overlay_used = True
            identity = str(overlay.get("plot_identity") or "").strip()
            if identity:
                parts.append(f"本章剧情身份：{identity}")
                overlay_used = True

        raw_profile = payload.get("asset_profile")
        if isinstance(raw_profile, dict):
            profile = normalize_profile(entity_type, raw_profile)
            rendered = render_profile_text(entity_type, profile)
            if rendered and not is_vague_text(rendered):
                parts.append(rendered)
                candidate_used = True
        if not parts:
            text = str(payload.get("asset_profile_text") or "").strip()
            if text and not is_vague_text(text):
                parts.append(text)
                candidate_used = True

        shot_refs = (overlay.get("shot_refs") if isinstance(overlay, dict) else None) or payload.get("shot_refs")
        labels: list[str] = []
        excerpts: list[str] = []
        if isinstance(shot_refs, list):
            for ref in shot_refs:
                if not isinstance(ref, dict):
                    continue
                index = ref.get("shot_index")
                if index:
                    labels.append(f"#{index}")
                excerpt = str(ref.get("script_excerpt") or "").strip()
                if excerpt and excerpt not in excerpts:
                    excerpts.append(excerpt)
        if not labels:
            # 兜底：候选表没记镜头，就按剧本摘录现算（同一章内的镜头序号）
            for shot in shots_by_id.values():
                haystack = normalize_name(getattr(shot, "script_excerpt", "") or "")
                if haystack and normalize_name(name) in haystack:
                    labels.append(f"#{getattr(shot, 'index', 0)}")
                    excerpt = str(getattr(shot, "script_excerpt", "") or "").strip()
                    if excerpt and excerpt not in excerpts:
                        excerpts.append(excerpt)
        if labels:
            parts.append("出场镜头：" + "、".join(labels[:12]))

        evidence = (overlay.get("evidence") if isinstance(overlay, dict) else None) or payload.get("evidence")
        if isinstance(evidence, list):
            for entry in evidence:
                snippet = ""
                if isinstance(entry, dict):
                    snippet = str(entry.get("snippet") or "").strip()
                elif isinstance(entry, str):
                    snippet = entry.strip()
                if snippet and snippet not in excerpts:
                    excerpts.append(snippet)
        if not excerpts:
            # 再兜底：直接在本章的剧本原文里取名称附近的一个窗口
            for text in chapter_text_by_id.values():
                window = _script_window(text, name)
                if window:
                    excerpts.append(window)
                    break
        if excerpts:
            parts.append("剧本依据：" + _clip("；".join(excerpts[:3]), SCRIPT_WINDOW_CHARS))

        merged = "；".join(part for part in parts if part)
        if merged:
            has_overlay = bool(overlay_used)
            has_candidate = bool(candidate_used)
            if has_overlay and has_candidate:
                source = "chapter_overlay+candidate_profile"
            elif has_overlay:
                source = "chapter_overlay"
            elif has_candidate:
                source = "candidate_profile"
            else:
                source = "script_window"
            result[key] = (_clip(merged, MAX_PROFILE_CHARS), source)

    return result


def _enrichment_from_record(
    record: Any,
    *,
    shots_by_id: dict[str, Any],
    chapter_text_by_id: dict[str, str],
) -> str:
    """把一条**持久化章节资料行**渲染成资产画像补充文本（与旧口径同形）。

    组成：结构化资料（含本章特有字段与剧情向字段）＋「本章剧情身份」＋「出场镜头」
    ＋「剧本依据」。空话（``is_vague_text``）一律不采用，交给下面的兜底路径。

    为什么单独一个函数：这段文本既进图片提示词，也是页面「生成依据」里"资料来源"
    那一行的依据，两处必须完全一致，所以只允许有一个实现。
    """
    from app.services.studio.asset_profiles import (
        is_vague_text,
        normalize_asset_type,
        render_profile_text,
    )
    from app.services.studio.chapter_asset_record_store import effective_profile

    entity_type = normalize_asset_type(record.asset_type)
    if entity_type is None:
        return ""
    asset_type = entity_type
    parts: list[str] = []
    rendered = render_profile_text(
        asset_type,
        effective_profile(record),
        include_evidence_fields=True,
    )
    if rendered and not is_vague_text(rendered):
        parts.append(rendered)
    identity = str(getattr(record, "plot_identity", "") or "").strip()
    if identity:
        parts.append(f"本章剧情身份：{identity}")

    labels: list[str] = []
    excerpts: list[str] = []
    for ref in list(getattr(record, "shot_refs", None) or []):
        if not isinstance(ref, dict):
            continue
        index = ref.get("shot_index")
        if index:
            labels.append(f"#{index}")
        excerpt = str(ref.get("script_excerpt") or "").strip()
        if excerpt and excerpt not in excerpts:
            excerpts.append(excerpt)
    if not labels:
        target = normalize_name(record.name)
        for shot in shots_by_id.values():
            haystack = normalize_name(getattr(shot, "script_excerpt", "") or "")
            if haystack and target and target in haystack:
                labels.append(f"#{getattr(shot, 'index', 0)}")
                excerpt = str(getattr(shot, "script_excerpt", "") or "").strip()
                if excerpt and excerpt not in excerpts:
                    excerpts.append(excerpt)
    if labels:
        parts.append("出场镜头：" + "、".join(labels[:12]))

    for entry in list(getattr(record, "evidence", None) or []):
        snippet = ""
        if isinstance(entry, dict):
            snippet = str(entry.get("snippet") or "").strip()
        elif isinstance(entry, str):
            snippet = entry.strip()
        if snippet and snippet not in excerpts:
            excerpts.append(snippet)
    if not excerpts:
        for text in chapter_text_by_id.values():
            window = _script_window(text, str(record.name or ""))
            if window:
                excerpts.append(window)
                break
    if excerpts:
        parts.append("剧本依据：" + _clip("；".join(excerpts[:3]), SCRIPT_WINDOW_CHARS))

    merged = "；".join(part for part in parts if part)
    if not merged or is_vague_text(merged):
        return ""
    return _clip(merged, MAX_PROFILE_CHARS)


def _script_window(text: str, needle: str) -> str:
    """在章节原文里取名称附近的一个上下文窗口（兜底用的"哪一段原文"）。"""
    source = str(text or "")
    target = str(needle or "").strip()
    if not source or not target:
        return ""
    index = source.find(target)
    if index < 0:
        return ""
    start = max(0, index - SCRIPT_WINDOW_CHARS // 2)
    end = min(len(source), index + len(target) + SCRIPT_WINDOW_CHARS // 2)
    return source[start:end].replace("\n", " ").strip()


def render_project_context(
    *,
    project_name: str = "",
    style: str = "",
    visual_style: str = "",
) -> str:
    """渲染项目上下文段落。"""
    lines: list[str] = []
    if project_name:
        lines.append(f"项目：{project_name}")
    if style:
        lines.append(f"题材风格：{style}")
    if visual_style:
        lines.append(f"画面表现形式：{visual_style}")
    return "\n".join(lines) if lines else "（无项目上下文）"
