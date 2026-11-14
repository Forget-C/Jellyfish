"""场次对象的共享资产选用：保留项目角色身份与图片真实来源。"""

from sqlalchemy import select

from app.core.contracts.directing.workspace import AssetReferenceImage
from app.services.studio.entity_specs import entity_spec


async def reference_images(db, kind, asset_ids):
    """批量读取真实视角；显式返回视角默认标记，避免调用方依赖排序选图。"""
    from app.models.studio import FileItem
    spec = entity_spec(kind)
    model = spec.image_model
    rows = await db.execute(select(model, FileItem).outerjoin(FileItem, FileItem.id == model.file_id)
        .where(getattr(model, spec.id_field).in_(asset_ids)).order_by(model.is_primary.desc(), model.id.desc()))
    result = {id_: ([], 0) for id_ in asset_ids}
    for slot, file in rows:
        asset_id = getattr(slot, spec.id_field)
        images, unavailable = result[asset_id]
        if not slot.file_id:
            continue
        if file is None or file.type != 'image' or file.delete_requested_at or file.deleted_at:
            result[asset_id] = (images, unavailable + 1)
            continue
        images.append(AssetReferenceImage(file_id=file.id, view_angle=slot.view_angle,
            source_kind=kind, source_id=asset_id, slot_id=slot.id, is_view_default=slot.is_view_default))
    return result
