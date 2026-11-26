"""First-save chat and historical browser transcript migration."""
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import ModelSettings, Provider
from tests.chat_events import observe_canvas_turn, read_canvas_chat_snapshot, read_canvas_events, save_canvas_for_chat
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
async def test_first_assistant_save_opens_shared_chat(canvas_client, monkeypatch):
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
    missing = await observe_canvas_turn(canvas_client, draft_url, json={'request_id': 'unsaved', 'text': '先讨论'})
    assert missing.receipt.status_code == 404
    assert (await canvas_client.get(draft_url)).json()['data']['revision'] == -1

    path, _ = await save_canvas_for_chat(canvas_client, draft_url, baseline['document'])
    for index, (text, expected) in enumerate((('先讨论', '先讨论'), ('继续讨论', '先讨论 / 继续讨论'))):
        result = await observe_canvas_turn(canvas_client, path, json={'request_id': f'turn-{index}', 'text': text})
        assert result.receipt.status_code == 202 and result.detail['reply'] == expected

    history = (await read_canvas_chat_snapshot(canvas_client, path)).json()['data']['turns']
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
    history = (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']['turns']
    assert history[0]['reply'] == '原普通正文'
    assert history[0]['proposal'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', [None, 'mysql'], indirect=True)
@pytest.mark.parametrize('group_ids,revised', [(('1',), False), (('1', '2'), False), (('1',), True)])
async def test_first_save_migrates_selected_legacy_approval_groups(canvas_client, group_ids, revised):
    from copy import deepcopy

    from app.schemas.canvas_assistant import CanvasAssistantExchange
    from app.schemas.canvas_assistant_edit import CanvasAssistantProposal
    from app.schemas.generation_canvas import CanvasDocument
    from app.services.generation_canvas.draft_canvas_approvals import stage_draft_approval
    from app.services.generation_canvas.edits import CanvasEditGroup, free_canvas_edits

    canvas_client.canvas_sessions.configure(autoflush=False)

    draft_id = str(uuid4())
    url = f'/canvases/drafts/{draft_id}'
    document = (await canvas_client.get(url)).json()['data']['document']
    cards = [
        {'id': 'notes', 'type': 'content.text', 'text': '逆光'},
        {'id': 'model', 'type': 'model.text'},
        {'id': 'alternate', 'type': 'content.text', 'text': '侧光'},
    ]
    edge = {'id': 'connection', 'source_card': 'notes', 'target_card': 'model',
            'source_port': 'text', 'target_port': 'text'}
    groups = [
        CanvasEditGroup.model_validate({'id': '1', 'cards': cards[:2], 'edges': [edge]}),
        CanvasEditGroup.model_validate({'id': '2', 'cards': cards[2:]}),
    ]
    edits = [
        {'card_id': 'notes', 'card_name': '分镜', 'before': '', 'after': '逆光',
         'target': {'kind': 'add_canvas_card', 'card': {'kind': 'add_text_card', 'text': '逆光'}}},
        {'card_id': 'model', 'card_name': '模型', 'before': '', 'after': '文本模型',
         'target': {'kind': 'add_canvas_card', 'card': {'kind': 'add_model_card', 'modality': 'text'}}},
        {'card_id': 'connection', 'card_name': '连线', 'before': '', 'after': '连线',
         'target': {'kind': 'connect_cards', 'connection_id': edge['id'], **{key: value for key, value in edge.items() if key != 'id'}}},
        {'card_id': 'alternate', 'card_name': '备用', 'before': '', 'after': '侧光',
         'target': {'kind': 'add_canvas_card', 'card': {'kind': 'add_text_card', 'text': '侧光'}}},
    ]
    proposal = CanvasAssistantProposal.model_validate({
        **edits[0], 'groups': [{'id': '1', 'title': '分镜结构', 'edits': edits[:3]},
                               {'id': '2', 'title': '备用方案', 'edits': edits[3:]}],
    })
    exchange = CanvasAssistantExchange(request_id='draft-batch', text='新建两张卡并连接，另给备用方案',
                                       reply='请确认分镜和备用方案', sequence=1, model_id='canvas-text', proposal=proposal)
    previous = exchange.model_copy(update={'request_id': 'old-batch'})
    turns = [exchange]

    # Keep the browser transcript and the server-side approval in their original storage formats.
    async with canvas_client.canvas_sessions.begin() as db:
        draft = CanvasDocument.model_validate(document)
        preview = await free_canvas_edits(db).preview_draft(draft, groups)
        if revised:
            await stage_draft_approval(db, draft, previous.request_id, proposal, preview, origin_id=previous.request_id)
            exchange = exchange.model_copy(update={'revises': previous.request_id, 'sequence': 2})
            turns = [previous, exchange]
        await stage_draft_approval(db, draft, exchange.request_id, proposal, preview,
                                   origin_id=turns[0].request_id, revises=exchange.revises)

    command = {'request_id': 'approve-batch', 'expected_revision': 0, 'document': document,
               'assistant': {'turns': [turn.model_dump(mode='json') for turn in turns]},
               'assistant_approval': {'source_id': exchange.request_id, 'group_ids': list(group_ids)}}
    if revised:
        obsolete = await canvas_client.put(url, json={**command, 'request_id': 'obsolete',
            'assistant_approval': {**command['assistant_approval'], 'source_id': previous.request_id}})
        assert obsolete.status_code == 409 and '已失效' in obsolete.json()['detail']
    invalid = deepcopy(command)
    invalid['assistant']['turns'][-1]['proposal']['groups'][0]['edits'][2]['target']['target_port'] = 'invalid'
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
    history = (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']['turns']
    assert len(history) == len(turns)
    if revised:
        assert history[0]['proposal']['state'] == 'superseded'
    assert [group['state'] for group in history[-1]['proposal']['groups']] == [
        'applied', 'applied' if '2' in group_ids else 'pending',
    ]
    assert [row['group_ids'] for row in history[-1]['approval_audit']] == [[item] for item in group_ids]
    events = await read_canvas_events(canvas_client, url)
    assert [event['cursor'] for event in events] == list(range(1, len(events) + 1))
    assert [event['group_ids'] for event in events if event['type'] == 'execution.succeeded'] == [
        [item] for item in group_ids
    ]
