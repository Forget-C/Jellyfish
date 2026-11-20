"""Studio 实体主资源 CRUD。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import case, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.models.studio import Chapter, Project
from app.services.common import entity_already_exists, entity_not_found
from app.services.studio.entity_specs import DEFAULT_VIEW_ANGLES, LINK_MODEL_BY_ENTITY, entity_spec, normalize_entity_type
from app.services.studio.entity_thumbnails import resolve_thumbnails
from app.utils.project_links import upsert_project_link

ENTITY_ORDER_FIELDS = {"name", "style", "visual_style", "created_at", "updated_at"}


def _asset_read_payload(obj: Any, thumbnail: str) -> dict[str, Any]:
    """返回分类字段和派生摘要，供通用资产列表及编辑页复用。"""
    return {
        "id": obj.id,
        "origin": obj.origin, "source_kind": obj.source_kind, "source_id": obj.source_id,
        "details_editable": obj.details_editable,
        "created_at": obj.created_at,
        "project_id": obj.project_id,
        "library_copy_id": obj.library_copy_id,
        "references": obj.references,
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
    project_id: str | None = None,
    exact_name: str | None = None,
    source: list[str] | None = None,
    has_cover: bool | None = None,
) -> tuple[list[dict[str, Any]], int]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    stmt = select(spec.model)
    stmt = stmt.where(spec.model.project_id == project_id)
    if exact_name is not None:
        stmt = stmt.where(spec.model.name == exact_name.strip())
    stmt = apply_keyword_filter(stmt, q=q, fields=[spec.model.name, spec.model.description])
    if source:
        # Match the source label on cards, where a converted actor has precedence over origin.
        card_source = spec.model.origin
        if entity_type_norm == "actor":
            card_source = case((spec.model.source_character_id.is_not(None), "role_conversion"), else_=card_source)
        stmt = stmt.where(card_source.in_(source))
    if has_cover is not None:
        image_parent = getattr(spec.image_model, spec.id_field)
        cover_exists = select(image_parent).where(
            image_parent == spec.model.id, spec.image_model.file_id != "",
        ).exists()
        stmt = stmt.where(cover_exists if has_cover else ~cover_exists)
    if style:
        stmt = stmt.where(spec.model.style == style)
    if visual_style:
        stmt = stmt.where(spec.model.visual_style == visual_style)
    stmt = apply_order(
        stmt,
        model=spec.model,
        order=order,
        is_desc=is_desc,
        allow_fields=ENTITY_ORDER_FIELDS,
        default="created_at",
    )
    library_order = project_id is None and entity_type_norm in {"actor", "scene", "prop", "costume"}
    project_resource_order = project_id is not None and order == "created_at" and is_desc
    if library_order or project_resource_order:
        stmt = stmt.order_by(spec.model.id)
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
    adopt_reference = data.pop("adopt_reference", None)

    link_project_id: str | None = None
    link_chapter_id: str | None = None
    if entity_type_norm in LINK_MODEL_BY_ENTITY:
        link_project_id = data.get("project_id")
        link_chapter_id = data.pop("chapter_id", None)
    elif entity_type_norm == "character":
        link_project_id = data.get("project_id")
        link_chapter_id = data.pop("chapter_id", None)

    if link_project_id is not None and await db.get(Project, link_project_id) is None:
        raise HTTPException(status_code=400, detail=entity_not_found("Project"))
    duplicate = await db.scalar(select(spec.model.id).where(
        spec.model.name == data["name"], spec.model.project_id == link_project_id,
    ))
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="当前范围内已存在同名对象")
    exists = await db.get(spec.model, data["id"])
    if exists is not None:
        raise HTTPException(status_code=400, detail=entity_already_exists(spec.model.__name__))

    if entity_type_norm == "character":
        if await db.get(Project, data["project_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Project"))
        chapter: Chapter | None = None
        if link_chapter_id is not None:
            chapter = await db.get(Chapter, link_chapter_id)
            if chapter is None:
                raise HTTPException(status_code=400, detail=entity_not_found("Chapter"))
            if chapter.project_id != data["project_id"]:
                raise HTTPException(status_code=400, detail="Chapter does not belong to the same project")

    from app.services.studio.resource_references import validate_resource_references
    await validate_resource_references(db, entity_type_norm, link_project_id, data.get("references", []))
    obj = spec.model(**data)
    db.add(obj)
    await flush_resource(db)
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

    if adopt_reference is not None:
        from app.services.studio.resource_image_copies import adopt_reference_main
        await adopt_reference_main(db, entity_type=entity_type_norm, entity_id=obj.id, reference=adopt_reference)
        return await get_entity(db, entity_type=entity_type_norm, entity_id=obj.id)

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
    opening = update_data.pop("details_editable", None)
    can_open = bool(getattr(obj, "source_character_id", None)) or obj.origin == "upload"
    if opening is not None and (opening is not True or not can_open):
        raise HTTPException(422, "详情开放后不能重新锁定")
    if can_open and not obj.details_editable and opening is not True:
        raise HTTPException(403, "请先确认开放详情")
    if opening is True:
        obj.details_editable = True
    if obj.origin != "created" and not getattr(obj, "details_editable", False) and set(update_data) - {"name"}:
        raise HTTPException(403, "图片来源对象仅允许修改名称")
    if obj.origin != "created" and "name" in update_data:
        name = update_data["name"]
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
            raise HTTPException(422, "名称不能为空且不能超过255字符")
        update_data["name"] = name.strip()
    if obj.origin == "created" and any(key in update_data and update_data[key] is None for key in ("style", "visual_style")):
        raise HTTPException(422, "设定创建对象需要保留风格")
    if "references" in update_data:
        from app.services.studio.resource_references import validate_resource_references
        await validate_resource_references(db, entity_type_norm, obj.project_id, update_data["references"])

    for key, value in update_data.items():
        setattr(obj, key, value)
    await flush_resource(db)
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
    entity_type = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        return
    if obj.origin != "created" and obj.project_id is None:
        for kind in ("actor", "character", "scene", "prop", "costume"):
            model = entity_spec(kind).model
            configurations = await db.scalars(select(model.references))
            if any(reference.get("source_kind") == entity_type and reference.get("source_id") == entity_id
                   for references in configurations for reference in references):
                raise HTTPException(409, "演员仍被对象直接参考，请先解除参考")
    if obj.project_id is None:
        # 删除独立副本后，原项目对象可再次明确入库。
        for kind in (("actor", "character") if entity_type == "actor" else (entity_type,)):
            model = entity_spec(kind).model
            await db.execute(update(model).where(model.library_copy_id == entity_id).values(library_copy_id=None))
    await db.delete(obj)
    await db.flush()


async def flush_resource(db: AsyncSession) -> None:
    """将唯一约束竞争转换为可修正的业务冲突。"""
    try:
        await db.flush()
    except IntegrityError as error:
        code = getattr(error.orig, "sqlite_errorcode", None)
        args = getattr(error.orig, "args", ())
        if code in {1555, 2067} or args and args[0] == 1062:
            raise HTTPException(409, "当前范围内已存在同名对象或重复身份") from error
        raise
