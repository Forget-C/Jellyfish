"""镜头资产服务：镜头关联资产查询与项目资产 link 管理。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, paginate
from app.models.studio import (
    Actor,
    Character,
    Costume,
    Product,
    ProjectActorLink,
    ProjectCostumeLink,
    ProjectProductLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    Scene,
    Shot,
    ShotCharacterLink,
)
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio.shots import (
    ProjectAssetLinkCreate,
    ProjectActorLinkRead,
    ProjectCostumeLinkRead,
    ProjectProductLinkRead,
    ProjectPropLinkRead,
    ProjectSceneLinkRead,
    ShotLinkedAssetItem,
)
from app.services.common import delete_if_exists, entity_not_found, invalid_choice, require_entity
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.shot_extracted_candidates import mark_linked_by_name, mark_pending_by_name
from app.services.studio.entity_thumbnails import resolve_thumbnail_infos, resolve_thumbnails
from app.utils.project_links import upsert_project_link


def _link_spec(entity_type: str) -> dict[str, Any]:
    t = normalize_entity_type(entity_type)
    if t == "actor":
        return {
            "model": ProjectActorLink,
            "field": "actor_id",
            "read_model": ProjectActorLinkRead,
            "asset_model": Actor,
            "not_found": entity_not_found("Actor"),
        }
    if t == "scene":
        return {
            "model": ProjectSceneLink,
            "field": "scene_id",
            "read_model": ProjectSceneLinkRead,
            "asset_model": Scene,
            "not_found": entity_not_found("Scene"),
        }
    if t == "prop":
        return {
            "model": ProjectPropLink,
            "field": "prop_id",
            "read_model": ProjectPropLinkRead,
            "asset_model": Prop,
            "not_found": entity_not_found("Prop"),
        }
    if t == "costume":
        return {
            "model": ProjectCostumeLink,
            "field": "costume_id",
            "read_model": ProjectCostumeLinkRead,
            "asset_model": Costume,
            "not_found": entity_not_found("Costume"),
        }
    if t == "product":
        return {
            "model": ProjectProductLink,
            "field": "product_id",
            "read_model": ProjectProductLinkRead,
            "asset_model": Product,
            "not_found": entity_not_found("Product"),
        }
    raise HTTPException(
        status_code=400,
        detail=invalid_choice(
            "entity_type", ["actor", "scene", "prop", "costume", "product"]
        ),
    )


async def create_project_asset_link(
    db: AsyncSession,
    *,
    entity_type: str,
    body: ProjectAssetLinkCreate,
) -> Any:
    """创建或补全项目-章节-镜头-资产关联。"""
    spec = _link_spec(entity_type)
    await require_entity(
        db,
        spec["asset_model"],
        body.asset_id,
        detail=spec["not_found"],
        status_code=400,
    )
    asset_obj = await db.get(spec["asset_model"], body.asset_id)
    row = await upsert_project_link(
        db,
        model=spec["model"],
        asset_field=spec["field"],
        asset_id=body.asset_id,
        project_id=body.project_id,
        chapter_id=body.chapter_id,
        shot_id=body.shot_id,
    )
    candidate_type = {"scene": "scene", "prop": "prop", "costume": "costume"}.get(entity_type)
    if body.shot_id and candidate_type and asset_obj is not None and getattr(asset_obj, "name", None):
        await mark_linked_by_name(
            db,
            shot_id=body.shot_id,
            candidate_type=candidate_type,
            candidate_name=str(asset_obj.name),
            linked_entity_id=body.asset_id,
        )
    return row


async def delete_project_asset_link(
    db: AsyncSession,
    *,
    entity_type: str,
    link_id: int,
) -> None:
    """删除项目-章节-镜头-资产关联。"""
    spec = _link_spec(entity_type)
    row = await db.get(spec["model"], link_id)
    if row is None:
        return
    shot_id = getattr(row, "shot_id", None)
    asset_id = getattr(row, spec["field"], None)
    asset_obj = await db.get(spec["asset_model"], asset_id) if asset_id else None
    await delete_if_exists(db, spec["model"], link_id)
    candidate_type = {"scene": "scene", "prop": "prop", "costume": "costume"}.get(entity_type)
    if shot_id and candidate_type and asset_obj is not None and getattr(asset_obj, "name", None):
        await mark_pending_by_name(
            db,
            shot_id=str(shot_id),
            candidate_type=candidate_type,
            candidate_name=str(asset_obj.name),
        )


async def list_shot_linked_assets(
    db: AsyncSession,
    *,
    shot_id: str,
) -> list[ShotLinkedAssetItem]:
    """获取镜头关联的角色/道具/场景/服装。"""
    await require_entity(db, Shot, shot_id, detail=entity_not_found("Shot"), status_code=400)

    character_ids = (
        await db.execute(select(ShotCharacterLink.character_id).where(ShotCharacterLink.shot_id == shot_id))
    ).scalars().all()
    prop_ids = (
        await db.execute(select(ProjectPropLink.prop_id).where(ProjectPropLink.shot_id == shot_id))
    ).scalars().all()
    scene_ids = (
        await db.execute(select(ProjectSceneLink.scene_id).where(ProjectSceneLink.shot_id == shot_id))
    ).scalars().all()
    costume_ids = (
        await db.execute(select(ProjectCostumeLink.costume_id).where(ProjectCostumeLink.shot_id == shot_id))
    ).scalars().all()

    character_ids = [x for x in dict.fromkeys(character_ids) if x]
    prop_ids = [x for x in dict.fromkeys(prop_ids) if x]
    scene_ids = [x for x in dict.fromkeys(scene_ids) if x]
    costume_ids = [x for x in dict.fromkeys(costume_ids) if x]

    character_rows = []
    if character_ids:
        character_rows = (
            await db.execute(select(Character.id, Character.name).where(Character.id.in_(character_ids)))
        ).all()
    prop_rows = []
    if prop_ids:
        prop_rows = (await db.execute(select(Prop.id, Prop.name).where(Prop.id.in_(prop_ids)))).all()
    scene_rows = []
    if scene_ids:
        scene_rows = (await db.execute(select(Scene.id, Scene.name).where(Scene.id.in_(scene_ids)))).all()
    costume_rows = []
    if costume_ids:
        costume_rows = (
            await db.execute(select(Costume.id, Costume.name).where(Costume.id.in_(costume_ids)))
        ).all()

    character_name = {str(r[0]): str(r[1]) for r in character_rows}
    prop_name = {str(r[0]): str(r[1]) for r in prop_rows}
    scene_name = {str(r[0]): str(r[1]) for r in scene_rows}
    costume_name = {str(r[0]): str(r[1]) for r in costume_rows}

    character_thumb = await resolve_thumbnail_infos(
        db,
        image_model=entity_spec("character").image_model,
        parent_field_name="character_id",
        parent_ids=list(character_name.keys()),
    )
    prop_thumb = await resolve_thumbnail_infos(
        db,
        image_model=entity_spec("prop").image_model,
        parent_field_name="prop_id",
        parent_ids=list(prop_name.keys()),
    )
    scene_thumb = await resolve_thumbnail_infos(
        db,
        image_model=entity_spec("scene").image_model,
        parent_field_name="scene_id",
        parent_ids=list(scene_name.keys()),
    )
    costume_thumb = await resolve_thumbnail_infos(
        db,
        image_model=entity_spec("costume").image_model,
        parent_field_name="costume_id",
        parent_ids=list(costume_name.keys()),
    )

    items: list[ShotLinkedAssetItem] = []
    for cid, name in character_name.items():
        info = character_thumb.get(cid) or {}
        items.append(
            ShotLinkedAssetItem(
                type="character",
                id=cid,
                image_id=info.get("image_id"),
                file_id=info.get("file_id"),
                name=name,
                thumbnail=str(info.get("thumbnail") or ""),
            )
        )
    for pid, name in prop_name.items():
        info = prop_thumb.get(pid) or {}
        items.append(
            ShotLinkedAssetItem(
                type="prop",
                id=pid,
                image_id=info.get("image_id"),
                file_id=info.get("file_id"),
                name=name,
                thumbnail=str(info.get("thumbnail") or ""),
            )
        )
    for sid, name in scene_name.items():
        info = scene_thumb.get(sid) or {}
        items.append(
            ShotLinkedAssetItem(
                type="scene",
                id=sid,
                image_id=info.get("image_id"),
                file_id=info.get("file_id"),
                name=name,
                thumbnail=str(info.get("thumbnail") or ""),
            )
        )
    for coid, name in costume_name.items():
        info = costume_thumb.get(coid) or {}
        items.append(
            ShotLinkedAssetItem(
                type="costume",
                id=coid,
                image_id=info.get("image_id"),
                file_id=info.get("file_id"),
                name=name,
                thumbnail=str(info.get("thumbnail") or ""),
            )
        )

    items.sort(key=lambda x: (x.type, x.name, x.id))
    return items


async def list_shot_linked_assets_paginated(
    db: AsyncSession,
    *,
    shot_id: str,
    page: int,
    page_size: int,
) -> ApiResponse[PaginatedData[ShotLinkedAssetItem]]:
    """获取镜头关联的角色/道具/场景/服装（分页）。"""
    items = await list_shot_linked_assets(db, shot_id=shot_id)
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return paginated_response(items[start:end], page=page, page_size=page_size, total=total)


async def list_project_asset_links_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    project_id: str | None,
    chapter_id: str | None,
    shot_id: str | None,
    asset_id: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    allow_fields: set[str],
) -> ApiResponse[PaginatedData[Any]]:
    """查询项目-章节-镜头-实体关联列表（分页）。"""
    spec = _link_spec(entity_type)
    model = spec["model"]
    field_name = spec["field"]

    stmt = select(model)
    if project_id is not None:
        stmt = stmt.where(model.project_id == project_id)
    if chapter_id is not None:
        stmt = stmt.where(model.chapter_id == chapter_id)
    if shot_id is not None:
        stmt = stmt.where(model.shot_id == shot_id)
    if asset_id is not None:
        stmt = stmt.where(getattr(model, field_name) == asset_id)
    stmt = apply_order(
        stmt,
        model=model,
        order=order,
        is_desc=is_desc,
        allow_fields=allow_fields,
        default="id",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    es = entity_spec(entity_type)
    ids = [getattr(x, field_name) for x in items if getattr(x, field_name, None)]
    thumbnails = await resolve_thumbnails(
        db,
        image_model=es.image_model,
        parent_field_name=es.id_field,
        parent_ids=ids,
    )
    read_model = spec["read_model"]
    payload = [
        read_model.model_validate(x).model_copy(update={"thumbnail": thumbnails.get(getattr(x, field_name), "")})
        for x in items
    ]
    return paginated_response(payload, page=page, page_size=page_size, total=total)
