"""堆叠行为仅通过公开 HTTP 观察，组织不是集合输出。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


async def saved_stack(client):
    canvas = (await client.post('/canvases/p', json={'name': '堆叠'})).json()['data']
    document = canvas['document']
    document['cards'] = [
        {'id': 'source', 'type': 'content.text', 'type_version': 1, 'text': '来源'},
        {'id': 'inside', 'type': 'model.text', 'type_version': 1, 'model_id': 'canvas-text', 'prompt': {'segments': []}},
        {'id': 'outside', 'type': 'model.text', 'type_version': 1, 'model_id': 'canvas-text', 'prompt': {'segments': []}},
    ]
    document['edges'] = [{'id': 'incoming', 'source_card': 'source', 'source_port': 'text', 'target_card': 'inside', 'target_port': 'text'},
                         {'id': 'outgoing', 'source_card': 'inside', 'source_port': 'text', 'target_card': 'outside', 'target_port': 'text'}]
    document['input_order'] = {'inside': {'text': ['incoming']}, 'outside': {'text': ['outgoing']}}
    document['groups'] = [{'id': 'stack', 'name': '堆叠', 'kind': 'stack', 'card_ids': ['inside'], 'collapsed': False}]
    url = f"/canvases/p/{canvas['id']}"
    response = await client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    return url, (await client.get(url)).json()['data']['document']


@pytest.mark.asyncio
async def test_stack_is_persisted_separately_from_collapsed_group(canvas_client):
    _, document = await saved_stack(canvas_client)
    assert document['groups'][0]['kind'] == 'stack'
    assert document['groups'][0]['collapsed'] is False


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['content', 'incoming', 'source', 'member', 'membership'])
async def test_saved_stack_requires_unstack_before_editing_members_or_inputs(canvas_client, change):
    url, document = await saved_stack(canvas_client)
    if change == 'content':
        document['cards'][1]['prompt'] = {'segments': [{'id': 'new', 'kind': 'text', 'text': '变更'}]}
    elif change in ('incoming', 'source'):
        document['edges'] = [edge for edge in document['edges'] if edge['id'] != 'incoming']
        document['input_order']['inside']['text'] = []
        if change == 'source':
            document['cards'] = [card for card in document['cards'] if card['id'] != 'source']
    elif change == 'member':
        document['cards'] = [card for card in document['cards'] if card['id'] != 'inside']
        document['edges'] = []
        document['input_order'] = {}
    else:
        document['groups'][0]['card_ids'].append('source')
    response = await canvas_client.put(url, json={'request_id': 'edit', 'expected_revision': 1, 'document': document})
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'STACK_READ_ONLY'
    unchanged = (await canvas_client.get(url)).json()['data']
    assert unchanged['revision'] == 1


@pytest.mark.asyncio
async def test_stack_does_not_freeze_external_sources_or_external_receivers(canvas_client):
    url, document = await saved_stack(canvas_client)
    document['cards'][0]['text'] = '新来源正文仍可发布'
    document['edges'] = [edge for edge in document['edges'] if edge['id'] != 'outgoing']
    document['input_order']['outside']['text'] = []
    response = await canvas_client.put(url, json={'request_id': 'external', 'expected_revision': 1, 'document': document})
    assert response.status_code == 200, response.text
    reopened = (await canvas_client.get(url)).json()['data']['document']
    assert reopened['cards'][0]['text'] == '新来源正文仍可发布'
    assert [edge['id'] for edge in reopened['edges']] == ['incoming']


@pytest.mark.asyncio
async def test_explicit_unstack_restores_member_editing(canvas_client):
    url, document = await saved_stack(canvas_client)
    document['groups'] = []
    document['cards'][1]['prompt'] = {'segments': [{'id': 'new', 'kind': 'text', 'text': '解除后修改'}]}
    response = await canvas_client.put(url, json={'request_id': 'unstack', 'expected_revision': 1, 'document': document})
    assert response.status_code == 200, response.text
    reopened = (await canvas_client.get(url)).json()['data']['document']
    assert reopened['groups'] == []
    assert reopened['cards'][1]['prompt']['segments'][0]['text'] == '解除后修改'


@pytest.mark.asyncio
async def test_stack_member_cannot_start_new_generation(canvas_client):
    url, _ = await saved_stack(canvas_client)
    response = await canvas_client.post(url + '/precheck', json={'card_id': 'inside'})
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'STACK_READ_ONLY'
