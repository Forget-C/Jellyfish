"""清理已退役的通用对象用途，保留合法候选和其他明确用途。"""

# 按已落地的卡片类型扩展；未迁移类型不能提前失去其现有用途。
RETIRED_OBJECT_TYPES = {'direction.criterion', 'direction.creative_control', 'direction.guidance', 'direction.fact', 'direction.performance_rule', 'direction.situation', 'direction.performance', 'direction.activity', 'direction.narrative', 'direction.event', 'direction.space_rule', 'direction.anchor'}


def candidate_endpoint(source):
    """完整设计／描述用正文作为候选；独立参考仍选择具体图片而非对象字段。"""
    kind = source.get('type', '')
    if kind.startswith(('direction.', 'content.')) and kind not in ('content.image', 'content.video', 'content.audio') or kind == 'model.text':
        return 'text'
    if kind.startswith('reference.') or kind in ('content.image', 'model.image'):
        return 'image'
    if kind in ('content.video', 'model.video'):
        return 'video'
    return None


def clean_object_sources(document):
    """接收已验证基础结构的文档副本；只移除通用绑定，不制造新的实际采用。"""
    cards = {card['id']: card for card in document['cards']}
    retired = {key for key, card in cards.items() if card['type'] in RETIRED_OBJECT_TYPES}
    for key in retired:
        card = cards[key]
        if 'input_bindings' in card:
            card['input_bindings'] = [binding for binding in card['input_bindings'] if binding.get('input_port') != 'effect_object']
    edges = document.get('edges', [])
    kept = [edge for edge in edges if not (edge['target_card'] in retired and edge['target_port'] == 'effect_object')]
    endpoints = {(edge['source_card'], edge['source_port'], edge['target_card'], edge['target_port']) for edge in kept}
    replacements = {}
    for edge in edges:
        if edge['target_card'] not in retired or edge['target_port'] != 'effect_object':
            continue
        port = candidate_endpoint(cards.get(edge['source_card'], {}))
        endpoint = (edge['source_card'], port, edge['target_card'], port)
        if port and endpoint not in endpoints:
            replacement = {**edge, 'source_port': port, 'target_port': port}
            kept.append(replacement)
            endpoints.add(endpoint)
            replacements[edge['id']] = replacement
    changed_ids = {edge['id'] for edge in edges if edge['target_card'] in retired and edge['target_port'] == 'effect_object'}
    document['edges'] = kept
    order = document.setdefault('input_order', {})
    for key, ports in order.items():
        for port in list(ports):
            ports[port] = [ident for ident in ports[port] if ident not in changed_ids]
        if key in retired:
            ports.pop('effect_object', None)
    for ident, edge in replacements.items():
        order.setdefault(edge['target_card'], {}).setdefault(edge['target_port'], []).append(ident)
    return document
