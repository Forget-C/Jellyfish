"""验收关系随设计采用进入编译，不创建额外画布连线或持久模型绑定。"""
from app.core.contracts.generation_canvas import InputBinding, DesignTextPayload
from app.services.generation_canvas.output_resolution import identity_key, prompt_references


def acceptance_inputs(context, card, candidates, model_outputs):
    """只展开实际采用设计的直接验收要求；标准与媒体复用完整设计编译。"""
    selected = {identity_key(ref.source) for ref, _ in prompt_references(card)}
    designs = [item for item in candidates if item.available and identity_key(item.source) in selected
               and isinstance(item.payload, DesignTextPayload)]
    bindings, outputs = list(card.input_bindings), list(candidates)
    known = {identity_key(item.source) for item in outputs}
    for design in designs:
        source = context.cards.get(design.source.card_id)
        for binding in getattr(source, 'input_bindings', []):
            if binding.input_port != 'acceptance_basis':
                continue
            for output in context.published_outputs(binding.source.card_id, model_outputs=model_outputs):
                if not isinstance(output.payload, DesignTextPayload) or output.payload.design_type != 'direction.criterion':
                    continue
                key = identity_key(output.source)
                if key not in selected:
                    bindings.append(InputBinding(id='acceptance:' + binding.source.card_id, source=output.source, input_port='text'))
                    selected.add(key)
                if key not in known:
                    outputs.append(output)
                    known.add(key)
    return card.model_copy(update={'input_bindings': bindings}), outputs


def synchronize_acceptance(document, previous):
    """唯一验收用途随线生效；多用途由接收端选择，断线同步解除弱关联。"""
    old_edges = {(edge.source_card, edge.target_card) for edge in previous.edges
                 if edge.source_port == 'criterion' and edge.target_port == 'acceptance_basis'}
    from app.services.generation_canvas.design_connections import multiple_source_uses
    previous_cards = {card.id: card for card in previous.cards}
    old_candidates = {(source, target) for source, target in old_edges
        if not any(binding.input_port == 'acceptance_basis' and binding.source.card_id == source
                   for binding in getattr(previous_cards.get(target), 'input_bindings', []))}
    cards = {card.id: card for card in document.cards}
    removed = set()
    for edge in document.edges:
        if edge.source_port != 'criterion' or edge.target_port != 'acceptance_basis':
            continue
        if multiple_source_uses(document, edge.source_card, edge.target_card):
            continue
        source, target = cards.get(edge.source_card), cards.get(edge.target_card)
        if not source or source.type != 'direction.criterion' or not hasattr(target, 'input_bindings'):
            continue
        bound = any(binding.input_port == 'acceptance_basis' and binding.source.card_id == source.id
                    for binding in target.input_bindings)
        if not bound and ((source.id, target.id) in old_candidates or any(binding.input_port == 'acceptance_basis' and binding.source.card_id == source.id for binding in getattr(previous_cards.get(target.id), 'input_bindings', []))):
            removed.add(edge.id)
        elif not bound:
            from app.core.contracts.generation_canvas import OutputIdentity
            target.input_bindings.append(InputBinding(id='acceptance:' + edge.id, input_port='acceptance_basis',
                source=OutputIdentity(canvas_id=document.id, card_id=source.id, port_id='criterion', position=0, object_id=source.criterion_id)))
    document.edges = [edge for edge in document.edges if edge.id not in removed]
    document.input_order = {key: {port: [edge for edge in ids if edge not in removed] for port, ids in ports.items()}
                            for key, ports in document.input_order.items()}
    current = {(edge.source_card, edge.target_card) for edge in document.edges
               if edge.source_port == 'criterion' and edge.target_port == 'acceptance_basis'}
    for card in document.cards:
        if hasattr(card, 'input_bindings'):
            card.input_bindings = [binding for binding in card.input_bindings
                if binding.input_port != 'acceptance_basis' or (binding.source.card_id, card.id) not in old_edges
                or (binding.source.card_id, card.id) in current]
    return document
