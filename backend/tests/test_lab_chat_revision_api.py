"""Historical revisions are observable through session, task and provider receipts."""
import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import Model, ModelSettings, Provider
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import Task, TaskOutput
from app.services.studio.experiment_messages import ExperimentMessageDraft, append_experiment_messages
from tests.chat_events import wait_for_chat_event
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
@pytest.mark.parametrize('count', [1, 2])
async def test_revise_original_video_in_same_turn(canvas_client, monkeypatch, count):
    from app.task_worker import TaskWorker

    sid = (await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})).json()['data']['id']
    url = '/api/v1/studio/chat/sessions/' + sid
    lab_url = '/api/v1/studio/chat/sessions/lab/' + sid
    originals = []
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'tool_calling': {'declaration': 'supported'}, 'native_streaming': {'declaration': 'unsupported'}}
        db.add(Provider(id='vidu-test', provider_key='vidu', name='vidu', api_key='local', base_url='https://video.test'))
        await db.flush()
        video = await db.get(Model, 'canvas-video')
        video.name, video.provider_id = 'viduq2', 'vidu-test'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
        for i in range(count):
            tid, fid = uuid4().hex, uuid4().hex
            originals.append(fid)
            db.add(FileItem(id=fid, type='video', name=f'Shot {i}', storage_key=fid))
            db.add(Task(id=tid, kind='video_generation', status='succeeded', target_type='experiment_session',
                        target_id=sid, input_snapshot={'model_id': 'canvas-video', 'model_name': 'viduq2',
                        'execution_prompt': f'original camera move {i}', 'operation_input': {
                            'kind': 'video_generation', 'seconds': 4, 'ratio': '9:16'}}))
            await db.flush()
            db.add(TaskOutput(task_id=tid, ordinal=0, file_id=fid))
            await append_experiment_messages(db, session_id=sid, drafts=[ExperimentMessageDraft(
                role='task', task_id=tid, content='generate_video', payload={'turn_id': f'prior-{i}', 'modality': 'video'})])
    responses = []
    resumed, release = asyncio.Event(), asyncio.Event()
    original_send = httpx.AsyncClient.send

    async def language(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        messages = json.loads(request.content)['messages']
        if messages[-1]['role'] == 'tool':
            responses.append(json.loads(messages[-1]['content']))
            if count > 1:
                resumed.set()
                await release.wait()
            answer = {'role': 'assistant', 'content': '已提交新版'}
        else:
            assert originals[0] in json.dumps(messages)
            answer = {'role': 'assistant', 'tool_calls': [{'id': 'revision-tool', 'type': 'function', 'function': {
                'name': 'revise_artifact', 'arguments': json.dumps({
                    'modality': 'video', 'changes': {'ratio': '16:9'}, 'submit_only': True})}}]}
        return httpx.Response(200, request=request, json={'choices': [{'index': 0, 'message': answer,
            'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop'}]})

    monkeypatch.setattr(httpx.AsyncClient, 'send', language)
    command = {'text': '把刚才的视频改成横屏，只提交', 'request_id': 'revision'}
    response = await canvas_client.post(url + '/turns', json=command)
    assert response.is_success, response.text
    if count > 1:
        await wait_for_chat_event(canvas_client, url, 'revision', 'question.asked')
        state = (await canvas_client.get(lab_url)).json()['data']
        question = state['question']
        assert state['active_turn'] == 'revision'
        assert [opt['file_id'] for opt in question['options']] == originals
        assert not responses and len([m for m in state['messages'] if m['role'] == 'task']) == count
        endpoint = url + '/turns/revision/answer'
        invalid = await canvas_client.post(endpoint, json={'question_id': question['id'], 'file_id': 'foreign'})
        assert invalid.status_code in (409, 422)
        decision = {'question_id': question['id'], 'file_id': originals[-1]}
        try:
            response = await asyncio.wait_for(canvas_client.post(endpoint, json=decision), 2)
            assert response.status_code == 202, response.text
            accepted = response.json()['data']
            assert set(accepted) == {'session_id', 'turn_id', 'cursor'}
            assert accepted['turn_id'] == 'revision'
            await asyncio.wait_for(resumed.wait(), 4)
            stream = await canvas_client.get(url + '/events', params={'after': accepted['cursor'], 'follow': False})
            assert 'event: question.answered' in stream.text and 'event: turn.completed' not in stream.text
            assert (await canvas_client.post(endpoint, json=decision)).json() == response.json()
        finally:
            release.set()
    await wait_for_chat_event(canvas_client, url, 'revision', 'turn.completed')
    receipt, = responses
    assert receipt['model_id'] == 'canvas-video' and receipt['parameters']['ratio'] == '16:9'
    assert receipt['parameters']['seconds'] == 4 and receipt['source_file_id'] == originals[-1]
    from botocore.exceptions import ClientError

    async def no_prior_object(**_):
        raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
    async def upload(**_):
        return None
    monkeypatch.setattr('app.core.storage.get_file_info', no_prior_object)
    monkeypatch.setattr('app.core.storage.upload_file', upload)
    submissions = []
    def video_api(request):
        if request.method == 'GET':
            return httpx.Response(200, json={'state': 'success', 'creations': [{'b64_json': 'dg=='}]})
        submissions.append(json.loads(request.content))
        return httpx.Response(200, json={'task_id': 'new-video'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(video_api)) as http:
        worker = TaskWorker(canvas_client.canvas_sessions, client=http)
        try:
            for _ in range(2):
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
    new, = submissions
    assert new['prompt'] == f'original camera move {count - 1}' and new['duration'] == 4
    assert new['aspect_ratio'] == '16:9' and new['model'] == 'viduq2'
    history = (await canvas_client.get(lab_url)).json()['data']['messages']
    task_rows = [m for m in history if m['role'] == 'task']
    assert [m['media_receipt']['artifacts'][0]['file_id'] for m in task_rows[:-1]] == originals
    assert task_rows[-1]['payload']['source_file_id'] == originals[-1]
    assert task_rows[-1]['media_receipt']['artifacts'][0]['file_id'] not in originals


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler-file'], indirect=True)
async def test_historical_video_analysis_checks_main_model_capability(canvas_client, monkeypatch):
    sid = (await canvas_client.post('/api/v1/studio/experiment-sessions', json={'lab_type': 'chat'})).json()['data']['id']
    file_id, task_id = uuid4().hex, uuid4().hex
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Provider, 'canvas-provider')).api_key = 'local'
        (await db.get(Model, 'canvas-text')).capability_profile = {
            'tool_calling': {'declaration': 'supported'}, 'video_inputs': {'declaration': 'unsupported'},
            'native_streaming': {'declaration': 'unsupported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))
        db.add(FileItem(id=file_id, type='video', name='Shot', storage_key=file_id))
        db.add(Task(id=task_id, kind='video_generation', status='succeeded', target_type='experiment_session',
                    target_id=sid, input_snapshot={'operation_input': {'kind': 'video_generation', 'ratio': '9:16'}}))
        await db.flush()
        db.add(TaskOutput(task_id=task_id, ordinal=0, file_id=file_id))
        await append_experiment_messages(db, session_id=sid, drafts=[ExperimentMessageDraft(role='task',
            task_id=task_id, content='generate_video', payload={'turn_id': 'prior', 'modality': 'video'})])
    original = httpx.AsyncClient.send
    async def language(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original(client, request, **kwargs)
        call = {'id': 'look', 'type': 'function', 'function': {'name': 'inspect_artifact',
                'arguments': json.dumps({'file_id': file_id, 'question': '判断镜头是否抖动'})}}
        return httpx.Response(200, request=request, json={'choices': [{'index': 0,
            'message': {'role': 'assistant', 'tool_calls': [call]}, 'finish_reason': 'tool_calls'}]})
    monkeypatch.setattr(httpx.AsyncClient, 'send', language)
    result = await canvas_client.post(f'/api/v1/studio/chat/sessions/{sid}/turns',
                                      json={'request_id': 'look', 'text': '分析刚才视频的运镜'})
    assert result.status_code == 202
    await wait_for_chat_event(canvas_client, f'/api/v1/studio/chat/sessions/{sid}', 'look', 'turn.failed')
