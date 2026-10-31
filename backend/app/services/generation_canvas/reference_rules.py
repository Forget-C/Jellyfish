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
