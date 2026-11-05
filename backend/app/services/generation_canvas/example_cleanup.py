"""退休本地示例；保留普通素材候选及同源其他有效用途。"""
from copy import deepcopy

RETIRED_EXAMPLE_TYPES = {'direction.event', 'direction.activity', 'direction.guidance', 'direction.fact', 'direction.narrative', 'direction.beat', 'direction.criterion', 'direction.shot', 'direction.creative_control', 'direction.environment', 'direction.continuity', 'direction.performance', 'direction.situation', 'direction.space_rule', 'direction.blocking', 'direction.performance_rule'}
EXAMPLE_PORTS = {'image_example': 'image', 'video_example': 'video', 'audio_example': 'audio'}


def clean_examples(value):
    """解析当前编辑文档时清理旧示例，不修改调用方的原始请求或历史。"""
    if not isinstance(value, dict) or not isinstance(value.get('cards'), list):
        return value
    cards = value['cards']
    if any(not isinstance(card, dict) for card in cards):
        return value
    retired = {card.get('id') for card in cards if card.get('type') in RETIRED_EXAMPLE_TYPES}
    edges = value.get('edges', [])
    if any(not all(isinstance(edge.get(key), str) for key in ('id', 'source_card', 'source_port', 'target_card', 'target_port')) for edge in edges):
        return value
    dropped = [edge for edge in edges if edge.get('target_card') in retired and edge.get('target_port') in EXAMPLE_PORTS]
    if not dropped and not any(card.get('id') in retired and card.get('examples') for card in cards):
        return value
    result = deepcopy(value)
    for card in result['cards']:
        if card.get('id') in retired:
            card.pop('examples', None)
    ids = {edge.get('id') for edge in dropped}
    kept = [edge for edge in result.get('edges', []) if edge.get('id') not in ids]
    endpoints = {(edge.get('source_card'), edge.get('source_port'), edge.get('target_card'), edge.get('target_port')) for edge in kept}
    order = result.setdefault('input_order', {})
    for receiver, ports in order.items():
        for port in list(ports):
            if receiver in retired and port in EXAMPLE_PORTS:
                ports.pop(port)
            else:
                ports[port] = [ident for ident in ports[port] if ident not in ids]
    for edge in dropped:
        port = EXAMPLE_PORTS[edge['target_port']]
        endpoint = (edge.get('source_card'), edge.get('source_port'), edge.get('target_card'), port)
        if edge.get('source_port') != port or endpoint in endpoints:
            continue
        kept.append({**edge, 'target_port': port})
        endpoints.add(endpoint)
        order.setdefault(edge['target_card'], {}).setdefault(port, []).append(edge['id'])
    result['edges'] = kept
    return result
