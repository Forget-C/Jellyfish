"""将来源图片采用为独立主图，不保留可变文件身份。"""

from copy import deepcopy
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from app.core import storage
from app.models.studio import FileItem
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.entity_images import maintain_primary_image, maintain_view_defaults
from app.services.studio.files import require_available_file
from app.services.studio.resource_references import validate_resource_references


async def copy_image_file(db, *, file_id, copy_id=None):
    """复制文件身份、信息与实际内容；稳定 copy_id 支持重试复用。"""
    original = await require_available_file(db, file_id=file_id, expected_type="image")
    target_id = copy_id or uuid4().hex
    existing = await db.get(FileItem, target_id)
    if existing is not None:
        return await require_available_file(db, file_id=target_id, expected_type="image")
    key = f"files/{target_id}{Path(original.storage_key).suffix}"
    contents = await storage.download_file(key=original.storage_key)
    await storage.upload_file(key=key, data=contents, content_type=original.content_type)
    target = FileItem(id=target_id, type=original.type, name=original.name, tags=deepcopy(original.tags),
        storage_key=key, content_type=original.content_type, size_bytes=original.size_bytes,
        width=original.width, height=original.height, content_hash=original.content_hash)
    db.add(target)
    await db.flush()
    return target


async def adopt_reference_main(db, *, entity_type, entity_id, reference):
    """在对象锁内采用独立文件主图；重复采用相同来源不增加图片。"""
    entity_type = normalize_entity_type(entity_type)
    if entity_type == "character" and reference["role"] in {"costume", "prop"}:
        raise HTTPException(400, "请选择参考主体图片作为主图")
    spec = entity_spec(entity_type)
    target = await db.scalar(select(spec.model).where(spec.model.id == entity_id).with_for_update())
    if target is None:
        raise HTTPException(404, "对象不存在")
    await validate_resource_references(db, entity_type, target.project_id, [reference])
    copy_id = uuid5(NAMESPACE_URL, f"object-main:{entity_type}:{entity_id}:{reference['file_id']}").hex
    file = await copy_image_file(db, file_id=reference["file_id"], copy_id=copy_id)
    angle = reference.get("view_angle") or "FRONT"
    if reference.get("source_kind"):
        source_spec = entity_spec(reference["source_kind"])
        query = select(source_spec.image_model.view_angle).where(
                getattr(source_spec.image_model, source_spec.id_field) == reference["source_id"],
                source_spec.image_model.file_id == reference["file_id"],
        )
        if reference.get("source_image_id") is not None:
            query = query.where(source_spec.image_model.id == reference["source_image_id"])
        if reference.get("view_angle") is not None:
            query = query.where(source_spec.image_model.view_angle == reference["view_angle"])
        angle = await db.scalar(query.order_by(source_spec.image_model.is_primary.desc(), source_spec.image_model.id).limit(1))
    image = await db.scalar(select(spec.image_model).where(
        getattr(spec.image_model, spec.id_field) == entity_id, spec.image_model.file_id == file.id,
        spec.image_model.view_angle == angle,
    ))
    if image is None:
        image = spec.image_model(**{spec.id_field: entity_id, "file_id": file.id, "view_angle": angle})
        db.add(image)
        await db.flush()
    image.is_primary = True
    await maintain_primary_image(db, spec, entity_id, image)
    await maintain_view_defaults(db, spec, entity_id, image)
    return spec.image_read_model.model_validate(image).model_dump()
