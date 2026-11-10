"""Preserve explicit frame adoption independently of regenerated model cards."""

from app.schemas.generation_canvas import ImageContentCard, VideoModelCard
from app.services.directing.storyboard_reference_cleanup import card_name, clean_lost_references


_FRAME_PORTS = {'first_frame', 'last_frame', 'key_frame'}
_SUBJECT_PORTS = {'subject_image', 'subject_video'}


def adopted_frames(document, cards):
    """Read only live manual adoptions backed by a fixed frame and graph edge."""
    adopted = {}
    for target_id, relation in (document.storyboard.visual_continuity.items() if document.storyboard else ()):
        target = cards.get(target_id)
        if not isinstance(target, VideoModelCard):
            continue
        binding = next((item for item in target.input_bindings if item.id == relation.binding_id), None)
        frame = cards.get(binding.source.card_id) if binding else None
        if not isinstance(frame, ImageContentCard) or not frame.frame_origin:
            continue
        edge = next((item for item in document.edges if item.target_card == target_id
                     and item.target_port == binding.input_port and item.source_card == frame.id
                     and item.source_port == binding.source.port_id), None)
        if edge:
            adopted[target_id] = (relation, binding, frame, edge)
    return adopted


def non_continuity_edits(current, prior, adopted):
    """A frame choice alone does not pin the whole previous model or its design inputs."""
    if not prior:
        return set(adopted)
    originals = {card.id: card for card in prior.cards}
    existing = {card.id: card for card in current.cards}
    edits = set()
    for key, (_, binding, frame, _) in adopted.items():
        card = existing[key]
        comparable = card.model_copy(update={'input_bindings': [item for item in card.input_bindings if item.id != binding.id]})
        if comparable != originals.get(key) or _ordered_connections(current, key, frame.id) != _ordered_connections(prior, key):
            edits.add(key)
    return edits


def _ordered_connections(document, card_id, excluded_source=None):
    edges = {edge.id: edge for edge in document.edges if edge.target_card == card_id and edge.source_card != excluded_source}
    return {port: selected for port, ids in document.input_order.get(card_id, {}).items()
            if (selected := [(edges[key].source_card, edges[key].source_port, edges[key].result_scope) for key in ids if key in edges])}


def _shot_labels(shots, cards):
    return {model_id: card_name(cards[shot.card_id]) + (f' · 第 {index} 段' if len(shot.model_card_ids) > 1 else '')
            for shot in shots if shot.card_id in cards for index, model_id in enumerate(shot.model_card_ids, 1)}


def _design_inputs(card, cards):
    if not isinstance(card, VideoModelCard):
        return ()
    return tuple(cards[item.source.card_id] for item in card.input_bindings
                 if item.input_port == 'text' and item.source.card_id in cards)


def _remove_edge(edges, order, edge):
    edges[:] = [item for item in edges if item.id != edge.id]
    for ids in order.get(edge.target_card, {}).values():
        if edge.id in ids:
            ids.remove(edge.id)


def _keep_frame_port(target, binding, shots, edges, order, capability):
    """Do not reactivate generated subject inputs that would displace a chosen frame."""
    if (binding.input_port not in _FRAME_PORTS or target.model_id != capability.get('model_id')
            or capability.get('supports_subject_reference_with_frame_reference')):
        return
    managed = [use for shot in shots for use in shot.reference_uses if use.model_card_id == target.id and use.active]
    ids = {use.binding_id for use in managed}
    muted = {item.id: item for item in target.input_bindings if item.id in ids and item.input_port in _SUBJECT_PORTS}
    if not muted:
        return
    target.input_bindings = [item for item in target.input_bindings if item.id not in muted]
    sources = {(item.source.card_id, item.source.port_id, item.input_port) for item in muted.values()}
    for edge in list(edges):
        if edge.target_card == target.id and (edge.source_card, edge.source_port, edge.target_port) in sources:
            _remove_edge(edges, order, edge)
    for use in managed:
        if use.binding_id in muted:
            use.active = False


def carry_visual_continuity(current, shots, previous, cards, edges, order, adopted, capability):
    """Merge fixed inputs only for surviving target identities and report reviewed impacts."""
    if not adopted:
        return {}, []
    old_labels = _shot_labels(current.storyboard.shots, previous)
    labels = _shot_labels(shots, cards)
    result, impacts = {}, []
    for target_id, (relation, binding, frame, edge) in adopted.items():
        label = old_labels.get(target_id, card_name(previous[target_id]))
        target = cards.get(target_id)
        if target_id not in labels or not isinstance(target, VideoModelCard):
            if isinstance(target, VideoModelCard):
                clean_lost_references(target, previous, cards, current.id, {binding.id: binding}, set())
                _remove_edge(edges, order, edge)
            impacts.append(f'{label}：接收镜头已移除，将解除人工承接，保留固定图片。')
            continue
        _keep_frame_port(target, binding, shots, edges, order, capability)
        if not any(item.id == binding.id for item in target.input_bindings):
            target.input_bindings.append(binding)
        if not any(item.id == edge.id for item in edges):
            edges.append(edge.model_copy(update={'order_anchor': None}))
            order.setdefault(target_id, {}).setdefault(binding.input_port, []).append(edge.id)
        result[target_id] = relation
        source_id = frame.frame_origin.source_card_id
        if source_id not in labels:
            impacts.append(f'{label}：来源镜头已移除，仍保留人工承接与固定图片。')
        elif any(_design_inputs(previous.get(key), previous) != _design_inputs(cards.get(key), cards)
                 for key in (source_id, target_id)):
            impacts.append(f'{label}：设计变化可能影响人工承接，应用后仍保留固定图片。')
    return result, impacts
