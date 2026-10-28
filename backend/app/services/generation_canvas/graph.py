"""候选图结构校验与目标端口语义；不将候选误当实际运行依赖。"""
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.errors import diagnostic

PORT_MODALITIES = {'object': 'object_reference', 'text': 'text', 'image': 'image', 'video': 'video', 'audio': 'audio',
                   'first_frame': 'image', 'last_frame': 'image', 'key_frame': 'image',
                   'subject_image': 'image', 'subject_video': 'video'}


def validate_graph(document: CanvasDocument) -> None:
    """损坏身份、端点、顺序和环阻止保存；配置和能力差异留给运行诊断。"""
    cards = {card.id: card for card in document.cards}
    edge_ids, endpoints = set(), set()
    successors = {card_id: set() for card_id in cards}
    expected = {}
    for edge in document.edges:
        target = {'edge_id': edge.id, 'card_id': edge.target_card, 'port_id': edge.target_port}
        source, receiver = cards.get(edge.source_card), cards.get(edge.target_card)
        endpoint = (edge.source_card, edge.source_port, edge.target_card, edge.target_port)
        if edge.id in edge_ids or endpoint in endpoints:
            raise diagnostic('DUPLICATE_CONNECTION', '同一端口连接不能重复', target)
        edge_ids.add(edge.id)
        endpoints.add(endpoint)
        if not source or not receiver or edge.source_port not in source.output_ports or edge.target_port not in receiver.input_ports:
            raise diagnostic('INVALID_ENDPOINT', '连接端点不存在', target)
        if edge.source_card == edge.target_card:
            raise diagnostic('SELF_CONNECTION', '卡片不能连接自身', target)
        if PORT_MODALITIES[edge.source_port] != PORT_MODALITIES[edge.target_port]:
            raise diagnostic('INCOMPATIBLE_PORT', '端口模态不匹配，不提供隐式转换', target)
        successors[edge.source_card].add(edge.target_card)
        expected.setdefault(edge.target_card, {}).setdefault(edge.target_port, []).append(edge.id)
    # Kahn 排序避免深图递归溢出；候选关系自身也不允许循环。
    indegree = dict.fromkeys(cards, 0)
    for destinations in successors.values():
        for card_id in destinations:
            indegree[card_id] += 1
    ready = [card_id for card_id, count in indegree.items() if count == 0]
    visited = 0
    while ready:
        card_id = ready.pop()
        visited += 1
        for next_id in successors[card_id]:
            indegree[next_id] -= 1
            if indegree[next_id] == 0:
                ready.append(next_id)
    if visited != len(cards):
        raise diagnostic('GRAPH_CYCLE', '候选连接不能形成循环', {'card_id': next(key for key, count in indegree.items() if count)})
    for card_id, ports in document.input_order.items():
        for port_id, order in ports.items():
            if len(order) != len(set(order)) or set(order) != set(expected.get(card_id, {}).get(port_id, [])):
                raise diagnostic('INVALID_INPUT_ORDER', '输入顺序必须完整且仅包含本目标端口连接', {'card_id': card_id, 'port_id': port_id})
            if card_id not in cards or port_id not in cards[card_id].input_ports:
                raise diagnostic('INVALID_INPUT_ORDER', '输入顺序的目标端口不存在', {'card_id': card_id, 'port_id': port_id})
    for card_id, ports in expected.items():
        for port_id in ports:
            if port_id not in document.input_order.get(card_id, {}):
                raise diagnostic('INVALID_INPUT_ORDER', '目标端口缺少输入顺序', {'card_id': card_id, 'port_id': port_id})
    group_ids, members = set(), set()
    for group in document.groups:
        if (group.id in group_ids or group.id in cards or len(group.card_ids) != len(set(group.card_ids))
                or any(card_id not in cards or card_id in members for card_id in group.card_ids)):
            raise diagnostic('INVALID_GROUP', '分组身份和成员必须有效且不重叠', {'group_id': group.id})
        group_ids.add(group.id)
        members.update(group.card_ids)
