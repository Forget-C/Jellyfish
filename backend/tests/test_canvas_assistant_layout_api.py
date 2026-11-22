"""Verify an approved layout stays pending until the current editor reports its outcome."""

import json

import httpx
import pytest

from tests.test_canvas_assistant_edit_api import assistant_edit_model  # pylint: disable=unused-import
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('canvas_client', ['sqlite'], indirect=True)
async def test_layout_approval_survives_reload_and_records_one_editor_receipt(canvas_client, monkeypatch):
    canvas = (await canvas_client.post('/canvases', json={'name': '布局'})).json()['data']
    target = f"/canvases/{canvas['id']}"
    assistant = target + '/assistant'
    draft = {**canvas['document'], 'cards': [
        {'id': 'left', 'type': 'content.text'}, {'id': 'right', 'type': 'content.text'},
    ]}
    saved = await canvas_client.put(target, json={
        'request_id': 'seed', 'expected_revision': canvas['revision'], 'document': draft,
    })
    assert saved.status_code == 200, saved.text
    revision = saved.json()['data']['revision']
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        results = [item['tool_call_id'] for item in body['messages'] if item['role'] == 'tool']
        actions = [('read_canvas_context', {}), ('propose_canvas_layout', {
            'card_ids': ['left', 'right'], 'group_name': '片头',
            'placement': {'kind': 'move', 'positions': {'left': {'x': 310, 'y': 100}, 'right': {'x': 520, 'y': 100}}},
        })]
        message = {'role': 'assistant', 'content': '已准备片头布局建议'}
        if len(results) < len(actions):
            name, args = actions[len(results)]
            message = {'role': 'assistant', 'tool_calls': [{
                'id': str(len(results)), 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if len(results) < len(actions) else 'stop',
                         'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    source = {'request_id': 'layout', 'text': '把这两张卡分组并向右移动',
              'context': {'draft': draft, 'revision': revision, 'scope': 'selection', 'card_ids': ['left', 'right'],
                          'layout_positions': {'left': {'x': 100, 'y': 100}, 'right': {'x': 310, 'y': 100}}}}
    response = await canvas_client.post(assistant, json=source)
    assert response.status_code == 200, response.text
    proposal = response.json()['data']['layout']
    assert proposal['state'] == 'proposed'
    decision = assistant + '/layout/layout'
    assert (await canvas_client.post(decision, json={'action': 'applied'})).status_code == 409
    approved = await canvas_client.post(decision, json={'action': 'approve'})
    assert approved.json()['data']['state'] == 'waiting'
    history = await canvas_client.get(assistant)
    assert history.json()['data']['turns'][0]['layout']['state'] == 'waiting'
    assert (await canvas_client.get(target)).json()['data']['document']['groups'] == []
    assert (await canvas_client.post(decision, json={'action': 'applied'})).status_code == 409
    second = await canvas_client.post(assistant, json={**source, 'request_id': 'stopped-layout'})
    assert second.status_code == 200, second.text
    assert (await canvas_client.post(assistant + '/layout/stopped-layout', json={'action': 'approve'})).status_code == 200
    stopped = await canvas_client.post(assistant + '/turns/stopped-layout/stop')
    assert stopped.status_code == 200, stopped.text
    assert (await canvas_client.post(assistant + '/layout/stopped-layout', json={'action': 'claim'})).status_code == 409
    claimed = await canvas_client.post(decision, json={'action': 'claim'})
    assert claimed.json()['data']['state'] == 'executing'
    assert (await canvas_client.post(decision, json={'action': 'claim'})).json() == claimed.json()
    draft['groups'] = [{key: proposal['group'][key] for key in ('id', 'name', 'card_ids')}]
    save_group = await canvas_client.put(target, json={
        'request_id': 'editor', 'expected_revision': revision, 'document': draft,
    })
    assert save_group.status_code == 200, save_group.text
    applied = await canvas_client.post(decision, json={'action': 'applied'})
    assert applied.json()['data']['state'] == 'applied'
    replay = await canvas_client.post(decision, json={'action': 'applied'})
    assert replay.json() == applied.json()
    assert (await canvas_client.post(decision, json={'action': 'stale'})).status_code == 409
