"""独立设计输入随连线生效；正文显式引用仍由接收端持有并保护。"""
from app.core.contracts.generation_canvas import InputBinding, OutputIdentity
from app.services.generation_canvas.output_resolution import prompt_references


def expand_source_connections(document, previous):
    """一对来源与接收卡保留全部兼容用途候选；旧边身份和各用途顺序不变。"""
    from uuid import uuid4
    from app.schemas.generation_canvas import GenerationCanvasEdge
    from app.services.generation_canvas.connection_policy import source_connection_policies
    cards = {card.id: card for card in document.cards}
    endpoints = {(edge.source_card, edge.source_port, edge.target_card, edge.target_port) for edge in document.edges}
    scopes = {(edge.source_card, edge.source_port, edge.target_card): edge.result_scope for edge in document.edges}
    old = {(edge.source_card, edge.source_port, edge.target_card, edge.target_port): edge for edge in previous.edges}
    pairs = list(dict.fromkeys((edge.source_card, edge.target_card) for edge in document.edges))
    for source_id, target_id in pairs:
        source, target = cards.get(source_id), cards.get(target_id)
        if not source or not target:
            continue
        for rule in source_connection_policies(source.type, target.type):
            output, input_port = rule.source_port, rule.target_port
            endpoint = (source_id, output, target_id, input_port)
            if endpoint in endpoints:
                continue
            edge = old.get(endpoint) or GenerationCanvasEdge(id=uuid4().hex, source_card=source_id,
                source_port=output, target_card=target_id, target_port=input_port)
            document.edges.append(edge.model_copy(update={'result_scope': scopes.get((source_id, output, target_id))}))
            document.input_order.setdefault(target_id, {}).setdefault(input_port, []).append(edge.id)
            endpoints.add(endpoint)
    return document


def independent_design_edge(edge, cards):
    """只允许设计正文进入模型的独立文本输入，不扩展资产或业务身份关系。"""
    from app.services.generation_canvas.connection_policy import connection_policy
    policy = connection_policy(edge, cards)
    return bool(policy and policy.connect == 'adopt_design')


def synchronize_design_connections(document, previous):
    """新增独立设计连线即采用，清理旧候选；断线仅撤回没有正文依赖的采用。"""
    cards = {card.id: card for card in document.cards}
    old_cards = {card.id: card for card in previous.cards}
    endpoint = lambda edge: (edge.source_card, edge.source_port, edge.target_card, edge.target_port)
    old = {endpoint(edge) for edge in previous.edges if independent_design_edge(edge, old_cards)}
    removed = set()
    for edge in document.edges:
        if not independent_design_edge(edge, cards):
            continue
        target = cards[edge.target_card]
        adopted = [binding for binding in target.input_bindings if binding.source.card_id == edge.source_card
                   and binding.source.port_id == 'text' and binding.input_port == 'text']
        if adopted:
            for binding in adopted:
                binding.prompt_owned = False
            continue
        prior = old_cards.get(edge.target_card)
        was_adopted = any(binding.source.card_id == edge.source_card and binding.source.port_id == 'text' and binding.input_port == 'text' for binding in getattr(prior, 'input_bindings', []))
        if endpoint(edge) in old and not was_adopted:
            removed.add(edge.id)
        else:
            target.input_bindings.append(InputBinding(id='design:' + edge.id, input_port='text', prompt_owned=False,
                source=OutputIdentity(canvas_id=document.id, card_id=edge.source_card, port_id='text', position=0)))
    document.edges = [edge for edge in document.edges if edge.id not in removed]
    current = {endpoint(edge) for edge in document.edges}
    for card in document.cards:
        if not card.type.startswith('model.'):
            continue
        explicit = {ref.binding_id for ref, path in prompt_references(card) if path[0] == 'prompt'}
        card.input_bindings = [binding for binding in card.input_bindings
            if binding.id in explicit or (binding.source.card_id, binding.source.port_id, card.id, binding.input_port) not in old
            or (binding.source.card_id, binding.source.port_id, card.id, binding.input_port) in current]
    document.input_order = {key: {port: [item for item in ids if item not in removed] for port, ids in ports.items()}
                            for key, ports in document.input_order.items()}
    return document
