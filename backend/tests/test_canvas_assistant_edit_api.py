"""Verify a typed assistant edit through conversation, approval and canvas reads."""

import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import socket
import sys

import httpx
import pytest
import pytest_asyncio

from app.models.llm import Model, ModelSettings, Provider
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.chat_events import observe_canvas_turn, read_canvas_chat_snapshot
from tests.isolated_mysql import isolated_storage_environment
from tests.services.test_task_mysql import isolated_database_url
from tests.worker_process import start_test_worker, validate_worker_environment
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


def _batch_field(arguments):
    return {'groups': [{'title': '字段', 'changes': [{'kind': 'edit_field', 'change': arguments}]}]}


def _batch_fields(arguments):
    return {'groups': [{'title': group['title'], 'changes': [
        {'kind': 'edit_field', 'change': edit} for edit in group['edits']
    ]} for group in arguments['groups']]}


@pytest_asyncio.fixture
async def assistant_edit_model(canvas_client):
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        settings = await db.get(ModelSettings, 1)
        had_settings = settings is not None
        previous = settings.default_text_model_id if settings else None
        if settings:
            settings.default_text_model_id = model.id
        else:
            db.add(ModelSettings(id=1, default_text_model_id=model.id))
    try:
        yield
    finally:
        async with canvas_client.canvas_sessions.begin() as db:
            settings = await db.get(ModelSettings, 1)
            if had_settings:
                settings.default_text_model_id = previous
            else:
                await db.delete(settings)


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize(('card', 'target', 'path'), [
    ({'id': 'target', 'type': 'content.text', 'text': '旧正文'}, {'kind': 'card_text'}, ('text',)),
    ({'id': 'target', 'type': 'model.image', 'prompt': {'segments': [
        {'kind': 'text', 'id': 'prompt', 'text': '旧正文'},
    ]}}, {'kind': 'model_prompt_segment', 'segment_id': 'prompt'}, ('prompt', 'segments', 0, 'text')),
    ({'id': 'target', 'type': 'direction.camera', 'fields': {'position': {'text': '旧正文'}}},
     {'kind': 'design_text_field', 'field_name': 'position'}, ('fields', 'position', 'text')),
])
async def test_assistant_edits_catalog_text_fields(canvas_client, monkeypatch, card, target, path):
    if card['type'].startswith('direction.'):
        canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
        url = canvas_url(f"/canvases/p/{canvas['id']}")
    else:
        canvas = (await canvas_client.post('/canvases', json={'name': 'Editable'})).json()['data']
        url = f"/canvases/{canvas['id']}"
    assistant = append_canvas_path(url, '/assistant')
    draft = {**canvas['document'], 'cards': [*canvas['document'].get('cards', []), card]}
    saved = (await canvas_client.put(url, json={
        'request_id': 'initial', 'expected_revision': canvas['revision'], 'document': draft,
    })).json()['data']
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        result_count = sum(message['role'] == 'tool' for message in body['messages'])
        tool_call = result_count < 2
        message = {'role': 'assistant', 'content': '已给出修改建议'}
        if tool_call:
            name = 'preview_canvas_changes' if result_count else 'read_canvas'
            arguments = _batch_field({'card_id': 'target', 'target': target, 'text': '新正文'}) if result_count else {}
            message['tool_calls'] = [{
                'id': name, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)},
            }]
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if tool_call else 'stop', 'message': message}],
        })

    def value(document):
        result = next(item for item in document['cards'] if item['id'] == 'target')
        for key in path:
            result = result[key]
        return result

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    response = await observe_canvas_turn(canvas_client, assistant, json={
        'request_id': 'edit-text', 'text': '把所选卡的文字改为新正文',
        'context': {'draft': draft, 'revision': saved['revision'], 'scope': 'selection', 'card_ids': ['target']},
    })
    assert response.receipt.status_code == 202, response.receipt.text
    assert response.detail['proposal']['before'] == '旧正文'
    assert value((await canvas_client.get(url)).json()['data']['document']) == '旧正文'
    decided = await canvas_client.post(append_canvas_path(url, '/assistant/proposals/edit-text'), json={
        'action': 'approve', 'expected_revision': saved['revision'],
    })
    assert decided.status_code == 200, decided.text
    assert value((await canvas_client.get(url)).json()['data']['document']) == '新正文'


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('scene_owned,canvas_client', [
    (False, 'sqlite'), (True, 'sqlite'), ('groups', 'sqlite'), ('restart', 'mysql'),
    ('conflict-replay', 'sqlite'), ('conflict-replay', 'mysql'),
], indirect=['canvas_client'])
async def test_assistant_edit_requires_approval_and_replays_original_save(canvas_client, monkeypatch, scene_owned, tmp_path):
    grouped = scene_owned in ('groups', 'restart', 'conflict-replay')
    if scene_owned is True:
        canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
        url = canvas_url(f"/canvases/p/{canvas['id']}")
        card = {'id': 'target', 'type': 'direction.movement', 'fields': {'movement_speed': {'text': '快速推近'}}}
        target = {'kind': 'movement_field', 'field': 'movement_speed'}
    else:
        canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
        url = f"/canvases/{canvas['id']}"
        card = {'id': 'target', 'type': 'model.video', 'prompt': {'segments': [
            {'kind': 'text', 'id': 'first', 'text': '快速推近'}, {'kind': 'text', 'id': 'second', 'text': '午夜蓝光'},
            *([{'kind': 'text', 'id': 'third', 'text': '中景'}] if grouped else []),
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
            name, args = 'read_canvas', {}
        elif grouped and 'call-preview_canvas_changes' not in results:
            name, args = 'preview_canvas_changes', _batch_fields({'groups': [
                {'title': '运镜', 'edits': [
                    {'card_id': 'target', 'target': target, 'text': '慢推'},
                    {'card_id': 'target', 'target': {'kind': 'video_prompt_segment', 'segment_id': 'third'}, 'text': '近景'},
                ]},
                {'title': '灯光', 'edits': [{'card_id': 'target', 'target': {
                    'kind': 'video_prompt_segment', 'segment_id': 'second'}, 'text': '暖光'}]},
            ]})
        elif not grouped and 'call-preview_canvas_changes' not in results:
            name, args = (None, None) if question == '这种镜头怎么拍？' else (
                'preview_canvas_changes', _batch_field({'card_id': 'target', 'target': target,
                                        'text': '缓慢推近' if question == '速度再慢一些' else '稍慢推近'}),
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
    proposal = await observe_canvas_turn(canvas_client, assistant, json=source)
    assert proposal.receipt.status_code == 202, proposal.receipt.text
    if grouped:
        groups = proposal.detail['proposal']['groups']
        assert [item['title'] for item in groups] == ['运镜', '灯光']
        assert (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']['turns'][0]['proposal']['groups'] == groups
        card['prompt']['segments'][0]['text'] = '手动环绕'
        change = await canvas_client.put(url, json={
            'request_id': 'manual', 'expected_revision': revision, 'document': {**draft, 'name': '手动改名'},
        })
        assert change.status_code == 200, change.text
        if scene_owned == 'conflict-replay':
            decision_url = assistant + '/proposals/edit-speed'
            decision = {'action': 'approve', 'expected_revision': revision,
                        'group_ids': [groups[0]['id']], 'decision_id': 'first-approval'}
            first = await canvas_client.post(decision_url, json=decision)
            assert first.status_code == 200, first.text
            prior = first.json()['data']
            assert prior['receipt'] is None
            assert prior['conflicts'][0]['current'] == '手动环绕'

            card['prompt']['segments'][0]['text'] = '快速推近'
            restored = await canvas_client.put(url, json={
                'request_id': 'restore', 'expected_revision': change.json()['data']['revision'], 'document': draft,
            })
            assert restored.status_code == 200, restored.text
            replay = await canvas_client.post(decision_url, json=decision)
            assert replay.status_code == 200, replay.text
            assert replay.json()['data']['conflicts'] == prior['conflicts']
            assert replay.json()['data']['receipt'] is None
            assert (await canvas_client.get(url)).json()['data']['revision'] == restored.json()['data']['revision']
            assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []

            retry = await canvas_client.post(decision_url, json={
                **decision, 'decision_id': 'new-approval', 'expected_revision': restored.json()['data']['revision'],
            })
            assert retry.status_code == 409, retry.text
            current = (await canvas_client.get(url)).json()['data']
            fresh = await observe_canvas_turn(canvas_client, assistant, json={**source, 'request_id': 'refreshed-edit',
                'context': {**source['context'], 'revision': current['revision'], 'draft': current['document']}})
            assert fresh.receipt.status_code == 202, fresh.receipt.text
            refreshed = await canvas_client.post(assistant + '/proposals/refreshed-edit', json={
                **decision, 'decision_id': 'new-preview-approval', 'expected_revision': current['revision'],
            })
            assert refreshed.status_code == 200, refreshed.text
            assert refreshed.json()['data']['receipt']['revision'] == current['revision'] + 1
            assert refreshed.json()['data']['canvas']['document']['cards'][0]['prompt']['segments'][0]['text'] == '慢推'
            replay = await canvas_client.post(decision_url, json=decision)
            assert replay.json()['data']['conflicts'] == prior['conflicts']
            assert replay.json()['data']['receipt'] is None
            assert replay.json()['data']['proposal'] == prior['proposal']
            reused = await canvas_client.post(decision_url, json={**decision, 'action': 'reject'})
            assert reused.status_code == 409
            return
        decision_url = assistant + '/proposals/edit-speed'
        decision = {'action': 'approve', 'expected_revision': revision,
                    'group_ids': [group['id'] for group in groups]}
        if scene_owned == 'restart':
            result = await _restart_and_replay(tmp_path, url, decision, groups)
        else:
            result = await canvas_client.post(decision_url, json=decision)
        assert result.status_code == 200, result.text
        data = result.json()['data']
        assert [item['state'] for item in data['proposal']['groups']] == ['superseded', 'applied']
        assert data['conflicts'][0]['current'] == '手动环绕'
        assert data['canvas']['document']['name'] == '手动改名'
        actual = data['canvas']['document']['cards'][0]['prompt']['segments']
        assert [part['text'] for part in actual] == ['手动环绕', '暖光', '中景']
        assert (await canvas_client.post(decision_url, json=decision)).json() == result.json()
        return
    guidance = await observe_canvas_turn(canvas_client, assistant, json={**source, 'request_id': 'guidance', 'text': '这种镜头怎么拍？'})
    assert guidance.receipt.status_code == 202, guidance.receipt.text
    assert guidance.detail['proposal'] is None
    revised = await observe_canvas_turn(canvas_client, assistant, json={
        **source, 'request_id': 'revised', 'revises': 'edit-speed', 'text': '速度再慢一些',
    })
    assert revised.receipt.status_code == 202, revised.receipt.text
    assert revised.detail['revises'] == 'edit-speed'
    preview = revised.detail['proposal']
    assert (preview['card_id'], preview['before'], preview['after'], preview['state']) == (
        'target', '快速推近', '缓慢推近', 'pending',
    )
    assert (await canvas_client.get(url)).json()['data']['revision'] == revision
    decision = {'action': 'approve', 'expected_revision': revision}
    superseded = append_canvas_path(url, '/assistant/proposals/edit-speed')
    assert (await canvas_client.post(superseded, json=decision)).status_code == 409
    unwanted = await observe_canvas_turn(canvas_client, assistant, json={**source, 'request_id': 'unwanted'})
    assert unwanted.receipt.status_code == 202, unwanted.receipt.text
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
    if scene_owned is True:
        assert actual['fields']['movement_speed']['text'] == '缓慢推近'
    else:
        assert [part['text'] for part in actual['prompt']['segments']] == ['缓慢推近', '午夜蓝光']
    assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []


@asynccontextmanager
async def _live_mysql_app(tmp_path, storage_env):
    """Start the real HTTP and Worker processes against the isolated test DB."""
    env = {
        **os.environ,
        **storage_env,
        'DATABASE_URL': isolated_database_url(),
        'JELLYFISH_DEV_RUNTIME_DIR': str(tmp_path / 'identities'),
        'ASSISTANT_APPROVAL_COMMITTED_MARKER': str(tmp_path / 'committed'),
    }
    validate_worker_environment(env)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    backend = Path(__file__).resolve().parents[1]
    with (tmp_path / 'processes.log').open('ab') as log:
        api = await asyncio.create_subprocess_exec(
            sys.executable, '-m', 'uvicorn', 'tests.canvas_assistant_restart_server:app', '--port', str(port),
            cwd=backend, env=env, stdout=log, stderr=log,
        )
        worker = None
        try:
            worker = start_test_worker(env, stdout=log, stderr=log)
            async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}', trust_env=False, timeout=15) as client:
                async with asyncio.timeout(15):
                    while True:
                        try:
                            if (await client.get('/health')).status_code == 200:
                                break
                        except httpx.ConnectError:
                            pass
                        await asyncio.sleep(.1)
                    worker_identity = tmp_path / 'identities' / 'worker.json'
                    while (not worker_identity.is_file()
                           or json.loads(worker_identity.read_text())['pid'] != worker.pid):
                        await asyncio.sleep(.1)
                yield client
        finally:
            if api.returncode is None:
                api.kill()
            if worker is not None:
                if worker.poll() is None:
                    worker.kill()
                await asyncio.gather(api.wait(), asyncio.to_thread(worker.wait))
            else:
                await api.wait()


async def _restart_and_replay(tmp_path, url, decision, groups):
    storage_env = isolated_storage_environment()
    path = '/api/v1/studio/generation-canvases/' + url.rsplit('/', 1)[-1] + '/assistant'
    async with _live_mysql_app(tmp_path, storage_env) as client:
        history = (await read_canvas_chat_snapshot(client, path)).json()['data']['turns']
        assert history[0]['proposal']['groups'] == groups

    decision_url = path + '/proposals/edit-speed'
    async with _live_mysql_app(tmp_path, storage_env) as client:
        waiting = asyncio.create_task(client.post(decision_url, json=decision, headers={'x-test-drop-receipt': '1'}))
        try:
            async with asyncio.timeout(10):
                while not (tmp_path / 'committed').is_file():
                    if waiting.done():
                        pytest.fail(f'Approval unexpectedly delivered its receipt: {waiting.result().text}')
                    await asyncio.sleep(.1)
        finally:
            waiting.cancel()
            await asyncio.gather(waiting, return_exceptions=True)
    async with _live_mysql_app(tmp_path, storage_env) as client:
        replay = await client.post(decision_url, json=decision)
        assert replay.status_code == 200, replay.text
        assert replay.json()['data']['receipt']['revision'] == decision['expected_revision'] + 2
        return replay


@pytest.mark.asyncio
async def test_canvas_approval_mode_is_persisted_per_canvas(canvas_client):
    first = (await canvas_client.post('/canvases', json={'name': '第一张'})).json()['data']['id']
    second = (await canvas_client.post('/canvases', json={'name': '第二张'})).json()['data']['id']
    first_url = f'/canvases/{first}/assistant'
    second_url = f'/canvases/{second}/assistant'
    assert (await read_canvas_chat_snapshot(canvas_client, first_url)).json()['data']['approval_mode'] == 'manual'
    enabled = await canvas_client.patch(first_url + '/approval', json={'approval_mode': 'automatic'})
    assert enabled.status_code == 200, enabled.text
    assert (await read_canvas_chat_snapshot(canvas_client, first_url)).json()['data']['approval_mode'] == 'automatic'
    assert (await read_canvas_chat_snapshot(canvas_client, second_url)).json()['data']['approval_mode'] == 'manual'
    disabled = await canvas_client.patch(first_url + '/approval', json={'approval_mode': 'manual'})
    assert disabled.status_code == 200, disabled.text
    assert (await read_canvas_chat_snapshot(canvas_client, first_url)).json()['data']['approval_mode'] == 'manual'


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('action', ['edit', 'edit-conflict', 'delete', 'release', 'delete-with-extra'])
async def test_auto_approval_follows_user_words_and_preserves_conflicts(canvas_client, monkeypatch, action):
    canvas = (await canvas_client.post('/canvases', json={'name': '自动审批'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    assistant = url + '/assistant'
    card = {'id': 'target', 'type': 'model.video', 'prompt': {'segments': [
        {'kind': 'text', 'id': 'first', 'text': '快速推近'},
    ]}}
    draft = {**canvas['document'], 'cards': [card]}
    extra_change = action == 'delete-with-extra'
    if extra_change:
        action = 'delete'
        draft['cards'].append({'id': 'extra', 'type': 'content.text', 'text': '保持原文'})
    conflict = action == 'edit-conflict'
    if conflict:
        action = 'edit'
    if action == 'release':
        draft['cards'].append({'id': 'reference', 'type': 'content.text', 'text': '原文'})
        draft['edges'] = [{'id': 'linked', 'source_card': 'reference', 'source_port': 'text',
                           'target_card': 'target', 'target_port': 'text'}]
        draft['input_order'] = {'target': {'text': ['linked']}}
        card['input_bindings'] = [{'id': 'selected-text', 'input_port': 'text', 'source': {
            'canvas_id': canvas['id'], 'card_id': 'reference', 'port_id': 'text', 'position': 0,
        }}]
    saved = await canvas_client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': draft})
    assert saved.status_code == 200, saved.text
    revision = saved.json()['data']['revision']
    assert (await canvas_client.patch(assistant + '/approval', json={'approval_mode': 'automatic'})).status_code == 200
    initial = {'revision': revision, 'draft': draft, 'scope': 'selection', 'card_ids': ['target']}
    if extra_change:
        initial = {**initial, 'scope': 'canvas', 'card_ids': []}
    name = 'preview_canvas_changes'
    target = {'edit': {'kind': 'video_prompt_segment', 'segment_id': 'first'},
              'delete': {'kind': 'delete_card'},
              'release': {'kind': 'release_binding', 'binding_id': 'selected-text'}}[action]
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        if any('独立的画布审批复核员' in item['content'] for item in body['messages'] if item['role'] == 'system'):
            assert not extra_change, 'unauthorized effects reached the independent reviewer'
            assert not body.get('tools')
            return httpx.Response(200, request=request, json={
                'id': 'independent-review', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
                'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant',
                    'content': '{"decision":"approve","reason":"用户明确指定了原操作"}'}}],
            })
        count = sum(message['role'] == 'tool' for message in body['messages'])
        call = 'read_canvas' if count == 0 else name if count == 1 else None
        message = {'role': 'assistant', 'content': '准备了修改建议'}
        if call:
            args = {} if count == 0 else {'card_id': 'target', 'target': target}
            if count and action == 'edit':
                args = _batch_field({**args, 'text': '缓慢推近'})
            elif count:
                changes = [{'kind': 'remove', **args}]
                if extra_change:
                    changes.append({'kind': 'edit_field', 'change': {'card_id': 'extra',
                                    'target': {'kind': 'card_text'}, 'text': '额外的未授权修改'}})
                args = {'groups': [{'title': '清理', 'changes': changes}]}
            message = {'role': 'assistant', 'tool_calls': [{'id': f'call-{call}', 'type': 'function',
                'function': {'name': call, 'arguments': json.dumps(args)}}]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if call else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    inferred = await observe_canvas_turn(canvas_client, assistant, json={'request_id': 'inferred', 'context': initial,
                                                            'text': '整理一下画布' if action != 'edit' else '这种镜头怎么拍？'})
    assert inferred.receipt.status_code == 202, inferred.receipt.text
    assert inferred.detail['automatic_approval'] is False
    group = {'group_ids': ['1']} if action != 'edit' else {}
    decision = {'action': 'approve', 'approval_mode': 'automatic', 'expected_revision': revision, **group}
    inferred_decision = assistant + '/proposals/inferred'
    assert (await canvas_client.post(inferred_decision, json=decision)).status_code == (404 if action == 'edit' else 409)
    if action != 'edit':
        rejected = await canvas_client.post(inferred_decision, json={**decision, 'action': 'reject', 'approval_mode': 'manual'})
        assert rejected.status_code == 200, rejected.text
    assert (await canvas_client.get(url)).json()['data']['revision'] == revision

    request = {'edit': '把这张卡的推近放慢', 'delete': '删除这张卡', 'release': '解除这条引用'}[action]
    if extra_change:
        request = '删除 target'
    explicit = await observe_canvas_turn(canvas_client, assistant, json={'request_id': 'explicit', 'context': initial, 'text': request})
    assert explicit.receipt.status_code == 202, explicit.receipt.text
    if extra_change:
        assert len(explicit.detail['proposal']['groups'][0]['edits']) == 2, explicit.receipt.text
        denied = await canvas_client.post(assistant + '/proposals/explicit', json=decision)
        assert denied.status_code == 409, denied.text
        assert (await canvas_client.get(url)).json()['data']['document']['cards'][1]['text'] == '保持原文'
        return
    assert explicit.detail['automatic_approval'] is True
    if conflict:
        card['prompt']['segments'][0]['text'] = '手动环绕'
        saved = await canvas_client.put(url, json={'request_id': 'manual', 'expected_revision': revision, 'document': draft})
        assert saved.status_code == 200, saved.text
    approval = await canvas_client.post(assistant + '/proposals/explicit', json=decision)
    assert approval.status_code == (409 if conflict else 200), approval.text
    turn = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']['turns'][1]
    if conflict:
        assert turn['approval_audit'] is None and turn['proposal']['state'] == 'pending'
    else:
        entry = turn['approval_audit'][0]
        assert (entry['source_id'], entry['mode'], entry['outcome']) == ('explicit', 'automatic', 'applied')
    output = (await canvas_client.get(url)).json()['data']['document']
    if action == 'edit':
        assert output['cards'][0]['prompt']['segments'][0]['text'] == ('手动环绕' if conflict else '缓慢推近')
    elif action == 'delete':
        assert output['cards'] == []
    else:
        assert output['cards'][0]['input_bindings'] == []
        assert len(output['edges']) == 1
    assert (await canvas_client.get(url + '/runtime')).json()['data']['runs'] == []


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('case', ['unavailable', 'reject', 'withdraw', 'regrant', 'new-revision'])
async def test_independent_review_does_not_override_user_or_canvas_changes(canvas_client, monkeypatch, case):
    from asyncio import Event, create_task, wait_for

    canvas = (await canvas_client.post('/canvases', json={'name': '独立复核'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    assistant = url + '/assistant'
    proposal_url = assistant + '/proposals/reviewable'
    document = {**canvas['document'], 'cards': [{
        'id': 'target', 'type': 'model.video', 'prompt': {'segments': [
            {'kind': 'text', 'id': 'first', 'text': '快速推近'},
        ]},
    }]}
    saved = await canvas_client.put(url, json={
        'request_id': 'init', 'expected_revision': canvas['revision'], 'document': document,
    })
    revision = saved.json()['data']['revision']
    await canvas_client.patch(assistant + '/approval', json={'approval_mode': 'automatic'})
    real_send = httpx.AsyncClient.send
    reviewer_entered, release_reviewer = Event(), Event()

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        messages = body['messages']
        tools = {item['tool_call_id'] for item in messages if item['role'] == 'tool'}
        answer = {'role': 'assistant', 'content': '修改建议已准备'}
        if any('独立的画布审批复核员' in item['content'] for item in messages if item['role'] == 'system'):
            assert not body.get('tools')
            reviewer_entered.set()
            await release_reviewer.wait()
            answer['content'] = '无效复核结果' if case == 'unavailable' else '{"decision":"approve","reason":"命中指定字段"}'
        elif 'edit' not in tools:
            name = 'preview_canvas_changes' if tools else 'read_canvas'
            args = _batch_field({'card_id': 'target', 'target': {'kind': 'video_prompt_segment', 'segment_id': 'first'},
                    'text': '缓慢推近'}) if tools else {}
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': 'edit' if tools else 'context', 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'review-answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    preview = await observe_canvas_turn(canvas_client, assistant, json={
        'request_id': 'reviewable', 'text': '把这张卡的推近放慢',
        'context': {'revision': revision, 'draft': document, 'scope': 'selection', 'card_ids': ['target']},
    })
    assert preview.detail['automatic_approval']
    choice = {'action': 'approve', 'approval_mode': 'automatic', 'decision_id': 'automatic-1',
              'expected_revision': revision}
    reviewing = create_task(canvas_client.post(proposal_url, json=choice))
    try:
        await wait_for(reviewer_entered.wait(), timeout=4)
        if case == 'reject':
            assert (await canvas_client.post(proposal_url, json={
                **choice, 'action': 'reject', 'approval_mode': 'manual', 'decision_id': 'manual-rejection',
            })).status_code == 200
        elif case in ('withdraw', 'regrant'):
            assert (await canvas_client.patch(assistant + '/approval', json={'approval_mode': 'manual'})).status_code == 200
            if case == 'regrant':
                assert (await canvas_client.patch(assistant + '/approval', json={'approval_mode': 'automatic'})).status_code == 200
        elif case == 'new-revision':
            assert (await canvas_client.put(url, json={
                'request_id': 'edit-during-review', 'expected_revision': revision,
                'document': {**document, 'name': '用户先改了画布'},
            })).status_code == 200
    finally:
        release_reviewer.set()
        result = await reviewing
    current = (await canvas_client.get(url)).json()['data']
    assert current['document']['cards'][0]['prompt']['segments'][0]['text'] == '快速推近'
    if case == 'unavailable':
        assert result.status_code == 200, result.text
        assert result.json()['data']['automatic_review']['status'] == 'unavailable'
        assert (await canvas_client.post(proposal_url, json=choice)).json() == result.json()
        assert (await canvas_client.post(proposal_url, json={
            **choice, 'approval_mode': 'manual', 'decision_id': 'manual-approval',
        })).json()['data']['proposal']['state'] == 'applied'
    else:
        assert result.status_code == 409, result.text
        proposal = (await read_canvas_chat_snapshot(canvas_client, assistant)).json()['data']['turns'][0]['proposal']
        assert proposal['state'] == ('rejected' if case == 'reject' else 'pending')
