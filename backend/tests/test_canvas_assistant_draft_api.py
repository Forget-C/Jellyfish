"""Unsaved free canvas conversations through chat and first-save HTTP entry points."""
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.test_canvas_assistant_edit_api import assistant_edit_model  # pylint: disable=unused-import
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
async def test_old_browser_proposal_cannot_write_but_plain_history_promotes(canvas_client):
    draft = str(uuid4())
    url = f'/canvases/drafts/{draft}'
    document = (await canvas_client.get(url)).json()['data']['document']
    change = {'card_id': 'forged', 'card_name': '镜头说明', 'before': '', 'after': '过去的方案',
              'target': {'kind': 'add_canvas_card',
                         'card': {'kind': 'add_text_card', 'text': '过去的方案'}}}
    turn = {'request_id': 'old-browser', 'text': '讨论镜头', 'reply': '原普通正文', 'model_id': 'canvas-text',
            'sequence': 1, 'proposal': {**change, 'state': 'pending',
              'groups': [{'id': '1', 'title': '旧待审', 'edits': [change], 'state': 'pending'}]}}
    command = {'request_id': 'old-approval', 'expected_revision': 0, 'document': document,
               'assistant': {'turns': [turn]}, 'assistant_approval': {'source_id': 'old-browser', 'group_ids': ['1']}}
    refused = await canvas_client.put(url, json=command)
    assert refused.status_code == 409 and '已失效' in refused.json()['detail'], refused.text
    assert (await canvas_client.get(url)).json()['data']['revision'] == -1

    saved = await canvas_client.put(url, json={**command, 'request_id': 'ordinary-save', 'assistant_approval': None})
    assert saved.status_code == 200, saved.text
    current = (await canvas_client.get(url)).json()['data']['document']
    assert current['cards'] == []
    history = (await canvas_client.get(f'/canvases/{draft}/assistant')).json()['data']['turns']
    assert history[0]['reply'] == '原普通正文'
    assert history[0]['proposal'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('plan_only,revise', [(False, False), (True, False), (False, True)])
async def test_approved_first_card_and_reference_are_promoted_once(canvas_client, monkeypatch, plan_only, revise):
    from app.models.llm import Model

    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        messages = json.loads(request.content)['messages']
        completed = [item['tool_call_id'] for item in messages if item['role'] == 'tool']
        helper = 'read_canvas' if not completed else 'preview_canvas_changes'
        answer = {'role': 'assistant', 'content': '建议新增一张镜头文本卡'}
        if 'preview_canvas_changes' not in completed:
            answer = {'role': 'assistant', 'tool_calls': [{'id': helper, 'type': 'function',
                'function': {'name': helper, 'arguments': json.dumps({
                    'groups': [{'title': '镜头说明', 'changes': [{'kind': 'add_card', 'reference': 'tide', 'card': {'kind': 'add_text_card', 'text': '潮水涌入'}}]}]},
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
    sent = await canvas_client.post(url + '/assistant', json={'request_id': 'create-one',
        'text': '只给方案，先不要写入画布' if plan_only else '新增文本卡',
        'attachment_file_ids': [file_id], 'context': {'draft': document, 'revision': 0, 'scope': 'canvas'}})
    assert sent.status_code == 200, sent.text
    turn = sent.json()['data']
    if plan_only:
        from app.services.approval import ApprovalService
        from app.services.generation_canvas.assistant_versioned_approval import canvas_operator_access
        assert turn['proposal'] is None
        assert (await canvas_client.get(url)).json()['data']['revision'] == -1
        async with canvas_client.canvas_sessions() as db:
            assert await ApprovalService(db).read_submitted(canvas_operator_access(draft),
                object_type='canvas-edit', object_id='draft:create-one', idempotency_key='draft:create-one') is None
        preview = turn['preview']
        submit = {'request_id': 'submit-draft', 'text': '送审', 'submit_preview_id': preview['id'],
                  'turns': [turn], 'context': {'draft': document, 'revision': 0, 'scope': 'canvas'}}
        wrong_canvas = await canvas_client.post(f'/canvases/drafts/{different_draft}/assistant', json=submit)
        assert wrong_canvas.status_code == 409, wrong_canvas.text
        changed = {**submit, 'context': {**submit['context'], 'draft': {**document, 'name': '新版本'}}}
        stale = await canvas_client.post(url + '/assistant', json=changed)
        assert stale.status_code == 409, stale.text
        sent_for_approval = await canvas_client.post(url + '/assistant', json=submit)
        assert sent_for_approval.status_code == 200, sent_for_approval.text
        approval = sent_for_approval.json()['data']
        assert approval['proposal'] == preview['proposal'] and approval['submitted_preview_id'] == preview['id']
        assert (await canvas_client.post(url + '/assistant', json=submit)).json() == sent_for_approval.json()
        assert (await canvas_client.get(url)).json()['data']['revision'] == -1
        saved = await canvas_client.put(url, json={'request_id': 'first-exact-save', 'expected_revision': 0,
            'document': document, 'assistant': {'turns': [turn, approval]},
            'assistant_approval': {'source_id': 'submit-draft', 'group_ids': ['1']}})
        assert saved.status_code == 200, saved.text
        assert [card['text'] for card in saved.json()['data']['document']['cards']] == ['潮水涌入']
        return
    assert turn['proposal']['state'] == 'pending'
    assert turn['attachments'][0]['file_id'] == file_id
    assert (await canvas_client.get(f'/files/{file_id}')).json()['data']['usages'] == []
    assert not (await canvas_client.get(f'/canvases/drafts/{different_draft}')).json()['data']['document']['cards']
    assert (await canvas_client.get('/canvases')).json()['data']['pagination']['total'] == 0

    command = {'request_id': 'approved-first-save', 'expected_revision': 0, 'document': document,
        'assistant': {'turns': [turn]}, 'assistant_approval': {'source_id': 'create-one', 'group_ids': ['1']}}
    if revise:
        revised = await canvas_client.post(url + '/assistant', json={'request_id': 'revise-one', 'text': '修改建议',
            'revises': 'create-one', 'turns': [turn], 'context': {'draft': document, 'revision': 0, 'scope': 'canvas'}})
        assert revised.status_code == 200, revised.text
        command['assistant']['turns'].append(revised.json()['data'])
        expired = await canvas_client.put(url, json=command)
        assert expired.status_code == 409 and '已失效' in expired.json()['detail'], expired.text
        command['assistant_approval']['source_id'] = 'revise-one'
    response = await canvas_client.put(url, json=command)
    assert response.status_code == 200, response.text
    assert (await canvas_client.put(url, json=command)).json() == response.json()
    assert [card['text'] for card in response.json()['data']['document']['cards']] == ['潮水涌入']
    history = (await canvas_client.get(f'/canvases/{draft}/assistant')).json()['data']['turns']
    assert len(history) == (2 if revise else 1)
    assert history[-1]['proposal']['state'] == 'applied'
    if revise:
        assert history[0]['proposal']['state'] == 'superseded'
    assert history[0]['attachments'][0]['file_id'] == file_id
    assert len((await canvas_client.get(f'/files/{file_id}')).json()['data']['usages']) == 1
    assert (await canvas_client.get('/canvases')).json()['data']['pagination']['total'] == 1


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('canvas_client', [None, 'mysql'], indirect=True)
@pytest.mark.parametrize('group_ids', [('1',), ('1', '2')])
async def test_first_save_applies_only_selected_batch_and_replays(canvas_client, monkeypatch, group_ids):
    from copy import deepcopy

    canvas_client.canvas_sessions.configure(autoflush=False)

    groups = [
        {'title': '分镜结构', 'changes': [
            {'kind': 'add_card', 'reference': 'notes', 'card': {'kind': 'add_text_card', 'text': '逆光'}},
            {'kind': 'add_card', 'reference': 'model', 'card': {'kind': 'add_model_card', 'modality': 'text'}},
            {'kind': 'connect_cards', 'source_card': 'notes', 'target_card': 'model',
             'source_port': 'text', 'target_port': 'text'},
        ]},
        {'title': '备用方案', 'changes': [
            {'kind': 'add_card', 'reference': 'alternate', 'card': {'kind': 'add_text_card', 'text': '侧光'}},
        ]},
    ]
    original = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        body = json.loads(request.content)
        completed = {message['tool_call_id'] for message in body['messages'] if message['role'] == 'tool'}
        answer = {'role': 'assistant', 'content': '请确认分镜和备用方案'}
        if 'batch' not in completed:
            call = ('batch', 'preview_canvas_changes', {'groups': groups}) if completed else (
                'read', 'read_canvas', {},
            )
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': call[0], 'type': 'function',
                'function': {'name': call[1], 'arguments': json.dumps(call[2])},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'draft-batch', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    draft_id = str(uuid4())
    url = f'/canvases/drafts/{draft_id}'
    document = (await canvas_client.get(url)).json()['data']['document']
    exchange = await canvas_client.post(url + '/assistant', json={
        'request_id': 'draft-batch', 'text': '新建两张卡并连接，另给备用方案',
        'context': {'draft': document, 'revision': 0, 'scope': 'canvas'},
    })
    assert exchange.status_code == 200, exchange.text
    turn = exchange.json()['data']
    assert [len(group['edits']) for group in turn['proposal']['groups']] == [3, 1]
    command = {'request_id': 'approve-batch', 'expected_revision': 0, 'document': document,
               'assistant': {'turns': [turn]}, 'assistant_approval': {'source_id': 'draft-batch', 'group_ids': list(group_ids)}}
    invalid = deepcopy(command)
    invalid['assistant']['turns'][0]['proposal']['groups'][0]['edits'][2]['target']['target_port'] = 'invalid'
    response = await canvas_client.put(url, json=invalid)
    assert response.status_code == 409, response.text
    assert (await canvas_client.get(url)).json()['data']['revision'] == -1

    saved = await canvas_client.put(url, json=command)
    assert saved.status_code == 200, saved.text
    assert (await canvas_client.put(url, json=command)).json() == saved.json()
    result = saved.json()['data']['document']
    card_types = ['content.text', 'model.text']
    if '2' in group_ids:
        card_types.append('content.text')
    assert [card['type'] for card in result['cards']] == card_types
    assert len(result['edges']) == 1
    assert (result['edges'][0]['source_card'], result['edges'][0]['target_card']) == tuple(
        card['id'] for card in result['cards'][:2]
    )
    history = (await canvas_client.get(f'/canvases/{draft_id}/assistant')).json()['data']['turns']
    assert len(history) == 1
    assert [group['state'] for group in history[0]['proposal']['groups']] == [
        'applied', 'applied' if '2' in group_ids else 'pending',
    ]
    assert [row['group_ids'] for row in history[0]['approval_audit']] == [[item] for item in group_ids]
    events = (await canvas_client.get(f'/canvases/{draft_id}/assistant/events')).json()['data']
    assert [event['cursor'] for event in events] == list(range(1, len(events) + 1))
    assert [event['group_ids'] for event in events if event['type'] == 'execution.succeeded'] == [
        [item] for item in group_ids
    ]
