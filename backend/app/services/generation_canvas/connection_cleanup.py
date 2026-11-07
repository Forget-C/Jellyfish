"""一次性当前文档清理；不推断采用、不触碰执行快照或媒体文件。"""
from copy import deepcopy

from app.services.generation_canvas.catalog import canvas_catalog


def clean_connection_document(original):
    """按公开策略补足合法采用的来源边，撤回非法或单值冲突的采用及所属配置。"""
    document = deepcopy(original)
    catalog = canvas_catalog()
    definitions = {card.type: card for card in catalog.cards}
    policies = {(p.source_type, p.source_port, p.target_type, p.target_port): p for p in catalog.connection_policies}
    cards = {card['id']: card for card in document.get('cards', [])}

    def policy(source, target, port):
        origin = cards.get(source.get('card_id'), {})
        if source.get('canvas_id') != document['id']:
            return None
        rule = policies.get((origin.get('type'), source.get('port_id'), target.get('type'), port))
        if target.get('type', '').startswith('reference.'):
            if port == 'image_source' and origin.get('type') != 'content.image':
                return None
            if port == 'name' and origin.get('type') != target['type'].replace('reference.', 'content.'):
                return None
        return rule

    def adopted_policy(source, target, port):
        origin = cards.get(source.get('card_id'), {})
        identity = next((origin.get(key) for key in ('object_id', 'anchor_id', 'blocking_id', 'beat_id', 'event_id', 'shot_id', 'dialogue_id', 'criterion_id') if origin.get(key)), None)
        if source.get('port_id') not in ('text', 'image', 'video', 'audio') and (not identity or source.get('object_id') != identity):
            return None
        rule = policy(source, target, port)
        return rule if rule and rule.adoption_allowed else None

    edges = []
    endpoints = set()

    def add(source, target, port, edge=None):
        endpoint = (source.get('card_id'), source.get('port_id'), target['id'], port)
        if endpoint not in endpoints:
            endpoints.add(endpoint)
            edges.append(edge or dict(id=f'connection:{endpoint[2]}:{endpoint[3]}:{endpoint[0]}:{endpoint[1]}', source_card=endpoint[0], source_port=endpoint[1], target_card=endpoint[2], target_port=endpoint[3]))

    for edge in document.get('edges', []):
        target = cards.get(edge['target_card'])
        source = dict(canvas_id=document['id'], card_id=edge['source_card'], port_id=edge['source_port'])
        if target and policy(source, target, edge['target_port']):
            add(source, target, edge['target_port'], edge)
    for card in cards.values():
        definition = definitions.get(card.get('type'))
        singles = {p.id for p in definition.inputs if p.max_sources == 1} if definition else set()
        bindings = card.get('input_bindings', [])
        conflicts = {port for port in singles if len({b['source'].get('object_id') or (b['source'].get('card_id'), b['source'].get('position', 0)) for b in bindings if b['input_port'] == port}) > 1}
        removed = {b['id'] for b in bindings if b['input_port'] in conflicts or not adopted_policy(b['source'], card, b['input_port'])}
        if 'input_bindings' in card:
            card['input_bindings'] = [b for b in bindings if b['id'] not in removed]
        if removed:
            if 'prompt' in card:
                segments = card['prompt'].get('segments', [])
                card['prompt']['segments'] = [s for s in segments if s.get('kind') != 'reference' or s.get('binding_id') not in removed]
                for segment in card['prompt']['segments']:
                    if segment.get('kind') == 'instruction':
                        segment['references'] = [ref for ref in segment.get('references', []) if ref.get('binding_id') not in removed]
            if 'frame_targets' in card:
                card['frame_targets'] = [item for item in card['frame_targets'] if item['binding_id'] not in removed]
        for binding in card.get('input_bindings', []):
            add(binding['source'], card, binding['input_port'])
            if policy(binding['source'], card, binding['input_port']).connect == 'adopt_design':
                binding['prompt_owned'] = False
        if 'examples' in card:
            card['examples'] = [item for item in card['examples'] if policy(item['source'], card, item['source']['port_id'] + '_example')]
            for item in card['examples']:
                add(item['source'], card, item['source']['port_id'] + '_example')
        for key, port in (('name_binding', 'name'), ('image_binding', 'image_source')):
            value = card.get(key)
            source = value.get('source') if key == 'image_binding' and value else value
            if not source:
                continue
            if adopted_policy(source, card, port):
                add(source, card, port)
            elif key == 'image_binding':
                value['source'] = None
            else:
                card[key] = None
        frame = card.get('frame_target')
        if frame:
            source = dict(canvas_id=document['id'], card_id=frame['card_id'], port_id='text')
            origin = cards.get(frame['card_id'], {})
            states = {'field:movement_start', 'field:end_frame'} | {'phase:' + item['id'] for item in origin.get('phases', [])}
            if origin.get('type') == 'direction.movement' and frame.get('state_id') in states and policy(source, card, 'text'):
                add(source, card, 'text')
            else:
                card['frame_target'] = None

        def fields(value):
            if isinstance(value, list):
                for item in value:
                    fields(item)
            elif isinstance(value, dict):
                field_document = value.get('document')
                if isinstance(field_document, dict) and 'segments' in field_document:
                    segments = []
                    for segment in field_document['segments']:
                        source = segment.get('source')
                        if segment.get('kind') != 'reference' or not source:
                            segments.append(segment)
                        elif adopted_policy(source, card, source.get('port_id')):
                            segments.append(segment)
                            add(source, card, source['port_id'])
                    field_document['segments'] = segments
                for key, item in value.items():
                    if key != 'document':
                        fields(item)
        fields(card)
    for edge in list(edges):
        source, target = cards[edge['source_card']], cards[edge['target_card']]
        if not source.get('type', '').startswith('direction.'):
            continue
        options = [rule for rule in policies.values() if rule.source_type == source['type'] and rule.target_type == target['type']]
        if len(options) > 1:
            for rule in options:
                add(dict(canvas_id=document['id'], card_id=source['id'], port_id=rule.source_port), target, rule.target_port)
    retained = []
    for edge in edges:
        card = cards[edge['target_card']]
        rule = policy(dict(canvas_id=document['id'], card_id=edge['source_card'], port_id=edge['source_port']), card, edge['target_port'])
        adopted = any(b['source']['card_id'] == edge['source_card'] and b['source']['port_id'] == edge['source_port'] and b['input_port'] == edge['target_port'] for b in card.get('input_bindings', []))
        if rule.connect == 'candidate' or adopted:
            retained.append(edge)
    document['edges'] = retained
    ids = {edge['id'] for edge in retained}
    order = document.setdefault('input_order', {})
    for ports in order.values():
        for port, values in ports.items():
            ports[port] = [value for value in values if value in ids]
    for edge in retained:
        values = order.setdefault(edge['target_card'], {}).setdefault(edge['target_port'], [])
        if edge['id'] not in values:
            values.append(edge['id'])
    return document
