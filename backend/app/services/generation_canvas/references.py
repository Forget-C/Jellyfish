"""命名参考的类别、对象身份与固定主图校验；不分析图片内容。"""
from fastapi import HTTPException
from sqlalchemy import select
from app.models.studio import FileUsage
from app.schemas.generation_canvas import NamedImageReferenceCard, ObjectDescriptionCard, ObjectReferencePayload, ModelCard
from app.services.generation_canvas.compiler import identity_key, resolve_outputs
from app.services.generation_canvas.errors import diagnostic
from app.services.studio.files import require_available_file


async def validate_references(db, document, previous, project_id):
    """保存允许未完成参考；已有绑定必须指向直接、类别适配的实际出口。"""
    references = [card for card in document.cards if isinstance(card, NamedImageReferenceCard)]
    if not references:
        return
    from app.services.generation_canvas.runtime import CanvasRuntime
    # 用当前已发布产物核对首次选择；固定文件不会随下次运行替换。
    from app.models.generation_canvas import GenerationCanvas
    canvas = await db.get(GenerationCanvas, document.id)
    published = await CanvasRuntime(db, project_id).current_outputs(canvas)
    # 最终文档的新媒体选择由本卡出口形成；只注入既有模型产物，避免旧文件覆盖同次编辑。
    models = {card.id for card in document.cards if isinstance(card, ModelCard)}
    published = {card_id: outputs for card_id, outputs in published.items() if card_id in models}
    owners, names = {}, {}
    for card in document.cards:
        objects = card.objects if isinstance(card, NamedImageReferenceCard) else [card] if isinstance(card, ObjectDescriptionCard) else []
        for obj in objects:
            if obj.object_id:
                if obj.object_id in owners:
                    raise diagnostic('DUPLICATE_OBJECT_IDENTITY', '独立对象身份不可重复', {'card_id': card.id})
                owners[obj.object_id] = card.id
            if obj.name.strip():
                if obj.name.strip() in names:
                    raise diagnostic('DUPLICATE_OBJECT_NAME', '同一画布内独立对象名称必须唯一', {'card_id': card.id})
                names[obj.name.strip()] = obj.object_id
    old = {card['id']: card for card in previous.get('cards', [])}
    for card in references:
        target = {'card_id': card.id}
        allowed = {'character', 'costume', 'prop'} if card.type == 'reference.character' else {card.type.split('.')[1]}
        candidates = resolve_outputs(document, card.id, published)
        selected = []
        ids = set()
        for binding in card.input_bindings:
            if binding.id in ids or binding.input_port != 'name':
                raise diagnostic('INVALID_NAME_BINDING', '名称绑定身份必须唯一且用途为名称', target)
            ids.add(binding.id)
            item = next((item for item in candidates if identity_key(item.source) == identity_key(binding.source)), None)
            if item is None or not isinstance(item.payload, ObjectReferencePayload):
                raise diagnostic('INVALID_NAME_BINDING', '请选择直接候选中的具体对象', target)
            selected.append(item.payload)
        if any(obj.category not in allowed for obj in [*selected, *card.objects]):
            raise diagnostic('INVALID_REFERENCE_CATEGORY', '参考名称类别不适用于此卡', target)
        primary = card.type.split('.')[1]
        if any(obj.category == primary for obj in selected) and any(obj.category == primary for obj in card.objects):
            raise diagnostic('BOUND_OBJECT_OWNED_UPSTREAM', '已绑定本类别对象，请先取消或替换名称关联', target)
        image = card.image_binding
        if not image:
            continue
        try:
            await require_available_file(db, file_id=image.file_id, expected_type='image')
        except HTTPException as exc:
            raise diagnostic('INVALID_MEDIA_FILE', str(exc.detail), target) from exc
        if not await db.scalar(select(FileUsage.id).where(FileUsage.file_id == image.file_id, FileUsage.project_id == project_id).limit(1)):
            raise diagnostic('INVALID_MEDIA_FILE', '文件不属于当前项目', target)
        if image.source:
            if not any(edge.target_card == card.id and edge.target_port == 'image_source' and
                       edge.source_card == image.source.card_id and edge.source_port == image.source.port_id for edge in document.edges):
                raise diagnostic('INVALID_IMAGE_BINDING', '主图必须保留直接来源连接', target)
            if old.get(card.id, {}).get('image_binding') != image.model_dump():
                item = next((item for item in candidates if identity_key(item.source) == identity_key(image.source)), None)
                if not item or not item.available or item.file_id != image.file_id or item.result_set_id != image.result_set_id:
                    raise diagnostic('INVALID_IMAGE_BINDING', '请选择已发布的具体图片产物', target)
