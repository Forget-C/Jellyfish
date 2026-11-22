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
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


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
@pytest.mark.parametrize('scene_owned,canvas_client', [
    (False, 'sqlite'), (True, 'sqlite'), ('groups', 'sqlite'), ('restart', 'mysql'),
], indirect=['canvas_client'])
async def test_assistant_edit_requires_approval_and_replays_original_save(canvas_client, monkeypatch, scene_owned, tmp_path):
    grouped = scene_owned in ('groups', 'restart')
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
            name, args = 'read_canvas_context', {}
        elif grouped and 'call-propose_canvas_edit_groups' not in results:
            name, args = 'propose_canvas_edit_groups', {'groups': [
                {'title': '运镜', 'edits': [
                    {'card_id': 'target', 'target': target, 'text': '慢推'},
                    {'card_id': 'target', 'target': {'kind': 'video_prompt_segment', 'segment_id': 'third'}, 'text': '近景'},
                ]},
                {'title': '灯光', 'edits': [{'card_id': 'target', 'target': {
                    'kind': 'video_prompt_segment', 'segment_id': 'second'}, 'text': '暖光'}]},
            ]}
        elif not grouped and 'call-propose_canvas_edit' not in results:
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
    if grouped:
        groups = proposal.json()['data']['proposal']['groups']
        assert [item['title'] for item in groups] == ['运镜', '灯光']
        assert (await canvas_client.get(assistant)).json()['data']['turns'][0]['proposal']['groups'] == groups
        card['prompt']['segments'][0]['text'] = '手动环绕'
        change = await canvas_client.put(url, json={
            'request_id': 'manual', 'expected_revision': revision, 'document': {**draft, 'name': '手动改名'},
        })
        assert change.status_code == 200, change.text
        decision_url = assistant + '/proposals/edit-speed'
        decision = {'action': 'approve', 'expected_revision': revision,
                    'group_ids': [group['id'] for group in groups]}
        if scene_owned == 'restart':
            result = await _restart_and_replay(tmp_path, url, decision, groups)
        else:
            result = await canvas_client.post(decision_url, json=decision)
        assert result.status_code == 200, result.text
        data = result.json()['data']
        assert [item['state'] for item in data['proposal']['groups']] == ['pending', 'applied']
        assert data['conflicts'][0]['current'] == '手动环绕'
        assert data['canvas']['document']['name'] == '手动改名'
        actual = data['canvas']['document']['cards'][0]['prompt']['segments']
        assert [part['text'] for part in actual] == ['手动环绕', '暖光', '中景']
        assert (await canvas_client.post(decision_url, json=decision)).json() == result.json()
        return
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
    if scene_owned is True:
        assert actual['fields']['movement_speed']['text'] == '缓慢推近'
    else:
        assert [part['text'] for part in actual['prompt']['segments']] == ['缓慢推近', '午夜蓝光']
    assert (await canvas_client.get(append_canvas_path(url, '/runtime'))).json()['data']['runs'] == []


@asynccontextmanager
async def _live_mysql_app(tmp_path):
    """Start the real HTTP and Worker processes against the isolated test DB."""
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = {
        **os.environ,
        'DATABASE_URL': os.environ['JELLYFISH_TEST_MYSQL_URL'],
        'JELLYFISH_DEV_RUNTIME_DIR': str(tmp_path / 'identities'),
        'ASSISTANT_APPROVAL_COMMITTED_MARKER': str(tmp_path / 'committed'),
    }
    backend = Path(__file__).resolve().parents[1]
    with (tmp_path / 'processes.log').open('ab') as log:
        processes = [
            await asyncio.create_subprocess_exec(sys.executable, '-m', *command, cwd=backend, env=env, stdout=log, stderr=log)
            for command in (('uvicorn', 'tests.canvas_assistant_restart_server:app', '--port', str(port)),
                            ('app.task_worker',))
        ]
        try:
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
                           or json.loads(worker_identity.read_text())['pid'] != processes[1].pid):
                        await asyncio.sleep(.1)
                yield client
        finally:
            for process in processes:
                if process.returncode is None:
                    process.kill()
            await asyncio.gather(*(process.wait() for process in processes))


