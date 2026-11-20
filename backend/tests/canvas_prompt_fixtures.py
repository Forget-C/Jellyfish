"""Build wire-format prompts from source identities used in test scenarios."""


def bind_prompt_sources(card):
    """Give each explicit adoption a stable ID and keep source identity on the binding."""
    bindings = card.setdefault('input_bindings', [])
    for segment in card.get('prompt', {}).get('segments', []):
        references = [segment] if segment['kind'] == 'reference' else segment.get('references', [])
        port = {'首帧参考': 'first_frame', '尾帧参考': 'last_frame', '关键帧参考': 'key_frame',
                '主体参考': 'subject_image'}.get(segment.get('command'))
        subject = segment.get('parameters', {}).get('name', '').strip() if segment.get('command') == '主体参考' else None
        for reference in references:
            if 'binding_id' in reference:
                continue
            source = reference.pop('source')
            purpose = port or source['port_id']
            if card['type'] == 'model.video' and purpose in {'image', 'video'}:
                purpose = 'subject_' + purpose
            if purpose == 'subject_image' and source['port_id'] == 'video':
                purpose = 'subject_video'
            binding = next((item for item in bindings if item['source'] == source and item['input_port'] == purpose
                            and item.get('subject_name') == subject), None)
            if binding is None:
                binding = {'id': 'input-' + reference['id'], 'input_port': purpose, 'source': source,
                           'subject_name': subject}
                bindings.append(binding)
            reference['binding_id'] = binding['id']
    return card


def bind_document_prompts(document):
    """Prepare model prompts only; design field references carry their own source."""
    for card in document.get('cards', []):
        if card['type'].startswith('model.') and card.get('prompt'):
            bind_prompt_sources(card)
    return document
