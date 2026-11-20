"""候选图结构校验与目标端口语义；不将候选误当实际运行依赖。"""
from app.schemas.generation_canvas import CanvasDocument, CheckCard, ModelCard, ObjectDescriptionCard, NamedImageReferenceCard
from app.services.generation_canvas.errors import diagnostic

from app.services.generation_canvas.catalog import ports_compatible


def validate_graph(document: CanvasDocument, previous: CanvasDocument | None = None) -> None:
    """校验图的端点、输入用途、顺序与依赖关系。"""
    cards = {card.id: card for card in document.cards}
    previous_edges = {edge.id: edge for edge in previous.edges} if previous else {}
    by_edge = {edge.id: edge for edge in document.edges}
    edge_ids, endpoints = set(), set()
    successors = {card_id: set() for card_id in cards}
    expected, result_scopes = {}, {}
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
        if isinstance(receiver, CheckCard):
            if expected.get(receiver.id):
                raise diagnostic('CHECK_TARGET_LIMIT', '每张检查卡只连接一张模型生成卡', target)
            if edge.result_scope is not None or edge.order_anchor is not None:
                raise diagnostic('INVALID_CHECK_CONNECTION', '生成检查依据连接不接受产物位置或排序', target)
        anchor = edge.order_anchor
        if anchor:
            original = by_edge.get(anchor.edge_id)
            # 删除原模型连接后，独立内容继续按自己的输入顺序参与候选。
            removed = original is None and getattr(previous_edges.get(edge.id), 'order_anchor', None) == anchor
            valid = (getattr(source, 'origin', None) and original and isinstance(cards.get(original.source_card), ModelCard)
                     and not original.order_anchor and original.source_port == edge.source_port
                     and original.target_card == edge.target_card and original.target_port == edge.target_port)
            if not removed and not valid:
                raise diagnostic('INVALID_RESULT_ORDER', '固定内容的排序必须对应同一输入用途的模型连线', target)
        if edge.result_scope is not None and not isinstance(source, ModelCard):
            raise diagnostic('INVALID_RESULT_SCOPE', '只有模型输出连接可限定结果位置', target)
        scope_key = (edge.source_card, edge.source_port, edge.target_card)
        if result_scopes.setdefault(scope_key, edge.result_scope) != edge.result_scope:
            raise diagnostic('INVALID_RESULT_SCOPE', '同一来源与接收卡的各用途必须共享结果范围', target)
        if edge.source_card == edge.target_card:
            raise diagnostic('SELF_CONNECTION', '卡片不能连接自身', target)
        if not ports_compatible(edge.source_port, receiver.type, edge.target_port, source.type):
            raise diagnostic('INCOMPATIBLE_PORT', '端口值种类不匹配，不提供隐式转换', target)
        if isinstance(receiver, NamedImageReferenceCard):
            if edge.target_port == 'image_source' and source.type != 'content.image':
                raise diagnostic('INVALID_REFERENCE_SOURCE', '参考图仅支持图片内容卡，请先另存为图片内容卡', target)
            if edge.target_port == 'name' and (not isinstance(source, ObjectDescriptionCard) or source.category != receiver.type.split('.')[1]):
                raise diagnostic('INVALID_REFERENCE_CATEGORY', '名称候选必须来自同类型描述卡', target)
        successors[edge.source_card].add(edge.target_card)
        expected.setdefault(edge.target_card, {}).setdefault(edge.target_port, []).append(edge.id)
    # 画面定位也是整卡依赖，即使没有独立候选线也必须参与环检查。
    for card in document.cards:
        target = getattr(card, 'frame_target', None)
        if target and target.card_id in cards:
            successors[target.card_id].add(card.id)
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
