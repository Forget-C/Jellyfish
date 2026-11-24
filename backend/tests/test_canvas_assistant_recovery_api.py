"""Recover persisted approval and execution through both real canvas assistant routes."""

import asyncio
from contextlib import asynccontextmanager
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import Model, Provider
from app.services.generation_canvas import assistant_versioned_approval
from app.services.generation_canvas.runs import canvas_runs
from app.services.task_service import TaskService
from app.task_worker import TaskWorker, WorkerLimits
from tests.canvas_urls import seed_scene_canvas
from tests.generation_canvas_reference_fixtures import reference_image_sources
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401

_DIRECT = '晨光下缓慢推近'
_REFERENCE = '水面映出远处桥梁'
_ROLE = '小雪'


def _data(response):
    assert response.status_code == 200, response.text
    return response.json()['data']


async def _canvas(client, *, scene, native):
    suffix = uuid4().hex
    async with client.canvas_sessions.begin() as db:
        text_model = await db.get(Model, 'canvas-text')
        text_model.capability_profile = {'tool_calling': {'declaration': 'supported'}} if native else None
        (await db.get(Provider, text_model.provider_id)).api_key = 'test-text-key'
        db.add(Provider(id=suffix, provider_key='vidu', name=suffix, api_key='test-video-key', base_url='https://video.test'))
        await db.flush()
        model_id = 'video-' + suffix
        db.add(Model(id=model_id, name='viduq2-pro', category='video', provider_id=suffix))
    response = (await seed_scene_canvas(client, '/canvases/p', json={'name': '双镜头'})
                if scene else await client.post('/canvases', json={'name': '双镜头'}))
    canvas = _data(response)
    path = f"/canvases/{canvas['id']}"
    params = {'project_id': 'p'} if scene else {}
    assert (await client.patch(path + '/assistant/model', params=params, json={'model_id': 'canvas-text'})).status_code == 200
    upload = await client.post('/files/upload', data={'usage_kind': 'canvas_upload', 'source_ref': canvas['id'], **params},
                               files={'file': ('face.png', b'controlled-image', 'image/png')})
    assert upload.status_code == 201, upload.text
    file_id = upload.json()['data']['id']
    doc = canvas['document']
    doc['cards'] = [
        {'type': 'content.text', 'id': 'description', 'text': _REFERENCE},
        {'type': 'reference.character', 'id': 'role', 'name': _ROLE, 'image_binding': {'file_id': file_id}},
        *[{'type': 'model.video', 'id': key, 'model_id': model_id, 'config': {'ratio': '16:9', 'seconds': 5},
           'prompt': {'segments': [{'kind': 'text', 'id': 'body', 'text': description}]}}
          for key, description in [('direct', _DIRECT), ('referenced', _REFERENCE)]],
    ]
    reference_image_sources(doc)
    _data(await client.put(path, params=params, json={'request_id': 'setup', 'expected_revision': canvas['revision'],
                                                          'document': doc}))
    return canvas['id'], path, params, file_id


