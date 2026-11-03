"""有限清理已退出的摄影内容；只处理当前编辑文档，不改写历史依据。"""
from copy import deepcopy

VISUAL_DESIGNS = {'direction.style', 'direction.composition', 'direction.movement', 'direction.camera', 'direction.lighting', 'direction.focus'}


def retire_photography(value):
    """移除退役卡及明确依赖，保留无关正文并给接收模型留下待处理标记。"""
    if not isinstance(value, dict) or not isinstance(value.get('cards'), list):
        return value
    removed = {card['id'] for card in value['cards'] if isinstance(card, dict) and card.get('type') == 'direction.photography' and 'id' in card}
    examples = any(isinstance(card, dict) and card.get('type') in VISUAL_DESIGNS and card.get('examples') for card in value['cards'])
    if not removed and not examples:
        return value
    result = deepcopy(value)
    removed_edges = {edge['id'] for edge in result.get('edges', []) if edge.get('source_card') in removed or edge.get('target_card') in removed}
    result['edges'] = [edge for edge in result.get('edges', []) if edge.get('id') not in removed_edges]
    result['cards'] = [card for card in result['cards'] if card.get('id') not in removed]
    for card in result['cards']:
        if card.get('type') in VISUAL_DESIGNS:
            card.pop('examples', None)
        missing = set(card.get('missing_designs', []))
        bindings = card.get('input_bindings', [])
        dropped = {binding['id'] for binding in bindings if binding.get('source', {}).get('card_id') in removed}
        missing.update(binding['source']['card_id'] for binding in bindings if binding.get('source', {}).get('card_id') in removed)
        if 'input_bindings' in card:
            card['input_bindings'] = [binding for binding in bindings if binding.get('id') not in dropped]
        segments = card.get('prompt', {}).get('segments', [])
        kept = []
        for segment in segments:
            source = segment.get('source', {})
            refs = segment.get('references', [])
            affected = source.get('card_id') in removed or segment.get('binding_id') in dropped or any(ref.get('source', {}).get('card_id') in removed or ref.get('binding_id') in dropped for ref in refs)
            if affected:
                missing.update(ref.get('source', {}).get('card_id') for ref in [segment, *refs] if ref.get('source', {}).get('card_id') in removed)
            else:
                kept.append(segment)
        if 'prompt' in card:
            card['prompt']['segments'] = kept
        if 'frame_targets' in card:
            card['frame_targets'] = [target for target in card['frame_targets'] if target.get('binding_id') not in dropped]
        if card.get('type', '').startswith('model.') and missing:
            card['missing_designs'] = sorted(missing)
    result['input_order'] = {receiver: {port: [edge for edge in edges if edge not in removed_edges] for port, edges in ports.items()} for receiver, ports in result.get('input_order', {}).items() if receiver not in removed}
    for group in result.get('groups', []):
        group['card_ids'] = [identity for identity in group.get('card_ids', []) if identity not in removed]
    return result


def require_supported_snapshot(snapshot):
    """旧固定依据不可清理后继续执行，以免改变历史任务的创作输入。"""
    cards = snapshot.get('document', {}).get('cards', [])
    if any(card.get('type') == 'direction.photography' or card.get('type') in VISUAL_DESIGNS and card.get('examples') or any('photography_scope' in binding for binding in card.get('input_bindings', [])) for card in cards):
        from fastapi import HTTPException
        raise HTTPException(422, {'code': 'LEGACY_DESIGN_SNAPSHOT', 'message': '旧画面设计固定依据已不受支持，请使用当前独立设计重新提交'})
