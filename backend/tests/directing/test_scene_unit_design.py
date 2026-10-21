"""单元 AI 设计经真实 HTTP 与任务生命周期返回只读方案。"""
import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.directing.ai import generate_directing_result
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_first_unit_design_freezes_unsaved_input_and_previews_without_save(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='provider', params={}),
                        Model(id='video', name='sora-2', category='video', provider_id='provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '单元设计'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {},
            'visible_result': {'state': 'proposal', 'text': '抬头', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        content['design']['events'] = [{'id': 'event-1', 'description': {'state': 'proposal', 'text': '放下信', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}}]
        content['design']['direction']['shots'][0]['event_ids'] = ['event-1']
        content['design']['participants'] = [{'id': 'reader', 'name': '读信者'}]
        content['design']['direction']['shots'][0]['participant_ids'] = ['reader']
        content['design']['direction']['beats'] = [{'id': 'beat-1', 'event_ids': [],
            'objective': {}, 'obstacle': {}, 'expected_change': {}, 'must_show': {}}]
        content['design']['direction']['shots'][0]['beat_ids'] = ['beat-1']
        action = {field: {} for field in ('objective', 'obstacle', 'subtext', 'attention',
            'internal_adjustment', 'physical_action', 'delivery', 'reaction_order', 'exit_state', 'avoid')}
        action.update(id='action-1', beat_id='beat-1', participant_id='reader',
            received_event_ids=[], dialogue_ids=[], criterion_ids=[],
            physical_action=deepcopy(content['design']['direction']['shots'][0]['visible_result']),
            gaze={'state': 'proposal', 'text': '视线保持稳定', 'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]})
        content['design']['performance']['beats'] = [action]
        content['design']['applicability'] = [{'subject': {'kind': 'performance_beat', 'id': 'action-1', 'field': field},
            'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot']} for field in ('physical_action', 'gaze')]
        body = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content,
                'shot_id': 'shot', 'target_model_id': 'video', 'model_id': 'text', 'instruction': '完整拍摄抬头'}
        url = detail + '/unit-design-suggestions'
        response = await client.post(url, json=body)
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == task_id)
        assert origin['version_id'] == version['id'] and origin['shot_id'] == 'shot'
        assert (await client.post(url, json=body)).json()['data']['task_id'] == task_id
        assert (await client.post(url, json={**body, 'instruction': '另一要求'})).status_code == 409
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            assert task.input_snapshot['run_args']['task_identity']
            assert task.input_snapshot['run_args']['organization_inputs']['context']['participants'][0]['name'] == '读信者'
            proposed = {'shot_id': 'shot', 'target_model_id': 'video', 'organization': '动作完整，单段拍摄',
                'units': [{'id': 'unit-1', 'coverage': [{'id': 'coverage-1', 'shot_id': 'shot', 'action_scope': '抬头', 'performance_action_ids': ['action-1']}],
                    'duration_ms': None, 'ratio': '16:9', 'reason': '完整动作', 'entry_state': '', 'exit_state': '',
                    'reference_requirements': ['需要人物身份参考'], 'missing': ['尚未绑定真实参考']}],
                'missing': []}
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            await service.finish(task_id, result=result.model_dump(mode='json'))
        rows = (await client.get(url)).json()['data']
        assert rows[0]['result']['units'][0]['coverage'][0]['action_scope'] == '抬头'
        preview = await client.post(url + '/' + task_id + '/preview', json={'content': content})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['result']['units'][0]['reference_requirements'] == ['需要人物身份参考']
        assert (await client.get(detail)).json()['data'] == version

        # 未安排的镜头动作必须成为缺项，不能把局部结果显示为完整准备。
        partial_content = deepcopy(content)
        partial_content['design']['direction']['shots'][0]['visible_result']['text'] = '抬头；放下信'
        partial = await client.post(url, json={**body, 'request_id': str(uuid4()), 'content': partial_content})
        assert partial.status_code == 200, partial.text
        partial_id = partial.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, partial_id)
            result = generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(partial_id, worker_id='fixture')
            await service.finish(partial_id, result=result.model_dump(mode='json'))
        partial_rows = (await client.get(url)).json()['data']
        candidate = next(row for row in partial_rows if row['task_id'] == partial_id)
        assert '镜头可见结果尚有未安排内容，请核对完整覆盖' in candidate['result']['missing']

        # 非法方案整份失败；真实任务记录可读，版本与媒体状态不变。
        for change in ('event', 'model', 'shot', 'new-action', 'unknown-duration', 'write-design', 'multiple-coverage', 'new-entry-state', 'selection-scope-mismatch'):
            accepted = await client.post(url, json={**body, 'request_id': str(uuid4())})
            assert accepted.status_code == 200, accepted.text
            invalid_id = accepted.json()['data']['task_id']
            bad = deepcopy(proposed)
            if change == 'event':
                bad['units'][0]['coverage'][0]['event_ids'] = ['invented-event']
            elif change == 'model':
                bad['target_model_id'] = 'another-video'
            elif change == 'shot':
                bad['units'][0]['coverage'][0]['shot_id'] = 'another-shot'
            elif change == 'new-action':
                bad['units'][0]['coverage'][0]['action_scope'] = '转身离开'
            elif change == 'unknown-duration':
                bad['units'][0]['duration_ms'] = 15000
            elif change == 'selection-scope-mismatch':
                bad['units'][0]['coverage'][0]['event_ids'] = ['event-1']
            elif change == 'new-entry-state':
                bad['units'][0]['entry_state'] = '人物突然掏枪'
            elif change == 'multiple-coverage':
                bad['units'][0]['coverage'].append({'id': 'coverage-2', 'shot_id': 'shot', 'action_scope': '抬头'})
            else:
                bad['design'] = content['design']
            async with sessions.begin() as db:
                task = await db.get(Task, invalid_id)
                service = TaskService(db)
                assert await service.claim(invalid_id, worker_id='fixture')
                with pytest.raises(ValueError) as invalid:
                    generate_directing_result('directing_unit_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(bad))), task.input_snapshot['run_args'])
                await service.finish(invalid_id, error=str(invalid.value), error_code='directing_output_invalid')
            failed = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == invalid_id)
            assert failed['status'] == 'failed' and failed['result'] is None and failed['error']
            assert (await client.get(detail)).json()['data'] == version
        assert (await client.post(url, json={**body, 'request_id': str(uuid4()), 'shot_id': 'absent'})).status_code == 422
        missing_model = {key: value for key, value in body.items() if key != 'target_model_id'}
        assert (await client.post(url, json=missing_model)).status_code == 422
        assert (await client.post(url.replace('/p1/', '/p2/'), json={**body, 'request_id': str(uuid4())})).status_code == 422