def _control_model(monkeypatch, native):
    groups = [
        {'title': '直写正文的第一镜', 'changes': [
            {'kind': 'use_video_character', 'source_card': 'role', 'target_card': 'direct', 'subject_name': _ROLE},
            {'kind': 'add_card', 'reference': 'watch-note', 'card': {'kind': 'add_text_card', 'text': '监看备注'}},
        ]},
        {'title': '采用正文引用的第二镜', 'changes': [
            {'kind': 'use_video_text', 'source_card': 'description', 'target_card': 'referenced'},
            {'kind': 'use_video_character', 'source_card': 'role', 'target_card': 'referenced', 'subject_name': _ROLE},
        ]},
    ]
    original = httpx.AsyncClient.send

    async def respond(self, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(self, request, **kwargs)
        messages = json.loads(request.content)['messages']
        last_user = next(item['content'] for item in reversed(messages) if item['role'] == 'user')
        reply = {'role': 'assistant', 'content': '请核对两组镜头改动。'}
        if isinstance(last_user, str) and last_user.startswith('生成一版'):
            reply = {'role': 'assistant', 'content': '已收到一版生成指令。'}
        elif not native:
            reply['content'] = json.dumps({'reply': reply['content'], 'groups': groups}, ensure_ascii=False)
        else:
            observed = {item.get('tool_call_id') for item in messages if item['role'] == 'tool'}
            if 'preview' not in observed:
                identity, name, values = ('preview', 'preview_canvas_changes', {'groups': groups}) if 'read' in observed else (
                    'read', 'read_canvas', {},
                )
                reply = {'role': 'assistant', 'tool_calls': [{'id': identity, 'type': 'function',
                    'function': {'name': name, 'arguments': json.dumps(values, ensure_ascii=False)}}]}
        return httpx.Response(200, request=request, json={
            'id': 'controlled-recovery', 'object': 'chat.completion', 'created': 1, 'model': 'canvas-text',
            'choices': [{'index': 0, 'message': reply, 'finish_reason': 'tool_calls' if 'tool_calls' in reply else 'stop'}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)


@asynccontextmanager
async def _worker(sessions, *, client=None, submit=0):
    worker = TaskWorker(sessions, client=client, limits=WorkerLimits(submit=submit))
    try:
        yield worker
    finally:
        worker.text_pool.shutdown()


def _video_bindings(doc):
    return {card['id']: card['input_bindings'] for card in doc['cards'] if card['type'] == 'model.video'}


async def _generation_recovery(client, canvas_id, path, params, state):
    """Submit the real assistant's explicit single generation and lose the provider receipt."""
    command = {'request_id': 'generate-once', 'text': '生成一版', 'context': {
        'scope': 'selection', 'card_ids': ['direct'], 'draft': state['document'], 'revision': state['revision'],
    }}
    turn = _data(await client.post(path + '/assistant', params=params, json=command))
    assert turn['generation']['requested_count'] == 1
    submitted = []

    def provider(request):
        assert request.url.host == 'video.test' and request.method == 'POST'
        submitted.append(json.loads(request.content))
        raise httpx.ReadTimeout('provider accepted but reply was lost', request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
        async with _worker(client.canvas_sessions, client=transport, submit=1) as worker:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        unknown = (_data(await client.get(path + '/assistant', params=params)))['turns'][-1]['generation']
        original, = unknown['versions']
        assert original['state'] == 'unknown', unknown
        async with _worker(client.canvas_sessions, client=transport, submit=1) as restarted:
            async with client.canvas_sessions.begin() as db:
                await TaskService(db).interrupt_previous_workers(worker_id=restarted.worker_id)
            await restarted.tick()
            await asyncio.gather(*restarted.jobs.values())
        _data(await client.post(path + '/assistant', params=params, json=command))
        persisted = (_data(await client.get(path + '/assistant', params=params)))['turns'][-1]['generation']
        assert persisted['versions'] == [original]
    assert len(submitted) == 1
    assert submitted[0]['prompt'].count(_DIRECT) == 1
    async with client.canvas_sessions() as db:
        accepted = await canvas_runs(db, params.get('project_id')).read_receipt(canvas_id, original['request_id'])
        assert accepted.run_id == original['run_id'] and len(accepted.task_ids) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(('canvas_client', 'scene', 'loss'), [
    pytest.param(database, scene, loss, id=f"{database or 'sqlite'}-{'scene' if scene else 'free'}-{loss}")
    for database, scene, loss in (
        (None, False, 'before'), (None, False, 'after'), (None, False, 'stale'),
        (None, True, 'before'), (None, True, 'after'), (None, True, 'stale'),
        ('mysql', False, 'before'), ('mysql', True, 'after'),
    )
], indirect=['canvas_client'])
async def test_approval_and_receipt_recover_after_disconnect(canvas_client, monkeypatch, scene, loss):
    client = canvas_client
    canvas_id, path, params, file_id = await _canvas(client, scene=scene, native=not scene)
    _control_model(monkeypatch, not scene)
    before = _data(await client.get(path, params=params))
    turn = _data(await client.post(path + '/assistant', params=params, json={
        'request_id': 'two-shots', 'text': '采用角色图并调整两个镜头的输入',
        'context': {'scope': 'canvas', 'revision': before['revision'], 'draft': before['document']},
    }))
    first, second = turn['proposal']['groups']
    assert [first['state'], second['state']] == ['pending', 'pending']
    assert 'groups' not in turn['reply']
    cursor = (_data(await client.get(path + '/assistant', params=params)))['cursor']
    approval_path = path + '/assistant/proposals/two-shots'
    choice = {'action': 'approve', 'expected_revision': before['revision'], 'group_ids': [first['id']],
              'decision_id': 'first-choice'}
    execute = assistant_versioned_approval.execute_assistant_edit_request

    async def lose_connection(*args, **kwargs):
        if loss == 'after':
            await execute(*args, **kwargs)
        raise httpx.ReadError('the original assistant HTTP connection closed')

    with monkeypatch.context() as fault:
        fault.setattr(assistant_versioned_approval, 'execute_assistant_edit_request', lose_connection)
        with pytest.raises(httpx.ReadError, match='connection closed'):
            await client.post(approval_path, params=params, json=choice)

    intermediate = _data(await client.get(path, params=params))
    assert intermediate['revision'] == before['revision'] + (loss == 'after')
    if loss == 'stale':
        next(card for card in intermediate['document']['cards'] if card['id'] == 'role')['name'] = '用户修改的角色名'
        _data(await client.put(path, params=params, json={'request_id': 'manual-source-edit',
            'expected_revision': intermediate['revision'], 'document': intermediate['document']}))

    async with _worker(client.canvas_sessions) as recreated:
        await recreated.tick()
    history = _data(await client.get(path + '/assistant', params=params))
    recovered = history['turns'][-1]
    replay = _data(await client.post(approval_path, params=params, json=choice))
    events = _data(await client.get(path + '/assistant/events', params={**params, 'after': cursor}))
    assert sum(event['type'] == 'approval.decided' and event['group_ids'] == [first['id']] for event in events) == 1
    if loss == 'stale':
        assert [group['state'] for group in recovered['proposal']['groups']] == ['superseded', 'pending']
        assert not replay['receipt'] and replay['conflicts']
        assert any(audit['outcome'] == 'conflict' and audit['group_ids'] == [first['id']]
                   for audit in recovered['approval_audit'])
        assert any('冲突' in issue['message'] for issue in recovered['proposal_issues'])
        assert sum(event['type'] == 'execution.blocked' for event in events) == 1
        unchanged = replay['canvas']['document']
        assert not _video_bindings(unchanged)['direct']
        assert next(card['name'] for card in unchanged['cards'] if card['id'] == 'role') == '用户修改的角色名'
        return

    assert [group['state'] for group in recovered['proposal']['groups']] == ['applied', 'pending']
    assert replay['receipt']['revision'] == before['revision'] + 1
    assert sum(event['type'] == 'execution.succeeded' for event in events) == 1
    after_first = replay['canvas']['document']
    assert {key: len(items) for key, items in _video_bindings(after_first).items()} == {'direct': 1, 'referenced': 0}
    assert sum(card.get('text') == '监看备注' for card in after_first['cards']) == 1
    again = _data(await client.post(approval_path, params=params, json=choice))
    assert again['receipt'] == replay['receipt'] and again['canvas']['document'] == after_first

    second_choice = {**choice, 'group_ids': [second['id']], 'decision_id': 'second-choice'}
    second_result = _data(await client.post(approval_path, params=params, json=second_choice))
    final = second_result['canvas']
    stored = _data(await client.get(path, params=params))
    assert final['document'] == stored['document']
    doc = stored['document']
    bindings = _video_bindings(doc)
    assert {key: len(items) for key, items in bindings.items()} == {'direct': 1, 'referenced': 2}
    assert {item['source']['card_id'] for item in bindings['referenced']} == {'description', 'role'}
    assert {item['source']['card_id'] for item in bindings['direct']} == {'role'}
    assert {(edge['source_card'], edge['target_card'], edge['target_port']) for edge in doc['edges']} >= {
        ('role', 'direct', 'subject_image'), ('role', 'referenced', 'subject_image'), ('description', 'referenced', 'text'),
    }
    for card_id, description in [('direct', _DIRECT), ('referenced', _REFERENCE)]:
        compiled = _data(await client.get(path + f'/cards/{card_id}/compile', params=params))
        assert compiled['can_run'] and compiled['text'].count(description) == 1, compiled
        subject, = compiled['video_media']['subjects']
        assert subject['name'] == _ROLE and [item['file_id'] for item in subject['media']] == [file_id]
    for decision, expected in ((choice, replay['receipt']), (second_choice, second_result['receipt'])):
        repeated = _data(await client.post(approval_path, params=params, json=decision))
        assert repeated['receipt'] == expected and repeated['canvas']['document'] == doc
    if not scene and loss == 'after':
        await _generation_recovery(client, canvas_id, path, params, stored)
