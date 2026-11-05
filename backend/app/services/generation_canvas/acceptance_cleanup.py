"""退出验收卡的设计字段引用用途；只清理当前编辑文档。"""
from copy import deepcopy
from pydantic import ValidationError
from app.core.contracts.generation_canvas import DesignFieldDocument


def clean_acceptance(value, *, candidates=False):
    """保留合法关联和模型输入，删除冲突片段；历史候选不可自动变为采用。"""
    if not isinstance(value, dict) or not isinstance(value.get('cards'), list):
        return value
    edges = value.get('edges', [])
    order = value.get('input_order', {})
    if not isinstance(edges, list) or any(not isinstance(edge, dict) or any(not isinstance(edge.get(key), str) for key in ('id', 'source_card', 'target_card', 'source_port', 'target_port')) for edge in edges):
        return value
    if not isinstance(order, dict) or any(not isinstance(ports, dict) or any(not isinstance(ids, list) or any(not isinstance(item, str) for item in ids) for ids in ports.values()) for ports in order.values()):
        return value
    if any(not isinstance(card, dict) or not isinstance(card.get('id'), str) or not isinstance(card.get('type'), str) or not isinstance(card.get('input_bindings', []), list) or any(not isinstance(binding, dict) or not isinstance(binding.get('source', {}), dict) or not isinstance(binding.get('source', {}).get('card_id', ''), str) for binding in card.get('input_bindings', [])) for card in value['cards']):
        return value
    from app.services.generation_canvas.object_cleanup import clean_object_sources
    result = clean_object_sources(deepcopy(value))
    cards = {card.get('id'): card for card in result['cards'] if isinstance(card, dict)}
    criteria = {key for key, card in cards.items() if card.get('type') == 'direction.criterion'}
    if not criteria:
        return result
    removed = set()
    for edge in result.get('edges', []):
        target = cards.get(edge.get('target_card'), {})
        if edge.get('source_card') not in criteria or not target.get('type', '').startswith('direction.'):
            continue
        bound = any(binding.get('input_port') == 'acceptance_basis' and binding.get('source', {}).get('card_id') == edge['source_card'] for binding in target.get('input_bindings', []))
        if edge.get('source_port') == 'text' or candidates and not bound:
            removed.add(edge['id'])
    if removed:
        result['edges'] = [edge for edge in result.get('edges', []) if edge.get('id') not in removed]
        result['input_order'] = {key: {port: [item for item in ids if item not in removed] for port, ids in ports.items()} for key, ports in result.get('input_order', {}).items()}

    def clean_fields(node):
        if isinstance(node, list):
            for item in node:
                clean_fields(item)
        elif isinstance(node, dict):
            document = node.get('document')
            if isinstance(document, dict) and isinstance(document.get('segments'), list):
                try:
                    DesignFieldDocument.model_validate(document)
                except ValidationError:
                    return  # Invalid input belongs to the ordinary schema validation path.
                segments = document['segments']
                kept = [part for part in segments if not (isinstance(part, dict) and part.get('kind') == 'reference' and isinstance(part.get('source'), dict) and part['source'].get('card_id') in criteria)]
                if len(kept) != len(segments):
                    document['segments'] = kept
                    node['text'] = ''.join(part.get('text', '') if isinstance(part, dict) and part.get('kind') == 'text' else '@引用' for part in kept)
                    if not node['text'].strip() and not node.get('size'):
                        node.update(state='empty', purpose='design', source_locator='', authorship='user')
                        node.pop('metadata_fields', None)
            for key, item in node.items():
                if key != 'document':
                    clean_fields(item)
    for card in cards.values():
        if card.get('type', '').startswith('direction.'):
            if 'input_bindings' in card:
                card['input_bindings'] = [binding for binding in card['input_bindings'] if not (binding.get('source', {}).get('card_id') in criteria and binding.get('source', {}).get('port_id') == 'text')]
            clean_fields(card)
    return result
