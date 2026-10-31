"""命名参考的类别、对象身份与固定主图校验；不分析图片内容。"""
from fastapi import HTTPException
from sqlalchemy import select
from app.models.studio import FileUsage
from app.schemas.generation_canvas import NamedImageReferenceCard, ModelCard, ObjectDescriptionCard
from app.services.generation_canvas.compiler import identity_key, resolve_outputs
from app.services.generation_canvas.outputs import card_outputs
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
    from app.schemas.generation_canvas import CanvasDocument
    old_cards = {card.id: card for card in CanvasDocument.model_validate(previous).cards}
    old = {card['id']: card for card in previous.get('cards', [])}
    for card in references:
        target = {'card_id': card.id}
        prior = old_cards.get(card.id)
        if isinstance(prior, NamedImageReferenceCard) and (prior.object_id or prior.id) != (card.object_id or card.id):
            raise diagnostic('IMMUTABLE_OBJECT_IDENTITY', '已建立参考对象的身份不可修改', target)
        if isinstance(prior, NamedImageReferenceCard) and prior.name_binding != card.name_binding:
            for receiver in document.cards:
                sources = [binding.source for binding in getattr(receiver, 'input_bindings', [])]
                sources += [example.source for example in getattr(receiver, 'examples', [])]
                image = getattr(receiver, 'image_binding', None)
                if image and image.source:
                    sources.append(image.source)
                if any(source.canvas_id == document.id and source.card_id == card.id for source in sources):
                    raise diagnostic('REFERENCE_IN_USE', '请先取消下游采用，再切换或取消名称关联', target)
        if card.name_binding:
            binding = card.name_binding
            source = next((value for value in document.cards if value.id == binding.card_id), None)
            if (binding.canvas_id != document.id or binding.port_id != 'object' or binding.position != 0
                    or not isinstance(source, ObjectDescriptionCard) or source.category != card.type.split('.')[1]
                    or not source.object_id or source.object_id != binding.object_id
                    or (not source.name.strip() and (not isinstance(prior, NamedImageReferenceCard) or prior.name_binding != binding))
                    or not any(edge.target_card == card.id and edge.target_port == 'name' and
                               edge.source_card == source.id and edge.source_port == 'object' for edge in document.edges)):
                raise diagnostic('INVALID_NAME_BINDING', '请选择已连线的同类型描述名称', {**target, 'path': ['name_binding']})
        candidates = resolve_outputs(document, card.id, published)
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
                if item is None:
                    source = next((value for value in document.cards if value.id == image.source.card_id), None)
                    # 重名是可保存的草稿；固定图片核对自身文件身份，不借此发布重名来源。
                    if isinstance(source, NamedImageReferenceCard) and source.name.strip():
                        item = next((value for value in card_outputs(document.id, source) if identity_key(value.source) == identity_key(image.source)), None)
                if not item or not item.available or item.file_id != image.file_id or item.result_set_id != image.result_set_id:
                    raise diagnostic('INVALID_IMAGE_BINDING', '请选择已发布的具体图片产物', target)
