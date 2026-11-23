"""Generation authorization at the canvas HTTP and Worker boundaries."""

import asyncio
import json

import httpx
import pytest

from app.models.llm import Model, ModelSettings
from app.task_worker import TaskWorker, WorkerLimits
from tests.test_generation_canvas_runs import runtime  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent', pytest.param('mysql', marks=pytest.mark.integration)], indirect=True)
async def test_worker_resumes_exact_authorized_versions(runtime, monkeypatch):
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        settings = await db.get(ModelSettings, 1)
        if settings is None:
            settings = ModelSettings(id=1)
            db.add(settings)
        settings.default_text_model_id = model.id

    original_send = httpx.AsyncClient.send
    execution_inputs = []

    async def respond(client, request, **kwargs):
        if request.url.host != 'frozen.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        if body.get('stream'):
            execution_inputs.append(body['messages'][-1]['content'])
            chunk = {'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'Result'},
                                  'finish_reason': None}]}
            return httpx.Response(200, request=request, text=f'data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n',
                                  headers={'Content-Type': 'text/event-stream'})
        if any(item['role'] == 'tool' for item in body['messages']):
            message = {'role': 'assistant', 'content': '已收到指令'}
            reason = 'stop'
        else:
            message = {'role': 'assistant', 'tool_calls': [{'id': 'read-context', 'type': 'function',
                'function': {'name': 'read_canvas_context', 'arguments': '{}'}}]}
            reason = 'tool_calls'
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': reason, 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    current = (await runtime.client.get(runtime.url)).json()['data']
    endpoint, _, query = runtime.url.partition('?')
    assistant = endpoint + '/assistant' + ('?' + query if query else '')
    runs = endpoint + '/runtime' + ('?' + query if query else '')
    command = {'request_id': 'explicit-three', 'text': '生成三版', 'context': {
        'draft': current['document'], 'revision': current['revision'], 'scope': 'selection', 'card_ids': ['m'],
    }}
    discussion = await runtime.client.post(assistant, json={
        **command, 'request_id': 'discussion', 'text': '提示词里写「生成三版」，这句是否清楚？',
    })
    assert discussion.status_code == 200, discussion.text
    assert discussion.json()['data']['generation'] is None
    response = await runtime.client.post(assistant, json=command)
    assert response.status_code == 200, response.text
    assert response.json()['data']['generation']['requested_count'] == 3

    async with httpx.AsyncClient() as transport:
        first = TaskWorker(runtime.sessions, client=transport)
        try:
            await first.tick()
            await asyncio.gather(*first.jobs.values())
        finally:
            first.text_pool.shutdown(wait=False)
        initial = (await runtime.client.get(runs)).json()['data']['runs']
        assert len(initial) == 1
        assert initial[0]['nodes'][0]['status'] == 'succeeded'

        resumed = TaskWorker(runtime.sessions, client=transport)
        running = asyncio.create_task(resumed.run())
        try:
            async with asyncio.timeout(12):
                while True:
                    history = (await runtime.client.get(assistant)).json()['data']['turns']
                    if history[-1]['generation']['state'] == 'completed':
                        break
                    await asyncio.sleep(0.1)
        finally:
            resumed.stopping.set()
            await running
    replay = (await runtime.client.post(assistant, json=command)).json()['data']['generation']
    assert replay['requested_count'] == 3
    assert replay['state'] == 'completed'
    assert [item['version'] for item in replay['versions']] == [1, 2, 3]
    published = (await runtime.client.get(runs)).json()['data']['runs']
    assert len(published) == 3 and published[0]['id'] == initial[0]['id']
    assert [item['run_id'] for item in replay['versions']] == [run['id'] for run in published]
    assert all(item['state'] == 'succeeded' for item in replay['versions'])
    assert execution_inputs == ['Frozen prompt'] * 3


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario, expected_state, expected_runs', [
    ('approve', 'running', 1), ('reject', 'rejected', 0), ('precheck', 'failed', 0), ('edit_only', None, 0),
    ('partial_group', 'running', 1), ('automatic', 'running', 1),
    ('layout_after_approval', 'running', 1), ('new_input_after_approval', 'reapproval_required', 0),
    ('named_match', 'running', 1), ('named_mismatch', None, 0), ('wrong_direction', None, 0),
])
async def test_generation_waits_for_a_separately_approved_edit(runtime, monkeypatch, scenario, expected_state,
                                                               expected_runs):
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.capability_profile = {'tool_calling': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id=model.id))
        db.add(Model(id='video-model', name='sora-2', category='video', provider_id=runtime.provider_id))
    current = (await runtime.client.get(runtime.url)).json()['data']
    document = current['document']
    document['cards'].append({
        'id': 'v', 'type': 'model.video', 'model_id': None if scenario == 'precheck' else 'video-model',
        'config': {'ratio': '16:9', 'seconds': 4},
        'prompt': {'segments': [{'kind': 'text', 'id': 'p', 'text': '快速推近'}]},
    })
    if scenario == 'partial_group':
        document['cards'][-1]['prompt']['segments'].append({'kind': 'text', 'id': 'q', 'text': '保持构图'})
    if scenario.startswith('named_'):
        document['cards'].append({'id': 'other', 'type': 'model.video'})
        document['groups'] = [
            {'id': 'shot-three', 'name': '镜头三', 'card_ids': ['v']},
            {'id': 'shot-four', 'name': '镜头四', 'card_ids': ['other']},
        ]
    saved = await runtime.client.put(runtime.url, json={
        'request_id': 'add-video', 'expected_revision': current['revision'], 'document': document,
    })
    assert saved.status_code == 200, saved.text
    current = (await runtime.client.get(runtime.url)).json()['data']
    endpoint, _, query = runtime.url.partition('?')
    suffix = '?' + query if query else ''
    assistant = endpoint + '/assistant' + suffix
    decision = endpoint + '/assistant/proposals/edit-one' + suffix
    runs = endpoint + '/runtime' + suffix
    if scenario in ('automatic', 'named_match', 'named_mismatch', 'wrong_direction'):
        preference = await runtime.client.patch(endpoint + '/assistant/approval' + suffix,
                                                json={'approval_mode': 'automatic'})
        assert preference.status_code == 200, preference.text
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'frozen.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        if any('独立的画布审批复核员' in item['content'] for item in body['messages'] if item['role'] == 'system'):
            assert not body.get('tools')
            return httpx.Response(200, request=request, json={
                'id': 'independent-review', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
                'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant',
                    'content': '{"decision":"approve","reason":"用户明确指定了原操作"}'}}],
            })
        results = [item for item in body['messages'] if item['role'] == 'tool']
        if len(results) < 2:
            name = 'read_canvas_context' if not results else 'propose_canvas_edit'
            args = {} if not results else {'card_id': 'v', 'text': '缓慢推近',
                'target': {'kind': 'video_prompt_segment', 'segment_id': 'p'}}
            if results and scenario == 'wrong_direction':
                args['text'] = '后拉'
            if results and scenario == 'partial_group':
                name = 'propose_canvas_edit_groups'
                alternate = {**args, 'text': '换成大特写',
                             'target': {'kind': 'video_prompt_segment', 'segment_id': 'q'}}
                args = {'groups': [{'title': '运镜', 'edits': [args]}, {'title': '构图', 'edits': [alternate]}]}
            message = {'role': 'assistant', 'tool_calls': [{'id': name, 'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)}}]}
        else:
            message = {'role': 'assistant', 'content': '已给出修改建议'}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if len(results) < 2 else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    sent = await runtime.client.post(assistant, json={
        'request_id': 'edit-one',
        'text': {'edit_only': '把推近放慢', 'named_match': '把镜头三的推近放慢并生成一版',
                 'named_mismatch': '把镜头四的推近放慢，生成一版',
                 'wrong_direction': '把这张卡的推近放慢'}.get(scenario, '把推近放慢，生成一版'),
        'context': {'draft': current['document'], 'revision': current['revision'], 'scope': 'selection', 'card_ids': ['v']},
    })
    assert sent.status_code == 200, sent.text
    assert sent.json()['data']['proposal']['state'] == 'pending'
    assert sent.json()['data']['automatic_approval'] is (scenario in ('automatic', 'named_match'))
    generation = sent.json()['data']['generation']
    if scenario in ('edit_only', 'named_mismatch', 'wrong_direction'):
        assert generation is None
    else:
        assert generation['state'] == 'waiting_approval'

    async with httpx.AsyncClient() as transport:
        worker = TaskWorker(runtime.sessions, client=transport, limits=WorkerLimits(submit=0))
        try:
            if scenario in ('named_mismatch', 'wrong_direction'):
                refused = await runtime.client.post(decision, json={
                    'action': 'approve', 'expected_revision': current['revision'], 'approval_mode': 'automatic',
                })
                assert refused.status_code == 409, refused.text
                await worker.tick()
                assert (await runtime.client.get(runs)).json()['data']['runs'] == []
                assert (await runtime.client.get(runtime.url)).json()['data']['revision'] == current['revision']
                return
            await worker.tick()
            assert (await runtime.client.get(runs)).json()['data']['runs'] == []
            action = 'reject' if scenario == 'reject' else 'approve'
            choice = {'action': action, 'expected_revision': current['revision']}
            if scenario in ('automatic', 'named_match'):
                choice['approval_mode'] = 'automatic'
            if scenario == 'partial_group':
                choice['group_ids'] = ['1']
            confirmed = await runtime.client.post(decision, json=choice)
            assert confirmed.status_code == 200, confirmed.text
            if scenario == 'partial_group':
                assert confirmed.json()['data']['generation']['state'] == 'waiting_approval'
                await worker.tick()
                assert (await runtime.client.get(runs)).json()['data']['runs'] == []
                revision = confirmed.json()['data']['receipt']['revision']
                rejected = await runtime.client.post(decision, json={
                    'action': 'reject', 'expected_revision': revision, 'group_ids': ['2'],
                })
                assert rejected.status_code == 200, rejected.text
                assert rejected.json()['data']['generation']['state'] == 'queued'
            if scenario in ('layout_after_approval', 'new_input_after_approval'):
                updated = (await runtime.client.get(runtime.url)).json()['data']
                if scenario == 'layout_after_approval':
                    updated['document']['groups'] = [{'id': 'layout', 'name': '展示编组', 'card_ids': ['v']}]
                else:
                    updated['document']['cards'][-1]['prompt']['segments'][0]['text'] = '独立修改后的文本'
                moved = await runtime.client.put(runtime.url, json={
                    'request_id': 'edit-after-approval', 'expected_revision': updated['revision'],
                    'document': updated['document'],
                })
                assert moved.status_code == 200, moved.text
            await worker.tick()
            await worker.tick()
            response = await runtime.client.get(assistant)
            generation = response.json()['data']['turns'][0]['generation']
            assert (generation and generation['state']) == expected_state
            published = (await runtime.client.get(runs)).json()['data']['runs']
            assert len(published) == expected_runs
            if published:
                observed = published[0]['nodes'][0]['basis']['input']['text']
                if scenario == 'partial_group':
                    assert '缓慢推近' in observed and '保持构图' in observed
                else:
                    assert observed == '缓慢推近'
            if expected_state in ('failed', 'reapproval_required'):
                assert generation['error']
            if scenario == 'new_input_after_approval':
                difference = generation['changed_input']
                assert difference['before']['text'] == '缓慢推近'
                assert difference['after']['text'] == '独立修改后的文本'
                approve_url = endpoint + '/assistant/generations/edit-one/approval' + suffix
                body = {'revision': difference['revision'], 'basis_hash': difference['basis_hash'],
                        'decision_id': 'changed-input'}
                accepted = await runtime.client.post(approve_url, json=body)
                assert accepted.status_code == 200, accepted.text
                assert (await runtime.client.post(approve_url, json=body)).json() == accepted.json()
                await worker.tick()
                after = (await runtime.client.get(runs)).json()['data']['runs']
                assert len(after) == 1
                assert after[0]['nodes'][0]['basis']['input']['text'] == '独立修改后的文本'
                await runtime.client.post(endpoint + f"/runs/{after[0]['id']}/cancel" + suffix)
            if published:
                await runtime.client.post(endpoint + f"/runs/{published[0]['id']}/cancel" + suffix)
        finally:
            worker.text_pool.shutdown(wait=False)
