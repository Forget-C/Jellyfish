"""项目专属对象的独立入库副本。"""

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    copy_name = (name if name is not None else source.name).strip()
    if not copy_name:
        raise HTTPException(422, "副本名称不能为空")
    duplicate = await db.scalar(select(target_spec.model.id).where(
        target_spec.model.project_id.is_(None), target_spec.model.name == copy_name,
    ))
    if duplicate:
        raise HTTPException(409, "资产库中已存在同名对象，请修改副本名称")
    from app.services.studio.image_sources import source_images, copy_images
    images = await source_images(db, spec, source.id)
    if not images:
        raise HTTPException(422, "入库前需要至少一张有效图片")
    target = target_spec.model(id=uuid4().hex, name=copy_name, project_id=None,
                               origin="project", source_kind=entity_type, source_id=source.id)
    db.add(target)
    source.library_copy_id = target.id
    await flush_resource(db)
    await copy_images(db, source_rows=images, target_spec=target_spec, target_id=target.id)
    return await get_entity(db, entity_type=target_type, entity_id=target.id)
