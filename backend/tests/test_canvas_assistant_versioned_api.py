"""真实双画布入口使用新工具、版本化审批和执行回执。"""

import json

import httpx
import pytest

from app.models.llm import Model, Provider
from tests.canvas_urls import seed_scene_canvas
from tests.chat_events import observe_canvas_turn, read_canvas_events
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize(('scene', 'native'), [(False, True), (True, False)])
async def test_assistant_partial_approval_uses_original_version_and_actual_receipt(canvas_client, monkeypatch, scene, native):
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}} if native else None
        (await db.get(Provider, model.provider_id)).api_key = 'fixture'
    groups = [
        {'title': '第一镜', 'changes': [{'kind': 'add_card', 'reference': 'one',
            'card': {'kind': 'add_text_card', 'text': '第一镜晨光'}}]},
        {'title': '第二镜', 'changes': [{'kind': 'add_card', 'reference': 'two',
            'card': {'kind': 'add_text_card', 'text': '第二镜桥面'}}]},
    ]
    created = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '镜头'}) if scene
               else await canvas_client.post('/canvases', json={'name': '镜头'}))
    canvas = created.json()['data']
    path = f"/canvases/{canvas['id']}"
    params = {'project_id': 'p'} if scene else {}
    selected = await canvas_client.patch(path + '/assistant/model', params=params, json={'model_id': 'canvas-text'})
    assert selected.status_code == 200, selected.text
    original = httpx.AsyncClient.send

    async def respond(self, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(self, request, **kwargs)
        if native:
            command = json.loads(request.content)
            names = {entry['function']['name'] for entry in command.get('tools', ())}
            assert 'preview_canvas_changes' in names and 'read_canvas' in names
            assert 'propose_canvas_changes' not in names
            results = {item.get('tool_call_id') for item in command['messages'] if item['role'] == 'tool'}
            if 'preview' not in results:
                identity = 'preview' if 'read' in results else 'read'
                tool, args = ('preview_canvas_changes', {'groups': groups}) if identity == 'preview' else ('read_canvas', {})
                reply = {'role': 'assistant', 'tool_calls': [{'id': identity, 'type': 'function', 'function': {
                    'name': tool, 'arguments': json.dumps(args, ensure_ascii=False),
                }}]}
            else:
                reply = {'role': 'assistant', 'content': '请核对两个独立镜头。'}
        else:
            reply = {'role': 'assistant', 'content': json.dumps({'reply': '请核对两个独立镜头。', 'groups': groups}, ensure_ascii=False)}
        return httpx.Response(200, request=request, json={'id': 'controlled', 'object': 'chat.completion',
            'created': 1, 'model': 'canvas-text', 'choices': [{'index': 0, 'message': reply,
                'finish_reason': 'tool_calls' if 'tool_calls' in reply else 'stop'}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    conversation = await observe_canvas_turn(canvas_client, path, json={
        'request_id': 'two-shots', 'text': '请新建两个镜头的内容卡',
        'context': {'scope': 'canvas', 'revision': canvas['revision'], 'draft': canvas['document']},
    })
    assert conversation.receipt.status_code == 202, conversation.receipt.text
    turn = conversation.detail
    [first, second] = turn['proposal']['groups']
    assert first['state'] == second['state'] == 'pending'
    assert (await canvas_client.get(path, params=params)).json()['data']['revision'] == canvas['revision']
    choice = {'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': [first['id']], 'decision_id': 'click'}
    decision_path = path + '/assistant/proposals/two-shots'
    response = await canvas_client.post(decision_path, params=params, json=choice)
    assert response.status_code == 200, response.text
    applied = response.json()['data']
    assert applied['receipt'] and not applied['graph_resumed']
    assert [group['state'] for group in applied['proposal']['groups']] == ['applied', 'pending']
    assert [card['text'] for card in applied['canvas']['document']['cards']] == ['第一镜晨光']
    assert (await canvas_client.post(decision_path, params=params, json=choice)).json()['data']['receipt'] == applied['receipt']
    events = await read_canvas_events(canvas_client, path)
    assert [event['type'] for event in events].count('approval.decided') == 1
    assert [event['type'] for event in events].count('execution.succeeded') == 1