async def _restart_and_replay(tmp_path, url, decision, groups):
    path = '/api/v1/studio/generation-canvases/' + url.rsplit('/', 1)[-1] + '/assistant'
    async with _live_mysql_app(tmp_path) as client:
        history = (await client.get(path)).json()['data']['turns']
        assert history[0]['proposal']['groups'] == groups

    decision_url = path + '/proposals/edit-speed'
    async with _live_mysql_app(tmp_path) as client:
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
    async with _live_mysql_app(tmp_path) as client:
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
    assert (await canvas_client.get(first_url)).json()['data']['approval_mode'] == 'manual'
    enabled = await canvas_client.patch(first_url + '/approval', json={'approval_mode': 'automatic'})
    assert enabled.status_code == 200, enabled.text
    assert (await canvas_client.get(first_url)).json()['data']['approval_mode'] == 'automatic'
    assert (await canvas_client.get(second_url)).json()['data']['approval_mode'] == 'manual'
    disabled = await canvas_client.patch(first_url + '/approval', json={'approval_mode': 'manual'})
    assert disabled.status_code == 200, disabled.text
    assert (await canvas_client.get(first_url)).json()['data']['approval_mode'] == 'manual'


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('action', ['edit', 'edit-conflict', 'delete', 'release'])
async def test_auto_approval_follows_user_words_and_preserves_conflicts(canvas_client, monkeypatch, action):
    canvas = (await canvas_client.post('/canvases', json={'name': '自动审批'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    assistant = url + '/assistant'
    card = {'id': 'target', 'type': 'model.video', 'prompt': {'segments': [
        {'kind': 'text', 'id': 'first', 'text': '快速推近'},
    ]}}
    draft = {**canvas['document'], 'cards': [card]}
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
    name = 'propose_canvas_edit' if action == 'edit' else 'propose_canvas_removal'
    target = {'edit': {'kind': 'video_prompt_segment', 'segment_id': 'first'},
              'delete': {'kind': 'delete_card'},
              'release': {'kind': 'release_binding', 'binding_id': 'selected-text'}}[action]
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        count = sum(message['role'] == 'tool' for message in body['messages'])
        call = 'read_canvas_context' if count == 0 else name if count == 1 else None
        message = {'role': 'assistant', 'content': '准备了修改建议'}
        if call:
            args = {} if count == 0 else {'card_id': 'target', 'target': target}
            if count and action == 'edit':
                args['text'] = '缓慢推近'
            message = {'role': 'assistant', 'tool_calls': [{'id': f'call-{call}', 'type': 'function',
                'function': {'name': call, 'arguments': json.dumps(args)}}]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if call else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    inferred = await canvas_client.post(assistant, json={'request_id': 'inferred', 'context': initial,
                                                            'text': '整理一下画布' if action != 'edit' else '这种镜头怎么拍？'})
    assert inferred.status_code == 200, inferred.text
    assert inferred.json()['data']['automatic_approval'] is False
    group = {'group_ids': ['1']} if action != 'edit' else {}
    decision = {'action': 'approve', 'approval_mode': 'automatic', 'expected_revision': revision, **group}
    inferred_decision = assistant + '/proposals/inferred'
    assert (await canvas_client.post(inferred_decision, json=decision)).status_code == 409
    rejected = await canvas_client.post(inferred_decision, json={**decision, 'action': 'reject', 'approval_mode': 'manual'})
    assert rejected.status_code == 200, rejected.text
    assert (await canvas_client.get(url)).json()['data']['revision'] == revision

    request = {'edit': '把这张卡的推近放慢', 'delete': '删除这张卡', 'release': '解除这条引用'}[action]
    explicit = await canvas_client.post(assistant, json={'request_id': 'explicit', 'context': initial, 'text': request})
    assert explicit.status_code == 200, explicit.text
    assert explicit.json()['data']['automatic_approval'] is True
    if conflict:
        card['prompt']['segments'][0]['text'] = '手动环绕'
        saved = await canvas_client.put(url, json={'request_id': 'manual', 'expected_revision': revision, 'document': draft})
        assert saved.status_code == 200, saved.text
    approval = await canvas_client.post(assistant + '/proposals/explicit', json=decision)
    assert approval.status_code == 200, approval.text
    entry = (await canvas_client.get(assistant)).json()['data']['turns'][1]['approval_audit'][0]
    assert (entry['source_id'], entry['mode'], entry['outcome']) == (
        'explicit', 'automatic', 'conflict' if conflict else 'applied',
    )
    output = (await canvas_client.get(url)).json()['data']['document']
    if action == 'edit':
        assert output['cards'][0]['prompt']['segments'][0]['text'] == ('手动环绕' if conflict else '缓慢推近')
    elif action == 'delete':
        assert output['cards'] == []
    else:
        assert output['cards'][0]['input_bindings'] == []
        assert len(output['edges']) == 1
    assert (await canvas_client.get(url + '/runtime')).json()['data']['runs'] == []
