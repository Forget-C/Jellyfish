"""根据持久归属限制共同编辑器能力，目录、保存与运行共享同一规则。"""
from app.services.generation_canvas.errors import diagnostic

FREE_CARD_TYPES = frozenset({
    'content.text', 'content.basis', 'content.image', 'content.video', 'content.audio',
    'content.character', 'content.place', 'content.prop', 'content.costume',
    'reference.character', 'reference.place', 'reference.prop', 'reference.costume',
    'model.text', 'model.image', 'model.video',
})


def validate_canvas_cards(canvas, document):
    """自由画布不得携带分镜卡或章节／场次来源；拒绝而不删改正文。"""
    if canvas.kind != 'free':
        return
    if document.fixed_source or document.storyboard or document.archived_sources:
        raise diagnostic('SCENE_SOURCE_NOT_ALLOWED', '自由画布不支持场次来源', {'canvas_id': canvas.id})
    for card in document.cards:
        if card.type not in FREE_CARD_TYPES:
            raise diagnostic('CARD_TYPE_NOT_ALLOWED', '此卡片仅可用于分镜画布', {'card_id': card.id})
        if getattr(card, 'scene_object_source', None):
            raise diagnostic('SCENE_SOURCE_NOT_ALLOWED', '自由画布不支持场次对象来源', {'card_id': card.id})
