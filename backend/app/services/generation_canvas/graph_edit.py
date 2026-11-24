"""更新候选关系和卡片时共同维护文档的输入次序。"""

from app.schemas.generation_canvas import CanvasDocument, GenerationCanvasEdge


def append_edge(document: CanvasDocument, edge: GenerationCanvasEdge) -> None:
    """新增候选连接，并在目标端口最后追加其身份。"""
    document.edges.append(edge)
    document.input_order.setdefault(edge.target_card, {}).setdefault(edge.target_port, []).append(edge.id)


def remove_edges(document: CanvasDocument, affected: set[str]) -> None:
    """移除指定连线及排序引用，保留其余输入的相对顺序。"""
    document.edges = [edge for edge in document.edges if edge.id not in affected]
    for edge in document.edges:
        if edge.order_anchor and edge.order_anchor.edge_id in affected:
            edge.order_anchor = None
    for ports in document.input_order.values():
        for port, entries in ports.items():
            ports[port] = [edge_id for edge_id in entries if edge_id not in affected]


def remove_card(document: CanvasDocument, card_id: str) -> None:
    """移除卡片、相邻连接及分组成员，实际采用由保存校验保护。"""
    affected = {edge.id for edge in document.edges if card_id in (edge.source_card, edge.target_card)}
    document.cards = [card for card in document.cards if card.id != card_id]
    remove_edges(document, affected)
    document.input_order.pop(card_id, None)
    for group in document.groups:
        group.card_ids = [value for value in group.card_ids if value != card_id]
    document.groups = [group for group in document.groups if group.card_ids]
