"""由镜头关联（project_*_link、ShotCharacterLink、演员表等）拼装 StudioScriptExtractionDraft。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.studio import (
    Actor,
    Chapter,
    Character,
    CharacterImage,
    CharacterPropLink,
    Costume,
    CostumeImage,
    ProjectActorLink,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    PropImage,
    Scene,
    SceneImage,
    Shot,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
)
from app.services.common import entity_not_found
from app.services.studio.entity_thumbnails import resolve_thumbnail_infos
from app.schemas.skills.script_processing import (
    ShotSemanticSuggestion,
    StudioActorDraft, StudioSceneDraft, StudioPropDraft, StudioCostumeDraft,
    StudioCharacterDraft,
    StudioScriptExtractionDraft,
    StudioShotDraft,
    StudioShotDraftDialogueLine,
)


def _dialogue_line_mode_str(mode: Any) -> str:
    if mode is None:
        return "DIALOGUE"
    v = getattr(mode, "value", mode)
    return str(v)


async def build_script_extraction_draft_for_shot(db: AsyncSession, shot_id: str) -> StudioScriptExtractionDraft:
    shot = await db.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Shot"))
    chapter = await db.get(Chapter, shot.chapter_id)
    if chapter is None:
        raise HTTPException(status_code=400, detail=f"{entity_not_found('Chapter')} for shot")
    project_id = chapter.project_id
    script_text = (chapter.condensed_text or chapter.raw_text or "").strip()

    detail = await db.get(ShotDetail, shot_id)

    # ---------- ShotCharacterLink -> characters ----------
    scl_rows = (
        (
            await db.execute(
                select(ShotCharacterLink).where(ShotCharacterLink.shot_id == shot_id).order_by(ShotCharacterLink.index)
            )
        )
        .scalars()
        .all()
    )
    index_by_character_id: dict[str, int] = {str(r.character_id): int(r.index) for r in scl_rows}
    char_ids_ordered = [r.character_id for r in scl_rows]
    characters: list[Character] = []
    if char_ids_ordered:
        characters = (
            (
                await db.execute(
                    select(Character)
                    .where(Character.id.in_(char_ids_ordered))
                    .options(
                        selectinload(Character.costume),
                        selectinload(Character.actor),
                        selectinload(Character.prop_links).selectinload(CharacterPropLink.prop),
                    )
                )
            )
            .scalars()
            .all()
        )
    char_by_id: dict[str, Character] = {c.id: c for c in characters}
    # preserve shot order
    ordered_chars = [char_by_id[cid] for cid in char_ids_ordered if cid in char_by_id]

    character_media = await resolve_thumbnail_infos(
        db,
        image_model=CharacterImage,
        parent_field_name="character_id",
        parent_ids=[c.id for c in ordered_chars],
    )

    character_drafts: list[StudioCharacterDraft] = []
    used_actor_ids: set[str] = set()
    for ch in ordered_chars:
        if ch.actor_id:
            used_actor_ids.add(ch.actor_id)
        costume_name: str | None = None
        if ch.costume_id and ch.costume is not None:
            costume_name = ch.costume.name
        prop_names: list[str] = []
        if ch.prop_links:
            links_sorted = sorted(ch.prop_links, key=lambda x: x.index)
            for pl in links_sorted:
                if pl.prop is not None:
                    prop_names.append(pl.prop.name)
        character_drafts.append(
            StudioCharacterDraft(
                id=ch.id,
                file_id=character_media.get(ch.id, {}).get("file_id"),
                thumbnail=character_media.get(ch.id, {}).get("thumbnail"),
                index=index_by_character_id.get(ch.id),
                name=ch.name,
                description=ch.description or "",
                actor=StudioActorDraft.model_validate(ch.actor, from_attributes=True) if ch.actor else None,
                tags=[],  # Character 表无 tags，占位与导入草稿对齐
                costume_name=costume_name,
                prop_names=prop_names,
            )
        )

    # ---------- ProjectActorLink（镜头级演员）：补充未由分镜角色覆盖的演员 ----------
    pa_actor_ids = (
        (
            await db.execute(
                select(ProjectActorLink.actor_id).where(
                    ProjectActorLink.shot_id == shot_id,
                    ProjectActorLink.project_id == project_id,
                )
            )
        )
        .scalars()
        .all()
    )
    pa_actor_ids = list(dict.fromkeys([x for x in pa_actor_ids if x]))
    extra_actor_ids = [aid for aid in pa_actor_ids if aid not in used_actor_ids]
    if extra_actor_ids:
        actors = (await db.execute(select(Actor).where(Actor.id.in_(extra_actor_ids)))).scalars().all()
        actor_by_id = {a.id: a for a in actors}
        for aid in extra_actor_ids:
            act = actor_by_id.get(aid)
            if act is None:
                continue
            character_drafts.append(
                StudioCharacterDraft(
                    id=None,
                    file_id=None,
                    thumbnail=None,
                    index=None,
                    name=act.name,
                    description=act.description or "",
                    actor=StudioActorDraft.model_validate(act, from_attributes=True),
                    tags=list(act.tags or []),
                    costume_name=None,
                    prop_names=[],
                )
            )

    # ---------- Project*Link @ shot（保序去重） ----------
    psl_rows = (
        (
            await db.execute(
                select(ProjectSceneLink).where(
                    ProjectSceneLink.shot_id == shot_id,
                    ProjectSceneLink.project_id == project_id,
                ).order_by(ProjectSceneLink.id)
            )
        )
        .scalars()
        .all()
    )
    scene_ids: list[str] = list(dict.fromkeys([x.scene_id for x in psl_rows if x.scene_id]))
    if detail is not None and detail.scene_id and detail.scene_id not in scene_ids:
        scene_ids.append(detail.scene_id)

    ppl_rows = (
        (
            await db.execute(
                select(ProjectPropLink).where(
                    ProjectPropLink.shot_id == shot_id,
                    ProjectPropLink.project_id == project_id,
                ).order_by(ProjectPropLink.id)
            )
        )
        .scalars()
        .all()
    )
    prop_ids = list(dict.fromkeys([x.prop_id for x in ppl_rows if x.prop_id]))

    pcl_rows = (
        (
            await db.execute(
                select(ProjectCostumeLink).where(
                    ProjectCostumeLink.shot_id == shot_id,
                    ProjectCostumeLink.project_id == project_id,
                ).order_by(ProjectCostumeLink.id)
            )
        )
        .scalars()
        .all()
    )
    costume_ids = list(dict.fromkeys([x.costume_id for x in pcl_rows if x.costume_id]))

    scene_media = await resolve_thumbnail_infos(
        db,
        image_model=SceneImage,
        parent_field_name="scene_id",
        parent_ids=scene_ids,
    )
    prop_media = await resolve_thumbnail_infos(
        db,
        image_model=PropImage,
        parent_field_name="prop_id",
        parent_ids=prop_ids,
    )
    costume_media = await resolve_thumbnail_infos(
        db,
        image_model=CostumeImage,
        parent_field_name="costume_id",
        parent_ids=costume_ids,
    )

    scene_drafts: list[StudioSceneDraft] = []
    if scene_ids:
        scenes = (await db.execute(select(Scene).where(Scene.id.in_(scene_ids)))).scalars().all()
        scene_by_id = {s.id: s for s in scenes}
        for sid in scene_ids:
            s = scene_by_id.get(sid)
            if s is None:
                continue
            scene_drafts.append(
                StudioSceneDraft(
                    id=s.id,
                    file_id=scene_media.get(s.id, {}).get("file_id"),
                    thumbnail=scene_media.get(s.id, {}).get("thumbnail"),
                    name=s.name,
                    description=s.description or "",
                    supplementary_info=s.supplementary_info,
                    **{key: getattr(s, key) for key, _ in s.description_fields},
                    tags=list(s.tags or []),
                    prompt_template_id=s.prompt_template_id,
                    view_count=int(s.view_count or 1),
                )
            )
        scene_drafts.sort(key=lambda x: x.name)

    prop_drafts: list[StudioPropDraft] = []
    if prop_ids:
        props = (await db.execute(select(Prop).where(Prop.id.in_(prop_ids)))).scalars().all()
        prop_by_id = {p.id: p for p in props}
        for pid in prop_ids:
            p = prop_by_id.get(pid)
            if p is None:
                continue
            prop_drafts.append(
                StudioPropDraft(
                    id=p.id,
                    file_id=prop_media.get(p.id, {}).get("file_id"),
                    thumbnail=prop_media.get(p.id, {}).get("thumbnail"),
                    name=p.name,
                    description=p.description or "",
                    supplementary_info=p.supplementary_info,
                    **{key: getattr(p, key) for key, _ in p.description_fields},
                    tags=list(p.tags or []),
                    prompt_template_id=p.prompt_template_id,
                    view_count=int(p.view_count or 1),
                )
            )
        prop_drafts.sort(key=lambda x: x.name)

    costume_drafts: list[StudioCostumeDraft] = []
    if costume_ids:
        costumes = (await db.execute(select(Costume).where(Costume.id.in_(costume_ids)))).scalars().all()
        costume_by_id = {c.id: c for c in costumes}
        for cid in costume_ids:
            c = costume_by_id.get(cid)
            if c is None:
                continue
            costume_drafts.append(
                StudioCostumeDraft(
                    id=c.id,
                    file_id=costume_media.get(c.id, {}).get("file_id"),
                    thumbnail=costume_media.get(c.id, {}).get("thumbnail"),
                    name=c.name,
                    description=c.description or "",
                    supplementary_info=c.supplementary_info,
                    **{key: getattr(c, key) for key, _ in c.description_fields},
                    tags=list(c.tags or []),
                    prompt_template_id=c.prompt_template_id,
                    view_count=int(c.view_count or 1),
                )
            )
        costume_drafts.sort(key=lambda x: x.name)

    # ---------- 对白 ----------
    id_to_name: dict[str, str] = {c.id: c.name for c in ordered_chars}
    dialogue_lines: list[StudioShotDraftDialogueLine] = []
    if detail is not None:
        dl_rows = (
            (
                await db.execute(
                    select(ShotDialogLine)
                    .where(ShotDialogLine.shot_detail_id == shot_id)
                    .order_by(ShotDialogLine.index)
                )
            )
            .scalars()
            .all()
        )
        for line in dl_rows:
            sp = line.speaker_name
            if not sp and line.speaker_character_id:
                sp = id_to_name.get(line.speaker_character_id)
            tg = line.target_name
            if not tg and line.target_character_id:
                tg = id_to_name.get(line.target_character_id)
            dialogue_lines.append(
                StudioShotDraftDialogueLine(
                    index=int(line.index or 0),
                    text=line.text,
                    line_mode=_dialogue_line_mode_str(line.line_mode),
                    speaker_name=sp,
                    target_name=tg,
                )
            )

    # ---------- 单镜 StudioShotDraft ----------
    scene_name: str | None = None
    if detail is not None and detail.scene_id:
        sc = await db.get(Scene, detail.scene_id)
        if sc is not None:
            scene_name = sc.name
    if scene_name is None and scene_drafts:
        scene_name = scene_drafts[0].name

    prop_names_shot: list[str] = []
    if prop_ids:
        props = (await db.execute(select(Prop).where(Prop.id.in_(prop_ids)))).scalars().all()
        pmap = {p.id: p.name for p in props}
        prop_names_shot = [pmap[pid] for pid in prop_ids if pid in pmap]

    costume_names_shot: list[str] = []
    if costume_ids:
        costumes = (await db.execute(select(Costume).where(Costume.id.in_(costume_ids)))).scalars().all()
        cmap = {c.id: c.name for c in costumes}
        costume_names_shot = [cmap[cid] for cid in costume_ids if cid in cmap]

    actions: list[str] = []
    if detail is not None:
        if detail.description and detail.description.strip():
            actions = [detail.description.strip()]
        elif detail.atmosphere and detail.atmosphere.strip():
            actions = [detail.atmosphere.strip()]

    shot_draft = StudioShotDraft(
        index=int(shot.index),
        title=shot.title,
        script_excerpt=shot.script_excerpt or "",
        scene_name=scene_name,
        character_names=[c.name for c in ordered_chars],
        prop_names=prop_names_shot,
        costume_names=costume_names_shot,
        dialogue_lines=dialogue_lines,
        actions=actions,
        semantic_suggestion=ShotSemanticSuggestion(
            camera_shot=getattr(detail, "camera_shot", None) if detail is not None else None,
            angle=getattr(detail, "angle", None) if detail is not None else None,
            movement=getattr(detail, "movement", None) if detail is not None else None,
            duration=getattr(detail, "duration", None) if detail is not None else None,
            action_beats=list(getattr(detail, "action_beats", []) or []) if detail is not None else [],
            notes=None,
        ),
    )

    return StudioScriptExtractionDraft(
        project_id=project_id,
        chapter_id=chapter.id,
        script_text=script_text,
        characters=character_drafts,
        scenes=scene_drafts,
        props=prop_drafts,
        costumes=costume_drafts,
        shots=[shot_draft],
    )
