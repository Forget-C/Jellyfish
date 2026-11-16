"""通过场次对象解析当前项目主图；不写画布、不为预览固定文件。"""
from sqlalchemy import select
from app.models.directing import Sequence
from app.models.studio import Chapter
from app.schemas.generation_canvas import CanvasResolvedOutput, NamedImageReferenceCard, NamedImagePayload, OutputIdentity
from app.core.contracts.generation_canvas import NamedImageObject
from app.services.studio.entity_specs import entity_spec


async def scene_object(db, project_id, source):
    """只按项目中的场次与对象身份查找，不通过名称恢复失效选用。"""
    sequence = await db.scalar(select(Sequence).join(Chapter, Chapter.id == Sequence.chapter_id).where(
        Sequence.id == source.sequence_id, Chapter.project_id == project_id))
    if not sequence:
        return None
    return next((item for item in (sequence.object_preparation or {}).get('objects', []) if item['id'] == source.object_id), None)


async def current_scene_images(db, project_id, document):
    """每次操作读取对象当前主图；返回可被任务快照冻结的正式解析值。"""
    from app.models.studio import FileItem
    result = {}
    for card in document.cards:
        if not isinstance(card, NamedImageReferenceCard) or not card.scene_object_source:
            continue
        output = CanvasResolvedOutput(source=OutputIdentity(canvas_id=document.id, card_id=card.id,
            port_id='image', position=0), modality='image', available=False)
        result[card.id] = [output]
        obj = await scene_object(db, project_id, card.scene_object_source)
        kind = 'scene' if card.type == 'reference.place' else card.type.split('.')[1]
        if not obj or obj.get('kind') != kind or not obj.get('asset_id'):
            continue
        spec = entity_spec(kind)
        asset = await db.get(spec.model, obj['asset_id'])
        if not asset or asset.project_id != project_id:
            continue
        image = spec.image_model
        file = await db.scalar(select(FileItem).join(image, image.file_id == FileItem.id).where(
            getattr(image, spec.id_field) == asset.id, image.is_primary.is_(True), FileItem.type == 'image',
            FileItem.deleted_at.is_(None), FileItem.delete_requested_at.is_(None)))
        if not file:
            continue
        identity = NamedImageObject(object_id=card.name_binding.object_id if card.name_binding else card.object_id or card.scene_object_source.object_id,
            name=card.name.strip(), category=card.type.split('.')[1])
        result[card.id] = [CanvasResolvedOutput(source=output.source, modality='image',
            payload=NamedImagePayload(name=card.name.strip(), file_id=file.id, objects=[identity], angle='主图'))]
    return result
