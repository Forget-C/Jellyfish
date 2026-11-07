"""一次性当前文档清理；不推断采用、不触碰执行快照或媒体文件。"""
from copy import deepcopy

from app.services.generation_canvas.catalog import canvas_catalog
from app.services.generation_canvas.connection_policy import source_connection_policies


def clean_connection_document(original):
    """按公开策略补足合法采用的来源边，撤回非法或单值冲突的采用及所属配置。"""
    document = deepcopy(original)
    catalog = canvas_catalog()
    definitions = {card.type: card for card in catalog.cards}
    policies = {(p.source_type, p.source_port, p.target_type, p.target_port): p for p in catalog.connection_policies}
    cards = {card['id']: card for card in document.get('cards', [])}

    def policy(source, target, port):
        origin = cards.get(source.get('card_id'), {})
        if source.get('canvas_id') != document['id'] or source.get('card_id') == target['id']:
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
        valid = [b for b in bindings if adopted_policy(b['source'], card, b['input_port'])]
        conflicts = {port for port in singles if len({identity_key(b['source']) for b in valid if b['input_port'] == port}) > 1}
        kept = {}
        remapped = {}
        frames = {item['binding_id']: item.get('state_id') for item in card.get('frame_targets', [])}
        for binding in valid:
            if binding['input_port'] in conflicts:
                continue
            key = (binding['input_port'], identity_key(binding['source']), binding.get('subject_name') or '', frames.get(binding['id']))
            if key not in kept:
                kept[key] = binding
            else:
                canonical = kept[key]
                remapped[binding['id']] = canonical['id']
                if binding.get('prompt_owned') is False:
                    canonical['prompt_owned'] = False
        retained_ids = {binding['id'] for binding in kept.values()}
        removed = {binding['id']: binding for binding in bindings if binding['id'] not in retained_ids and binding['id'] not in remapped}
        if 'input_bindings' in card:
            card['input_bindings'] = list(kept.values())
        if (removed or remapped) and 'prompt' in card:
            _repair_prompt(card['prompt'], removed, remapped)
        if 'frame_targets' in card and (removed or remapped):
            card['frame_targets'] = [item for item in card['frame_targets'] if item['binding_id'] in retained_ids]
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
                        else:
                            segments.append(segment)
                            if adopted_policy(source, card, source.get('port_id')):
                                add(source, card, source['port_id'])
                    field_document['segments'] = segments
                for key, item in value.items():
                    if key != 'document':
                        fields(item)
        fields(card)
    pairs = dict.fromkeys((edge['source_card'], edge['target_card']) for edge in edges)
    for source_id, target_id in pairs:
        source, target = cards[source_id], cards[target_id]
        for rule in source_connection_policies(source['type'], target['type']):
            add(dict(canvas_id=document['id'], card_id=source_id, port_id=rule.source_port), target, rule.target_port)
    retained = []
    for edge in edges:
        card = cards[edge['target_card']]
        rule = policy(dict(canvas_id=document['id'], card_id=edge['source_card'], port_id=edge['source_port']), card, edge['target_port'])
        adopted = any(b['source']['card_id'] == edge['source_card'] and b['source']['port_id'] == edge['source_port'] and b['input_port'] == edge['target_port'] for b in card.get('input_bindings', []))
        if rule.connect == 'candidate' or adopted:
            retained.append(edge)
    document['edges'] = retained
    endpoints_by_id = {edge['id']: (edge['target_card'], edge['target_port']) for edge in retained}
    order = {}
    for target_id, ports in document.get('input_order', {}).items():
        definition = definitions.get(cards.get(target_id, {}).get('type'))
        if not definition:
            continue
        inputs = {port.id for port in definition.inputs}
        order[target_id] = {port: [value for value in dict.fromkeys(values) if endpoints_by_id.get(value) == (target_id, port)]
                            for port, values in ports.items() if port in inputs}
    document['input_order'] = order
    for edge in retained:
        values = order.setdefault(edge['target_card'], {}).setdefault(edge['target_port'], [])
        if edge['id'] not in values:
            values.append(edge['id'])
    return document


def identity_key(source):
    """Stable output identity; position is secondary to a typed object identity."""
    return (source.get('canvas_id'), source.get('card_id'), source.get('port_id'), source.get('object_id') or source.get('position', 0))


def _repair_prompt(prompt, removed, remapped):
    """Keep an unconfirmed token for each lost reference so preflight still flags it."""
    def fallback(reference):
        source = removed[reference['binding_id']]['source']
        label = {'image': '图片', 'video': '视频', 'audio': '音频'}.get(source.get('port_id'), '文本')
        return dict(id=reference['id'], kind='text', text=f"@{label}〔引用失效：{source.get('card_id')}〕")

    def redirect(reference):
        identifier = reference.get('binding_id')
        return {**reference, 'binding_id': remapped[identifier]} if identifier in remapped else reference

    segments = []
    for segment in prompt.get('segments', []):
        if segment.get('kind') == 'reference':
            segments.append(fallback(segment) if segment.get('binding_id') in removed else redirect(segment))
        elif segment.get('kind') == 'instruction':
            refs = segment.get('references', [])
            segments.append({**segment, 'references': [redirect(ref) for ref in refs if ref.get('binding_id') not in removed]})
            segments.extend(fallback(ref) for ref in refs if ref.get('binding_id') in removed)
        else:
            segments.append(segment)
    prompt['segments'] = segments
