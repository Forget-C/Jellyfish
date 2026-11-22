"""Verify approval affects the design actually adopted by the selected shot."""

import pytest

from tests.canvas_urls import canvas_url, seed_scene_canvas
from tests.test_canvas_assistant_edit_api import assistant_edit_model  # pylint: disable=unused-import
from tests.test_canvas_assistant_structure_api import approve_structure, mock_structure_reply, send_structure
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('mode', ['shared', 'dedicated', 'stale'])
async def test_assistant_isolates_the_adopted_shot_movement(canvas_client, monkeypatch, mode):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '运镜分镜'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    document = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'shared', 'port_id': 'text', 'position': 0}
    document.update(cards=[
        {'id': 'shared', 'type': 'direction.movement',
         'fields': {'movement_speed': {'state': 'proposal', 'text': '快速推近'}}},
        {'id': 'candidate', 'type': 'direction.movement',
         'fields': {'movement_speed': {'state': 'proposal', 'text': '候选横摇'}}},
        *[{'id': f'shot{n}', 'type': 'model.video', 'input_bindings': [] if n == 4 and mode == 'dedicated' else [
            {'id': f'adopt{n}', 'input_port': 'text', 'source': source}]} for n in (3, 4)],
    ], edges=[
        *[{'id': f'move{n}', 'source_card': 'shared', 'source_port': 'text',
           'target_card': f'shot{n}', 'target_port': 'text'} for n in ((3,) if mode == 'dedicated' else (3, 4))],
    ], input_order={f'shot{n}': {'text': [f'move{n}']} for n in ((3,) if mode == 'dedicated' else (3, 4))})
    saved = await client.put(url, json={'request_id': 'seed-movement', 'expected_revision': canvas['revision'],
                                       'document': document})
    assert saved.status_code == 200, saved.text
    canvas = (await client.get(url)).json()['data']
    mock_structure_reply(monkeypatch, {
        'kind': 'adjust_shot_movement', 'card_id': 'shot3', 'field': 'movement_speed', 'text': '缓慢推近',
    })
    response = await send_structure(client, url, canvas, '只把镜头三的推近放慢', target='shot3')
    proposal = response['proposal']
    assert proposal is not None, response
    assert proposal['before'] == '快速推近'
    assert proposal['target']['other_consumer_ids'] == ([] if mode == 'dedicated' else ['shot4'])
    copy_id = proposal['target']['copy_card_id']
    assert bool(copy_id) == (mode != 'dedicated')

    if mode == 'stale':
        canvas['document']['cards'][3]['input_bindings'] = []
        canvas['document']['edges'] = [edge for edge in canvas['document']['edges'] if edge['id'] != 'move4']
        canvas['document']['input_order'].pop('shot4')
        saved = await client.put(url, json={'request_id': 'detach-other', 'expected_revision': canvas['revision'],
                                           'document': canvas['document']})
        assert saved.status_code == 200, saved.text
        canvas = (await client.get(url)).json()['data']

    result = await approve_structure(client, url, canvas, proposal)
    assert result.status_code == 200, result.text
    data = result.json()['data']
    if mode == 'stale':
        assert data['conflicts'][0]['card_id'] == 'shot3'
        assert data['receipt'] is None
        return

    reopened = (await client.get(url)).json()['data']['document']
    by_id = {card['id']: card for card in reopened['cards']}
    after = copy_id or 'shared'
    assert by_id[after]['fields']['movement_speed']['text'] == '缓慢推近'
    assert by_id['shot3']['input_bindings'][0]['source']['card_id'] == after
    assert by_id['shot3']['input_bindings'][0]['id'] == 'adopt3'
    assert next(edge for edge in reopened['edges'] if edge['id'] == 'move3')['source_card'] == after
    assert by_id['candidate']['fields']['movement_speed']['text'] == '候选横摇'
    actual = (await client.get(url + '/cards/shot3/compile')).json()['data']
    assert '缓慢推近' in actual['text'] and '候选横摇' not in actual['text']
    if mode == 'shared':
        assert by_id['shared']['fields']['movement_speed']['text'] == '快速推近'
        assert by_id['shot4']['input_bindings'][0]['source']['card_id'] == 'shared'
        other = (await client.get(url + '/cards/shot4/compile')).json()['data']
        assert '快速推近' in other['text'] and '缓慢推近' not in other['text']
