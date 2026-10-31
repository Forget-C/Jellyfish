"""参考映射的就绪条件；草稿校验不阻止自动保存，也不虚构有效输出。"""
from app.schemas.generation_canvas import NamedImageReferenceCard, ObjectDescriptionCard


def reference_name_issue(document, card):
    """按类型、去首尾空白的名称及角度判重；不同角度可共享同一对象。"""
    if card.name_binding:
        source = next((item for item in document.cards if item.id == card.name_binding.card_id), None)
        if (not isinstance(source, ObjectDescriptionCard) or source.category != card.type.split('.')[1]
                or not source.object_id or source.object_id != card.name_binding.object_id):
            return 'INVALID_NAME_BINDING', '关联描述对象无效，请重新选择名称'
    name = card.name.strip()
    if not name:
        return 'REFERENCE_NAME_REQUIRED', '请填写参考名称'
    if sum(isinstance(item, NamedImageReferenceCard) and item.type == card.type and item.name.strip() == name
           and (item.angle.strip() or '正面') == (card.angle.strip() or '正面') for item in document.cards) > 1:
        return 'DUPLICATE_REFERENCE_NAME', '同类型、同名称、同角度的参考已存在'
    return None


def clean_reference_image_sources(document, previous=None):
    """清理旧的非图片内容来源边，固定图只解除来源指针，保留文件、身份和下游采用。"""
    from app.services.generation_canvas.errors import diagnostic
    cards = {card.id: card for card in document.cards}
    old_cards = {card.id: card for card in previous.cards} if previous else {}
    old_edges = {edge.id: edge for edge in previous.edges} if previous else {}
    removed = set()
    for edge in document.edges:
        receiver = cards.get(edge.target_card)
        source = cards.get(edge.source_card) or old_cards.get(edge.source_card)
        if not isinstance(receiver, NamedImageReferenceCard) or edge.target_port != 'image_source' or not source or source.type == 'content.image':
            continue
        if previous and old_edges.get(edge.id) != edge:
            raise diagnostic('INVALID_REFERENCE_SOURCE', '参考图仅支持图片内容卡，请先另存为图片内容卡', {'card_id': receiver.id, 'edge_id': edge.id})
        removed.add(edge.id)
    updated = []
    for card in document.cards:
        if isinstance(card, NamedImageReferenceCard) and card.image_binding and card.image_binding.source:
            source = cards.get(card.image_binding.source.card_id) or old_cards.get(card.image_binding.source.card_id)
            if source and source.type != 'content.image':
                prior = old_cards.get(card.id)
                if previous and (not isinstance(prior, NamedImageReferenceCard) or prior.image_binding != card.image_binding):
                    raise diagnostic('INVALID_REFERENCE_SOURCE', '新增参考图仅可从图片内容卡选择', {'card_id': card.id, 'path': ['image_binding']})
                card = card.model_copy(update={'image_binding': card.image_binding.model_copy(update={'source': None})})
        updated.append(card)
    if not removed and updated == document.cards:
        return document
    return document.model_copy(update={'cards': updated, 'edges': [edge for edge in document.edges if edge.id not in removed],
        'input_order': {card_id: {port: [value for value in order if value not in removed] for port, order in ports.items()}
                        for card_id, ports in document.input_order.items()}})
