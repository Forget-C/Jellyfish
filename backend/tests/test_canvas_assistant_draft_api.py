"""Unsaved free canvas conversations through chat and first-save HTTP entry points."""
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
async def test_draft_chat_does_not_create_canvas_and_first_save_replays(canvas_client, monkeypatch):
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        user = [message['content'] for message in body['messages'] if message['role'] == 'user']
        return httpx.Response(200, request=request, json={
            'id': 'draft-answer', 'object': 'chat.completion', 'created': 1, 'model': 'canvas-text',
            'choices': [{'index': 0, 'finish_reason': 'stop',
                         'message': {'role': 'assistant', 'content': ' / '.join(user)}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    draft_id = str(uuid4())
    draft_url = f'/canvases/drafts/{draft_id}'
    baseline = (await canvas_client.get(draft_url)).json()['data']
    for index, (text, expected) in enumerate((('先讨论', '先讨论'), ('继续讨论', '先讨论 / 继续讨论'))):
        if index == 0:
            turns = []
        response = await canvas_client.post(draft_url + '/assistant', json={
            'request_id': f'turn-{index}', 'text': text, 'turns': turns,
        })
        assert response.status_code == 200, response.text
        turn = response.json()['data']
        assert turn['reply'] == expected
        turns.append(turn)
    assert (await canvas_client.get(draft_url)).json()['data']['revision'] == -1
    assert (await canvas_client.get('/canvases/' + draft_id + '/assistant')).status_code == 404

    command = {'request_id': 'first', 'expected_revision': 0, 'document': baseline['document'],
               'assistant': {'turns': turns}}
    first = await canvas_client.put(draft_url, json=command)
    assert first.status_code == 200, first.text
    repeated = await canvas_client.put(draft_url, json=command)
    assert repeated.json() == first.json()
    history = (await canvas_client.get(f'/canvases/{draft_id}/assistant')).json()['data']['turns']
    assert [(turn['request_id'], turn['text'], turn['sequence']) for turn in history] == [
        ('turn-0', '先讨论', 1), ('turn-1', '继续讨论', 2),
    ]


@pytest.mark.asyncio
async def test_approved_first_card_and_reference_are_promoted_once(canvas_client, monkeypatch):
    from app.models.llm import Model

    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        messages = json.loads(request.content)['messages']
        completed = [item['tool_call_id'] for item in messages if item['role'] == 'tool']
        helper = 'read_canvas_context' if not completed else 'propose_canvas_structure'
        answer = {'role': 'assistant', 'content': '建议新增一张镜头文本卡'}
        if 'propose_canvas_structure' not in completed:
            answer = {'role': 'assistant', 'tool_calls': [{'id': helper, 'type': 'function',
                'function': {'name': helper, 'arguments': json.dumps({
                    'change': {'kind': 'add_text_card', 'text': '潮水涌入'}},
                ) if completed else '{}'}}]}
        return httpx.Response(200, request=request, json={
            'id': 'draft-structure', 'object': 'chat.completion', 'created': 1, 'model': 'canvas-text',
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    upload = await canvas_client.post('/files/upload', files={'file': ('tide.png', b'example-image', 'image/png')})
    assert upload.status_code == 201, upload.text
    file_id = upload.json()['data']['id']
    draft, different_draft = str(uuid4()), str(uuid4())
    url = f'/canvases/drafts/{draft}'
    document = (await canvas_client.get(url)).json()['data']['document']
    sent = await canvas_client.post(url + '/assistant', json={'request_id': 'create-one', 'text': '新增文本卡',
        'attachment_file_ids': [file_id], 'context': {'draft': document, 'revision': 0, 'scope': 'canvas'}})
    assert sent.status_code == 200, sent.text
    turn = sent.json()['data']
    assert turn['proposal']['state'] == 'pending'
    assert turn['attachments'][0]['file_id'] == file_id
    assert (await canvas_client.get(f'/files/{file_id}')).json()['data']['usages'] == []
    assert not (await canvas_client.get(f'/canvases/drafts/{different_draft}')).json()['data']['document']['cards']
    assert (await canvas_client.get('/canvases')).json()['data']['pagination']['total'] == 0

    command = {'request_id': 'approved-first-save', 'expected_revision': 0, 'document': document,
        'assistant': {'turns': [turn]}, 'assistant_approval': {'source_id': 'create-one', 'group_ids': ['1']}}
    response = await canvas_client.put(url, json=command)
    assert response.status_code == 200, response.text
    assert (await canvas_client.put(url, json=command)).json() == response.json()
    assert [card['text'] for card in response.json()['data']['document']['cards']] == ['潮水涌入']
    history = (await canvas_client.get(f'/canvases/{draft}/assistant')).json()['data']['turns']
    assert len(history) == 1
    assert history[0]['proposal']['state'] == 'applied'
    assert history[0]['attachments'][0]['file_id'] == file_id
    assert len((await canvas_client.get(f'/files/{file_id}')).json()['data']['usages']) == 1
    assert (await canvas_client.get('/canvases')).json()['data']['pagination']['total'] == 1
