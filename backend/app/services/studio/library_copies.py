"""项目专属对象的独立入库副本。"""

from copy import deepcopy
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.studio.resource_image_copies import copy_image_file
from app.services.studio.entity_crud import flush_resource, get_entity
from app.services.studio.entity_specs import entity_spec, normalize_entity_type


async def publish_to_library(
    db: AsyncSession, *, entity_type: str, entity_id: str, name: str | None,
) -> dict:
    """锁定来源并记录副本身份，使重复入库返回同一独立资产。"""
    entity_type = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type)
    source = await db.scalar(select(spec.model).where(spec.model.id == entity_id).with_for_update())
    if source is None:
        raise HTTPException(404, "项目对象不存在")
    if source.project_id is None:
        raise HTTPException(400, "共享资产无需再次入库")
    target_type = "actor" if entity_type == "character" else entity_type
    target_spec = entity_spec(target_type)
    if source.library_copy_id:
        return await get_entity(db, entity_type=target_type, entity_id=source.library_copy_id)
    if entity_type == "character":
        main = await db.scalar(select(spec.image_model.id).where(
            spec.image_model.character_id == source.id,
            spec.image_model.is_primary.is_(True), spec.image_model.file_id.is_not(None),
        ))
        if main is None:
            raise HTTPException(400, "角色入库前需要有效主图")
    copy_name = (name if name is not None else source.name).strip()
    if not copy_name:
        raise HTTPException(422, "副本名称不能为空")
    duplicate = await db.scalar(select(target_spec.model.id).where(
        target_spec.model.project_id.is_(None), target_spec.model.name == copy_name,
    ))
    if duplicate:
        raise HTTPException(409, "资产库中已存在同名对象，请修改副本名称")
    excluded = {"id", "project_id", "name_scope", "library_copy_id", "created_at", "updated_at", "references"}
    values = {column.key: deepcopy(getattr(source, column.key))
              for column in spec.model.__table__.columns if column.key not in excluded}
    values.update(id=uuid4().hex, name=copy_name, project_id=None)
    if entity_type == "character":
        values = {"id": values["id"], "name": copy_name, "project_id": None,
                  "source_character_id": source.id, "supplementary_info": source.description,
                  "style": source.style, "visual_style": source.visual_style}
    target = target_spec.model(**values)
    db.add(target)
    source.library_copy_id = target.id
    await flush_resource(db)
    images = await db.scalars(select(spec.image_model).where(
        getattr(spec.image_model, spec.id_field) == source.id,
        spec.image_model.file_id.is_not(None),
    ))
    for image in images:
        file = await copy_image_file(db, file_id=image.file_id)
        fields = {column.key: deepcopy(getattr(image, column.key))
                  for column in spec.image_model.__table__.columns
                  if column.key not in {"id", spec.id_field, "file_id", "created_at", "updated_at", "version_id"}}
        db.add(target_spec.image_model(**{target_spec.id_field: target.id, "file_id": file.id, **fields}))
    await db.flush()
    return await get_entity(db, entity_type=target_type, entity_id=target.id)
