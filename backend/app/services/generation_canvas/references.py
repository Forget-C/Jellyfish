"""命名参考的类别、对象身份与固定主图校验；不分析图片内容。"""
from app.schemas.generation_canvas import NamedImageReferenceCard, ObjectDescriptionCard
from app.services.generation_canvas.compiler import identity_key
from app.services.generation_canvas.errors import diagnostic

from app.services.generation_canvas.saved_media import validate_media_file


async def validate_references(db, document, previous, project_id, media_references, *, context=None):
    """保存允许未完成参考；已有绑定必须指向直接、类别适配的实际出口。"""
    from app.services.generation_canvas.output_resolution import CanvasOutputContext
    context = context or CanvasOutputContext(document)
    references = [card for card in document.cards if isinstance(card, NamedImageReferenceCard)]
    if not references:
        return
    from app.schemas.generation_canvas import CanvasDocument
    old_cards = {card.id: card for card in CanvasDocument.model_validate(previous).cards}
    for card in references:
        target = {'card_id': card.id}
        prior = old_cards.get(card.id)
        if isinstance(prior, NamedImageReferenceCard) and (prior.object_id or prior.id) != (card.object_id or card.id):
            raise diagnostic('IMMUTABLE_OBJECT_IDENTITY', '已建立参考对象的身份不可修改', target)
        if isinstance(prior, NamedImageReferenceCard) and prior.name_binding != card.name_binding:
            for receiver in document.cards:
                sources = [binding.source for binding in getattr(receiver, 'input_bindings', [])]
                sources += [example.source for example in getattr(receiver, 'examples', [])]
                from app.services.generation_canvas.design_references import design_field_references
                sources += [ref.source for ref, _, _ in design_field_references(receiver)]
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
        if card.scene_object_source:
            from app.services.generation_canvas.scene_object_sources import scene_object
            obj = await scene_object(db, project_id, card.scene_object_source)
            kind = 'scene' if card.type == 'reference.place' else card.type.split('.')[1]
            unchanged_source = isinstance(prior, NamedImageReferenceCard) and prior.scene_object_source == card.scene_object_source
            identity = card.name_binding.object_id if card.name_binding else card.object_id
            if card.image_binding or (identity and identity != card.scene_object_source.object_id) or (not unchanged_source and (not obj or obj.get('kind') != kind)):
                raise diagnostic('INVALID_SCENE_OBJECT_SOURCE', '请选择本项目同类型场次对象，且不能同时采用固定图片', target)
        image = card.image_binding
        if not image:
            continue
        previous_image = prior.image_binding if isinstance(prior, NamedImageReferenceCard) else None
        unchanged = previous_image == image
        source = context.cards.get(image.source.card_id) if image.source else None
        keeps_pinned_file = (image.source is None and previous_image is not None
                               and previous_image.file_id == image.file_id and previous_image.result_set_id == image.result_set_id)
        if not (keeps_pinned_file or (source and source.type == 'content.image')):
            raise diagnostic('INVALID_REFERENCE_SOURCE', '新增参考图仅可从图片内容卡选择', {**target, 'path': ['image_binding']})
        await validate_media_file(db, project_id, media_references[card.id][0])
        if image.source:
            if not any(edge.target_card == card.id and edge.target_port == 'image_source' and
                       edge.source_card == image.source.card_id and edge.source_port == image.source.port_id for edge in document.edges):
                raise diagnostic('INVALID_IMAGE_BINDING', '主图必须保留直接来源连接', target)
            if not unchanged:
                # 新主图只来自图片内容卡；以最终文档核对同次换图，不读取整图运行成果。
                candidates = context.resolve_outputs(card.id, model_outputs=None)
                item = next((item for item in candidates if identity_key(item.source) == identity_key(image.source)), None)
                if not item or not item.available or item.file_id != image.file_id or item.result_set_id != image.result_set_id:
                    raise diagnostic('INVALID_IMAGE_BINDING', '请选择已发布的具体图片产物', target)
