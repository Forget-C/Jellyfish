"""Studio 实体图片 CRUD。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, paginate
from app.services.common import entity_not_found
from app.services.studio.files import require_available_file
from app.services.studio.entity_specs import entity_spec, normalize_entity_type

IMAGE_ORDER_FIELDS = {"id", "quality_level", "view_angle", "created_at", "updated_at"}


async def list_entity_images_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    spec = entity_spec(entity_type)
    parent = await db.scalar(select(spec.model).where(spec.model.id == entity_id))
    if parent is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    id_field = getattr(spec.image_model, spec.id_field)
    stmt = select(spec.image_model).where(id_field == entity_id)
    stmt = apply_order(
        stmt,
        model=spec.image_model,
        order=order,
        is_desc=is_desc,
        allow_fields=IMAGE_ORDER_FIELDS,
        default="id",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    payload = [spec.image_read_model.model_validate(x).model_dump() for x in items]
    return payload, total


async def create_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """保存实体图片，锁定新增文件引用以避免采用正在删除的内容。"""
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    parent = await db.scalar(select(spec.model).where(spec.model.id == entity_id).with_for_update())
    if parent is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    if getattr(parent, "source_character_id", None):
        raise HTTPException(403, "从角色转化的演员只能被引用")

    parsed = _parse_image_body(spec.image_create_model, body).model_dump()
    if parsed.get("file_id") is not None:
        await require_available_file(db, file_id=parsed["file_id"], expected_type="image")
    obj = spec.image_model(**{spec.id_field: entity_id, **parsed})
    db.add(obj)
    await db.flush()
    await db.refresh(obj)

    await maintain_primary_image(db, spec, entity_id, obj)

    return spec.image_read_model.model_validate(obj).model_dump()


async def update_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    image_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    """保存实体图片，锁定新增文件引用以避免采用正在删除的内容。"""
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    parent = await db.scalar(select(spec.model).where(spec.model.id == entity_id).with_for_update())
    if getattr(parent, "source_character_id", None):
        raise HTTPException(403, "从角色转化的演员只能被引用")
    obj = await db.get(spec.image_model, image_id)
    if obj is None or getattr(obj, spec.id_field) != entity_id:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.image_model.__name__))

    update_data = _parse_image_body(spec.image_update_model, body).model_dump(exclude_unset=True)
    if update_data.get("file_id") is not None:
        await require_available_file(db, file_id=update_data["file_id"], expected_type="image")
    if "file_id" in update_data:
        # 手动采用或清空使旧生成任务的自动采用失效。
        obj.version_id = spec.image_model.version_id + 1
    for key, value in update_data.items():
        setattr(obj, key, value)
    await db.flush()
    await db.refresh(obj)

    await maintain_primary_image(db, spec, entity_id, obj)

    return spec.image_read_model.model_validate(obj).model_dump()


async def delete_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    image_id: int,
) -> None:
    spec = entity_spec(entity_type)
    parent = await db.scalar(select(spec.model).where(spec.model.id == entity_id).with_for_update())
    if getattr(parent, "source_character_id", None):
        raise HTTPException(403, "从角色转化的演员只能被引用")
    obj = await db.get(spec.image_model, image_id)
    if obj is None or getattr(obj, spec.id_field) != entity_id:
        return
    await db.delete(obj)
    await db.flush()
    await maintain_primary_image(db, spec, entity_id, None)


async def maintain_primary_image(db, spec, entity_id, image=None):
    """在所属对象锁内维护主图，首张有效图片自动成为主图。"""
    model = spec.image_model
    owner = getattr(model, spec.id_field)
    if image is None or not image.file_id:
        if image is not None:
            image.is_primary = False
        existing = await db.scalar(select(model.id).where(owner == entity_id, model.is_primary.is_(True), model.file_id.is_not(None)))
        if existing is None:
            replacement = await db.scalar(select(model).where(owner == entity_id, model.file_id.is_not(None)).order_by(model.id).limit(1))
            if replacement is not None:
                replacement.is_primary = True
        await db.flush()
        return
    if image.file_id and not image.is_primary:
        existing = await db.scalar(select(model.id).where(
            owner == entity_id, model.is_primary.is_(True), model.id != image.id,
            model.file_id.is_not(None),
        ))
        if existing is None:
            image.is_primary = True
    if image.is_primary:
        await db.execute(update(model).where(owner == entity_id, model.id != image.id).values(is_primary=False))
    await db.flush()
    await db.refresh(image)


def _parse_image_body(schema, body):
    """动态类别图片接口也将字段校验失败返回为可修正的输入错误。"""
    try:
        return schema.model_validate(body)
    except ValidationError as error:
        details = [{"loc": ["body", *item["loc"]], "msg": item["msg"], "type": item["type"]}
                   for item in error.errors(include_context=False)]
        raise HTTPException(422, details) from error
