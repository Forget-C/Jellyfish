"""图片来源对象的创建与独立复制，不继承来源档案或任务历史。"""
from hashlib import sha256
import json
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from app.models.studio import FileItem, FileUsage, Project
from app.services.studio.entity_specs import entity_spec, normalize_entity_type, LINK_MODEL_BY_ENTITY
from app.services.studio.entity_crud import flush_resource, get_entity
from app.services.studio.files import require_available_file
from app.services.studio.resource_image_copies import copy_image_file
from app.utils.project_links import upsert_project_link


async def source_images(db, spec, source_id):
    """仅复制仍有效的成员，排除空槽位、候选与已删除文件。"""
    return list(await db.scalars(select(spec.image_model).join(FileItem, FileItem.id == spec.image_model.file_id).where(
        getattr(spec.image_model, spec.id_field) == source_id, FileItem.type == "image",
        FileItem.deleted_at.is_(None), FileItem.delete_requested_at.is_(None),
    ).order_by(spec.image_model.created_at, spec.image_model.id)))


async def copy_images(db, *, source_rows, target_spec, target_id):
    """复制独立文件与图片身份；稳定文件键使失败重试不会不断产生新文件。"""
    for index, image in enumerate(source_rows):
        file = await copy_image_file(db, file_id=image.file_id,
            copy_id=uuid5(NAMESPACE_URL, f"image-source:{target_id}:{image.id}:{image.file_id}").hex)
        db.add(target_spec.image_model(**{target_spec.id_field: target_id, "file_id": file.id,
            "view_angle": image.view_angle, "is_primary": image.is_primary or (not any(row.is_primary for row in source_rows) and index == 0),
            "is_view_default": image.is_view_default or (not any(row.is_view_default and row.view_angle == image.view_angle for row in source_rows) and not any(row.view_angle == image.view_angle for row in source_rows[:index]))}))
    await db.flush()


async def read_retry(db, spec, kind, request_id, fingerprint):
    """核对已提交的创建结果；不以名称或来源猜测请求身份。"""
    existing = await db.get(spec.model, request_id, populate_existing=True)
    if existing is None:
        return None
    if existing.source_request_hash != fingerprint:
        raise HTTPException(409, "该创建请求已用于其他内容")
    return await get_entity(db, entity_type=kind, entity_id=existing.id)


async def create_image_source(db, *, entity_type, request):
    """按请求身份幂等创建上传资产或项目导入副本，并在同一事务写入成员。"""
    entity_type = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type)
    fingerprint = sha256(json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    previous = await read_retry(db, spec, entity_type, request.id, fingerprint)
    if previous is not None:
        return previous
    if request.source_id:
        if not request.project_id:
            raise HTTPException(422, "从资产库导入需要项目")
        source_kind = "actor" if entity_type == "character" else entity_type
        source_spec = entity_spec(source_kind)
        source = await db.scalar(select(source_spec.model).where(source_spec.model.id == request.source_id).with_for_update())
        previous = await read_retry(db, spec, entity_type, request.id, fingerprint)
        if previous is not None:
            return previous
        if source is None or source.project_id is not None:
            raise HTTPException(404, "请选择资产库中的对应资源")
    elif request.project_id:
        if entity_type not in {"character", "scene", "prop"}:
            raise HTTPException(422, "项目上传仅支持角色、场景和道具")
    elif entity_type == "character":
        raise HTTPException(422, "角色上传需要项目")
    if request.project_id and await db.get(Project, request.project_id) is None:
        raise HTTPException(404, "项目不存在")
    rows = await source_images(db, source_spec, source.id) if request.source_id else []
    if request.source_id and not rows:
        raise HTTPException(422, "来源没有有效图片")
    if not request.source_id:
        for image in request.images:
            try:
                await require_available_file(db, file_id=image.file_id, expected_type="image")
                if request.project_id and not await db.scalar(select(FileUsage.id).where(
                        FileUsage.file_id == image.file_id, FileUsage.project_id == request.project_id).limit(1)):
                    raise HTTPException(422, "上传图片不属于当前项目")
            except HTTPException:
                previous = await read_retry(db, spec, entity_type, request.id, fingerprint)
                if previous is not None:
                    return previous
                raise
    # 相同请求可能在来源或文件锁上等待，取得锁后必须读取前一事务的结果。
    previous = await read_retry(db, spec, entity_type, request.id, fingerprint)
    if previous is not None:
        return previous
    target = spec.model(id=request.id, name=request.name, project_id=request.project_id,
        origin="library" if request.source_id else "upload", source_kind=source_kind if request.source_id else None,
        source_id=request.source_id, source_request_hash=fingerprint)
    db.add(target)
    await flush_resource(db)
    if request.source_id:
        await copy_images(db, source_rows=rows, target_spec=spec, target_id=target.id)
    else:
        seen = set()
        for index, image in enumerate(request.images):
            db.add(spec.image_model(**{spec.id_field: target.id, "file_id": image.file_id,
                "view_angle": image.view_angle, "is_primary": index == 0,
                "is_view_default": image.view_angle not in seen}))
            seen.add(image.view_angle)
        await db.flush()
    if request.project_id and entity_type in LINK_MODEL_BY_ENTITY:
        model, field = LINK_MODEL_BY_ENTITY[entity_type]
        await upsert_project_link(db, model=model, asset_field=field, asset_id=target.id,
                                  project_id=request.project_id, chapter_id=None)
    return await get_entity(db, entity_type=entity_type, entity_id=target.id)
