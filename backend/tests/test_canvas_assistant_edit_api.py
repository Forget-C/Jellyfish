"""Verify a typed assistant edit through conversation, approval and canvas reads."""

import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('scene_owned', [False, True])
async def test_assistant_edit_requires_approval_and_replays_original_save(canvas_client, monkeypatch, scene_owned):
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id=model.id))
    if scene_owned:
        canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
        url = canvas_url(f"/canvases/p/{canvas['id']}")
        card = {'id': 'target', 'type': 'direction.movement', 'fields': {'movement_speed': {'text': '快速推近'}}}
        target = {'kind': 'movement_field', 'field': 'movement_speed'}
    else:
        canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
        url = f"/canvases/{canvas['id']}"
        card = {'id': 'target', 'type': 'model.video', 'prompt': {'segments': [
            {'kind': 'text', 'id': 'first', 'text': '快速推近'}, {'kind': 'text', 'id': 'second', 'text': '午夜蓝光'},
        ]}}
        target = {'kind': 'video_prompt_segment', 'segment_id': 'first'}
    draft = {**canvas['document'], 'cards': [*canvas['document'].get('cards', []), card]}
    saved = await canvas_client.put(url, json={'request_id': 'initial', 'expected_revision': canvas['revision'], 'document': draft})
    assert saved.status_code == 200, saved.text
    revision = saved.json()['data']['revision']
    assistant = append_canvas_path(url, '/assistant')
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        question = next(item['content'] for item in reversed(body['messages']) if item['role'] == 'user')
        results = [m['tool_call_id'] for m in body['messages'] if m['role'] == 'tool']
        if not results:
            name, args = 'read_canvas_context', {}
        elif 'call-propose_canvas_edit' not in results:
            name, args = (None, None) if question == '这种镜头怎么拍？' else (
                'propose_canvas_edit', {'card_id': 'target', 'target': target,
                                        'text': '缓慢推近' if question == '速度再慢一些' else '稍慢推近'},
            )
        else:
            name, args = None, None
        message = {'role': 'assistant', 'content': '已给出修改建议'}
        if name:
            message = {'role': 'assistant', 'tool_calls': [{
                'id': f'call-{name}', 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if name else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    source = {'request_id': 'edit-speed', 'text': '把这张卡的推近放慢',
              'context': {'draft': draft, 'revision': revision, 'scope': 'selection', 'card_ids': ['target']}}
    proposal = await canvas_client.post(assistant, json=source)
    assert proposal.status_code == 200, proposal.text
    guidance = await canvas_client.post(assistant, json={**source, 'request_id': 'guidance', 'text': '这种镜头怎么拍？'})
    assert guidance.status_code == 200, guidance.text
    assert guidance.json()['data']['proposal'] is None
    revised = await canvas_client.post(assistant, json={
        **source, 'request_id': 'revised', 'revises': 'edit-speed', 'text': '速度再慢一些',
    })
    assert revised.status_code == 200, revised.text
    assert revised.json()['data']['revises'] == 'edit-speed'
    preview = revised.json()['data']['proposal']
    assert (preview['card_id'], preview['before'], preview['after'], preview['state']) == (
        'target', '快速推近', '缓慢推近', 'pending',
    )
    assert (await canvas_client.get(url)).json()['data']['revision'] == revision
    decision = {'action': 'approve', 'expected_revision': revision}
    superseded = append_canvas_path(url, '/assistant/proposals/edit-speed')
    assert (await canvas_client.post(superseded, json=decision)).status_code == 409
    unwanted = await canvas_client.post(assistant, json={**source, 'request_id': 'unwanted'})
    assert unwanted.status_code == 200, unwanted.text
    rejections = append_canvas_path(url, '/assistant/proposals/unwanted')
    rejected = await canvas_client.post(rejections, json={**decision, 'action': 'reject'})
    assert rejected.json()['data']['proposal']['state'] == 'rejected'
    assert (await canvas_client.get(url)).json()['data']['revision'] == revision
    decision_url = append_canvas_path(url, '/assistant/proposals/revised')
    confirmed = await canvas_client.post(decision_url, json=decision)
    assert confirmed.status_code == 200, confirmed.text
    confirmation = confirmed.json()['data']
    assert confirmation['proposal']['state'] == 'applied'
    assert confirmation['receipt']['revision'] == revision + 1
    assert (await canvas_client.post(decision_url, json=decision)).json() == confirmed.json()
    reopened = (await canvas_client.get(url)).json()['data']
    actual = next(c for c in reopened['document']['cards'] if c['id'] == 'target')
    if scene_owned:
        assert actual['fields']['movement_speed']['text'] == '缓慢推近'
    else:
        assert [part['text'] for part in actual['prompt']['segments']] == ['缓慢推近', '午夜蓝光']
    assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []
