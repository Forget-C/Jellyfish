"""堆叠是持久化的只读组织，不冻结成员输出或既有任务。"""
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.errors import diagnostic


def validate_stack_edit(previous: dict, document: CanvasDocument) -> None:
    """保留中的堆叠禁止成员和输入变更；显式解除后恢复正常编辑。"""
    old = CanvasDocument.model_validate(previous)
    old_cards = {card.id: card.model_dump() for card in old.cards}
    cards = {card.id: card.model_dump() for card in document.cards}
    retained = {group.id: group for group in document.groups if group.kind == 'stack'}
    for group in old.groups:
        if group.kind != 'stack' or group.id not in retained:
            continue
        target = {'group_id': group.id}
        if retained[group.id].card_ids != group.card_ids:
            raise diagnostic('STACK_READ_ONLY', '请先解除堆叠，再修改成员', target)
        members = set(group.card_ids)
        for card_id in members:
            if old_cards.get(card_id) != cards.get(card_id):
                raise diagnostic('STACK_READ_ONLY', '请先解除堆叠，再编辑或删除卡片',
                                 {**target, 'card_id': card_id})
            if old.input_order.get(card_id, {}) != document.input_order.get(card_id, {}):
                raise diagnostic('STACK_READ_ONLY', '请先解除堆叠，再修改输入关系',
                                 {**target, 'card_id': card_id})
        incoming = {edge.id: edge.model_dump() for edge in old.edges if edge.target_card in members}
        updated = {edge.id: edge.model_dump() for edge in document.edges if edge.target_card in members}
        if incoming != updated:
            changed = next((edge for edge in old.edges if edge.id in incoming and incoming[edge.id] != updated.get(edge.id)), None)
            raise diagnostic('STACK_READ_ONLY', '请先解除堆叠，再修改输入关系或删除其来源',
                             {**target, **({'card_id': changed.target_card, 'edge_id': changed.id} if changed else {})})
