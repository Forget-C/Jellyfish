"""混合全部设计类型的来源清理，通过公开画布接口验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_all_design_types_share_cleanup_without_losing_explicit_roles(canvas_client, canvas_file_store):
    from app.models.generation_canvas import GenerationCanvas
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '混合25类设计'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    retired = ['criterion', 'creative_control', 'guidance', 'fact', 'performance_rule', 'situation', 'performance', 'activity',
               'narrative', 'event', 'space_rule', 'anchor', 'camera', 'lighting', 'composition', 'movement', 'focus', 'sound']
    retained = ['style', 'blocking', 'environment', 'dialogue', 'beat', 'shot', 'continuity']
    source = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person'}
    cards = [{'id': 'person', 'type': 'content.character', 'object_id': 'person', 'name': '甲', 'text': '完整人物描述'}]
    cards += [{'id': kind, 'type': 'direction.' + kind} for kind in retired + retained]
    by_id = {card['id']: card for card in cards}
    by_id['criterion'].update(name='清晰可见', criterion_id='visible', standard={'text': '手部必须清晰'})
    by_id['dialogue'].update(dialogue_id='dialogue', version=1)
    edges, order = [], {}

    def connect(ident, target, port):
        edges.append({'id': ident, 'source_card': 'person', 'source_port': 'object', 'target_card': target, 'target_port': port})
        order.setdefault(target, {}).setdefault(port, []).append(ident)

    for kind in retired:
        by_id[kind]['input_bindings'] = [{'id': 'legacy-' + kind, 'input_port': 'effect_object', 'source': source}]
        connect('legacy-' + kind, kind, 'effect_object')
    roles = [('situation', 'participant'), ('performance', 'participant'), ('activity', 'participant'), ('blocking', 'participant'),
             ('dialogue', 'speaker'), ('continuity', 'participant'), ('focus', 'attention_object'), ('focus', 'focus_object')]
    for kind, role in roles:
        ident = kind + '-' + role
        by_id[kind].setdefault('input_bindings', []).append({'id': ident, 'input_port': role, 'source': source})
        connect(ident, kind, role)
    doc = {**canvas['document'], 'cards': cards, 'edges': edges, 'input_order': order}
    # Only seed the old-format input directly; all observations use public responses.
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    first = (await client.get(url)).json()['data']
    assert first == (await client.get(url)).json()['data']
    assert first['revision'] == 1
    reopened = {card['id']: card for card in first['document']['cards']}
    for kind in retired:
        assert all(binding['input_port'] != 'effect_object' for binding in reopened[kind]['input_bindings'])
    for kind, role in roles:
        assert any(binding['input_port'] == role and binding['source'] == source for binding in reopened[kind]['input_bindings'])
    for kind in retained:
        assert reopened[kind]['type'] == 'direction.' + kind
    assert reopened['criterion']['standard']['text'] == '手部必须清晰'
    assert not any(edge['target_port'] == 'effect_object' for edge in first['document']['edges'])
    assert len({(edge['source_card'], edge['source_port'], edge['target_card'], edge['target_port']) for edge in first['document']['edges']}) == len(first['document']['edges'])
    saved = await client.put(url, json={'request_id': 'roundtrip', 'expected_revision': first['revision'], 'document': first['document']})
    assert saved.status_code == 200, saved.text
    adopted_state = (await client.get(url)).json()['data']
    adopted = adopted_state['document']
    current = {card['id']: card for card in adopted['cards']}
    current['criterion']['standard'] = {'state': 'fact', 'document': {'segments': [
        {'id': 'person', 'kind': 'reference', 'source': {key: value for key, value in {**source, 'port_id': 'text'}.items() if key != 'object_id'}},
        {'id': 'rule', 'kind': 'text', 'text': '手部必须清晰'}]}}
    current['shot'].update(name='混合镜头', visible_result={'state': 'fact', 'text': '完整镜头设计'})
    adopted['cards'].append({'id': 'model', 'type': 'model.text'})
    adopted['edges'] += [
        {'id': 'acceptance', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'},
        *[{'id': 'adopt-' + card, 'source_card': card, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for card in ['criterion', 'shot']]]
    adopted['input_order']['shot'] = {'acceptance_basis': ['acceptance']}
    adopted['input_order']['model'] = {'text': ['adopt-criterion', 'adopt-shot']}
    changed = await client.put(url, json={'request_id': 'adopt-mixed', 'expected_revision': adopted_state['revision'], 'document': adopted})
    assert changed.status_code == 200, changed.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert {item['source']['card_id'] for item in compiled['used']} == {'person', 'criterion', 'shot'}
    assert compiled['text'].count('完整人物描述') == 1
    assert '手部必须清晰' in compiled['text'] and '完整镜头设计' in compiled['text']
    catalog = (await client.get(url + '/catalog')).json()['data']['cards']
    assert all('effect_object' not in [port['id'] for port in row['inputs']] for row in catalog if row['type'] in {'direction.' + kind for kind in retired})
    stale = await client.put(url, json={'request_id': 'stale-original', 'expected_revision': 0, 'document': doc})
    assert stale.status_code == 409
