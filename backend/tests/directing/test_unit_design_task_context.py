"""Unit design task selection and independent save checks through HTTP."""
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4
import pytest
from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@asynccontextmanager
async def prepared(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '任务定位'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'event_ids': [], 'blocking_state_ids': [],
            'criterion_ids': [], 'narrative_function': {}, 'participant_ids': [], 'visible_result': {
                'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
            'shot_id': 'shot', 'target_model_id': 'video', 'model_id': 'text'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            await service.finish(task_id, result={'shot_id': 'shot', 'target_model_id': 'video', 'organization': '完整拍摄',
                'units': [{'id': 'fresh', 'operation': 'create', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '抬头'}],
                           'duration_ms': None, 'ratio': '16:9', 'reason': '完整动作'}]})
        yield sessions, client, detail, url, content, task_id, version


@pytest.mark.asyncio
@pytest.mark.parametrize('same_identity', [False, True])
async def test_selected_task_and_source_identity_keep_newest_match_semantics(tmp_path, same_identity):
    async with prepared(tmp_path) as (sessions, client, detail, url, content, task_id, version):
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            snapshot = deepcopy(task.input_snapshot)
            if not same_identity:
                snapshot['run_args']['task_identity'] = 'other-identity'
            db.add(Task(id='newer', project_id=task.project_id, target_id=task.target_id, kind=task.kind,
                created_at=task.created_at + timedelta(seconds=1), status='failed' if same_identity else 'succeeded',
                input_snapshot=snapshot, result=deepcopy(task.result)))
        preview = await client.post(url + '/' + task_id + '/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['task_id'] == task_id
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert candidate['unit_design_task_id'] == task_id
        assert candidate['units'][0]['organization']['source']['reference'] != task_id
        assert (await client.get(detail)).json()['data'] == version
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': candidate})
        if same_identity:
            assert saved.status_code == 422, saved.text
            assert saved.json()['detail'] == '单元组织来源不属于当前版本的成功任务'
            assert (await client.get(detail)).json()['data'] == version
        else:
            assert saved.status_code == 200, saved.text
            rows = (await client.get(url)).json()['data']
            assert [row['task_id'] for row in rows] == ['newer', task_id]
            assert saved.json()['data']['content']['units'][0]['id'] == 'fresh'


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['project', 'sequence', 'version', 'kind', 'status', 'missing'])
async def test_task_rejection_precedes_changed_input_and_preserves_version(tmp_path, invalid):
    async with prepared(tmp_path) as (sessions, client, detail, url, content, task_id, version):
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            if invalid == 'project':
                task.project_id = 'other'
            elif invalid == 'sequence':
                task.target_id = 'other'
            elif invalid == 'version':
                snapshot = deepcopy(task.input_snapshot)
                snapshot['scene_unit_design']['version_id'] = 'other'
                task.input_snapshot = snapshot
            elif invalid == 'kind':
                task.kind = 'directing_instruction'
            elif invalid == 'status':
                task.status = 'failed'
        content['design']['direction']['shots'][0]['visible_result']['text'] = 'changed'
        for action in ('preview', 'apply'):
            rejected = await client.post(url + '/' + ('missing' if invalid == 'missing' else task_id) + '/' + action, json={'content': content})
            assert rejected.status_code == 422, rejected.text
            assert rejected.json()['detail'] == '建议不属于当前版本或尚未成功完成'
        assert (await client.get(detail)).json()['data'] == version


@pytest.mark.asyncio
async def test_source_check_does_not_authorize_a_different_application_marker(tmp_path):
    async with prepared(tmp_path) as (_, client, detail, url, content, task_id, version):
        candidate = (await client.post(url + '/' + task_id + '/apply', json={'content': content})).json()['data']
        candidate['unit_design_task_id'] = 'missing'
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': candidate})
        assert saved.status_code == 422, saved.text
        assert saved.json()['detail'] == '单元方案应用来源不属于当前版本的成功任务'
        assert (await client.get(detail)).json()['data'] == version
