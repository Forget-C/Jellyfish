"""通过场次对象解析当前项目主图与角度默认图；预览不固定文件。"""
from sqlalchemy import select
from app.models.directing import Sequence
from app.models.studio import Chapter
from app.models.types import AssetViewAngle
from app.schemas.generation_canvas import CanvasResolvedOutput, NamedImageReferenceCard, NamedImagePayload, OutputIdentity
from app.core.contracts.generation_canvas import NamedImageObject
from app.services.studio.entity_specs import entity_spec


# 出口位置是持久选择器，不是当前图片列表索引；新增视角不得调整已有位置。
SCENE_IMAGE_VIEWS = (
    (None, '主图'), (AssetViewAngle.front, '正面'), (AssetViewAngle.left, '左侧'),
    (AssetViewAngle.right, '右侧'), (AssetViewAngle.back, '背面'),
    (AssetViewAngle.three_quarter, '四分之三侧面'), (AssetViewAngle.top, '俯视'),
    (AssetViewAngle.detail, '细节'),
)


async def scene_object(db, project_id, source):
    """只按项目中的场次与对象身份查找，不通过名称恢复失效选用。"""
    sequence = await db.scalar(select(Sequence).join(Chapter, Chapter.id == Sequence.chapter_id).where(
        Sequence.id == source.sequence_id, Chapter.project_id == project_id))
    if not sequence:
        return None
    return next((item for item in (sequence.object_preparation or {}).get('objects', []) if item['id'] == source.object_id), None)


async def current_scene_images(db, project_id, document):
    """每次操作读取当前默认图，保持缺图位置，正式值交给原任务快照固定。"""
    from app.models.studio import FileItem
    result = {}
    for card in document.cards:
        if not isinstance(card, NamedImageReferenceCard) or not card.scene_object_source:
            continue
        outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=document.id, card_id=card.id,
            port_id='image', position=position), modality='image', available=False)
            for position in range(len(SCENE_IMAGE_VIEWS))]
        result[card.id] = outputs
        obj = await scene_object(db, project_id, card.scene_object_source)
        kind = 'scene' if card.type == 'reference.place' else card.type.split('.')[1]
        if not obj or obj.get('kind') != kind or not obj.get('asset_id'):
            continue
        spec = entity_spec(kind)
        asset = await db.get(spec.model, obj['asset_id'])
        if not asset or asset.project_id != project_id:
            continue
        image = spec.image_model
        slots = (await db.execute(select(image, FileItem).join(FileItem, image.file_id == FileItem.id).where(
            getattr(image, spec.id_field) == asset.id, FileItem.type == 'image',
            FileItem.deleted_at.is_(None), FileItem.delete_requested_at.is_(None)))).all()
        identity = NamedImageObject(object_id=card.name_binding.object_id if card.name_binding else card.object_id or card.scene_object_source.object_id,
            name=card.name.strip(), category=card.type.split('.')[1])
        for position, (angle, label) in enumerate(SCENE_IMAGE_VIEWS):
            file = next((file for slot, file in slots if (slot.is_primary if angle is None
                else slot.is_view_default and slot.view_angle == angle)), None)
            if file:
                outputs[position] = CanvasResolvedOutput(source=outputs[position].source, modality='image',
                    payload=NamedImagePayload(name=card.name.strip(), file_id=file.id, objects=[identity], angle=label))
    return result
