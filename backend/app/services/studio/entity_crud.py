"""Studio 实体主资源 CRUD。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.models.studio import Actor, Chapter, Costume, Project
from app.services.common import entity_already_exists, entity_not_found
from app.services.studio.entity_specs import DEFAULT_VIEW_ANGLES, LINK_MODEL_BY_ENTITY, entity_spec, normalize_entity_type
from app.services.studio.entity_thumbnails import resolve_thumbnails
from app.utils.project_links import upsert_project_link

ENTITY_ORDER_FIELDS = {"name", "style", "visual_style", "created_at", "updated_at"}


def _asset_read_payload(obj: Any, thumbnail: str) -> dict[str, Any]:
    """返回分类字段和派生摘要，供通用资产列表及编辑页复用。"""
    return {
        "id": obj.id,
        "name": obj.name,
        "description": obj.description,
        "supplementary_info": obj.supplementary_info,
        **{field: getattr(obj, field) for field, _ in obj.description_fields},
        "tags": obj.tags or [],
        "prompt_template_id": obj.prompt_template_id,
        "view_count": obj.view_count,
        "style": obj.style,
        "visual_style": obj.visual_style,
        "thumbnail": thumbnail,
    }


async def list_entities_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    q: str | None,
    style: str | None,
    visual_style: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    stmt = select(spec.model)
    stmt = apply_keyword_filter(stmt, q=q, fields=[spec.model.name, spec.model.description])
    if style:
        stmt = stmt.where(getattr(spec.model, "style") == style)
    if visual_style:
        stmt = stmt.where(getattr(spec.model, "visual_style") == visual_style)
    stmt = apply_order(
        stmt,
        model=spec.model,
        order=order,
        is_desc=is_desc,
        allow_fields=ENTITY_ORDER_FIELDS,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    thumbnails = await resolve_thumbnails(
        db,
        image_model=spec.image_model,
        parent_field_name=spec.id_field,
        parent_ids=[item.id for item in items],
    )
    payload: list[dict[str, Any]] = []
    for item in items:
        thumbnail = thumbnails.get(item.id, "")
        if entity_type_norm in {"actor", "character"}:
            read_model = spec.read_model
            payload.append(read_model.model_validate(item).model_copy(update={"thumbnail": thumbnail}).model_dump())
        else:
            payload.append(_asset_read_payload(item, thumbnail))
    return payload, total


async def create_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    parsed = spec.create_model.model_validate(body)
    data = parsed.model_dump()

    link_project_id: str | None = None
    link_chapter_id: str | None = None
    if entity_type_norm in LINK_MODEL_BY_ENTITY:
        link_project_id = data.pop("project_id", None)
        link_chapter_id = data.pop("chapter_id", None)
    elif entity_type_norm == "character":
        link_project_id = data.get("project_id")
        link_chapter_id = data.pop("chapter_id", None)

    exists = await db.get(spec.model, data["id"])
    if exists is not None:
        raise HTTPException(status_code=400, detail=entity_already_exists(spec.model.__name__))

    if entity_type_norm == "character":
        if await db.get(Project, data["project_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Project"))
        if data.get("actor_id") and await db.get(Actor, data["actor_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Actor"))
        if data.get("costume_id") and await db.get(Costume, data["costume_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Costume"))
        chapter: Chapter | None = None
        if link_chapter_id is not None:
            chapter = await db.get(Chapter, link_chapter_id)
            if chapter is None:
                raise HTTPException(status_code=400, detail=entity_not_found("Chapter"))
            if chapter.project_id != data["project_id"]:
                raise HTTPException(status_code=400, detail="Chapter does not belong to the same project")

    obj = spec.model(**data)
    db.add(obj)
    await db.flush()
    await db.refresh(obj)

    if entity_type_norm in {"actor", "scene", "prop", "costume"}:
        count = int(getattr(obj, "view_count", 1) or 1)
        angles = list(DEFAULT_VIEW_ANGLES[: min(max(count, 0), len(DEFAULT_VIEW_ANGLES))])
        for angle in angles:
            db.add(spec.image_model(**{spec.id_field: obj.id, "view_angle": angle}))
        if angles:
            await db.flush()

    if link_project_id is not None and entity_type_norm in LINK_MODEL_BY_ENTITY:
        link_model, asset_field = LINK_MODEL_BY_ENTITY[entity_type_norm]
        await upsert_project_link(
            db,
            model=link_model,
            asset_field=asset_field,  # type: ignore[arg-type]
            asset_id=obj.id,
            project_id=link_project_id,
            chapter_id=link_chapter_id,
        )

    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        payload = read_model.model_validate(obj).model_dump()
        payload["thumbnail"] = ""
        return payload
    return _asset_read_payload(obj, "")


async def get_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    thumbnails = await resolve_thumbnails(
        db,
        image_model=spec.image_model,
        parent_field_name=spec.id_field,
        parent_ids=[entity_id],
    )
    thumbnail = thumbnails.get(entity_id, "")
    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        return read_model.model_validate(obj).model_copy(update={"thumbnail": thumbnail}).model_dump()
    return _asset_read_payload(obj, thumbnail)


async def update_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    update_data = spec.update_model.model_validate(body).model_dump(exclude_unset=True)
    if entity_type_norm == "character":
        if "project_id" in update_data and await db.get(Project, update_data["project_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Project"))
        if "actor_id" in update_data and update_data["actor_id"] is not None and await db.get(Actor, update_data["actor_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Actor"))
        if "costume_id" in update_data and update_data["costume_id"] is not None and await db.get(Costume, update_data["costume_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Costume"))

    for key, value in update_data.items():
        setattr(obj, key, value)
    await db.flush()
    await db.refresh(obj)

    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        payload = read_model.model_validate(obj).model_dump()
        payload["thumbnail"] = ""
        return payload
    return _asset_read_payload(obj, "")


async def delete_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
) -> None:
    spec = entity_spec(entity_type)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        return
    await db.delete(obj)
    await db.flush()
