"""场次范围完整性经真实保存、读取和建议接口验证。"""

from uuid import uuid4
from copy import deepcopy
from types import SimpleNamespace
import asyncio
import json

import pytest

from tests.directing.samples import editable_design_sample, minimal_scoped_design_sample, note
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from app.models.llm import Model, Provider
from app.task_worker import TaskWorker


@pytest.mark.asyncio
async def test_camera_inherits_shot_ownership_without_duplicate_applicability(tmp_path):
    """摄影已有镜头身份；共享人物不能将镜内活动同时分给这些镜头。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '明确归属',
        })).json()['data']
        content = version['content']
        content['design'] = editable_design_sample()
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        graph = response.json()['data']['relationship_graph']
        nodes = {row['key']: row for row in graph['nodes']}
        assert nodes['camera:camera-1']['placement'] == 'shots'
        assert nodes['camera:camera-1']['shot_ids'] == ['s1']
        assert nodes['camera:camera-2']['shot_ids'] == ['s2']
        assert nodes['activity:activity-1']['placement'] == 'pending_shot'
        assert nodes['activity:activity-1']['shot_ids'] == []


@pytest.mark.asyncio
async def test_scope_completeness_checks_each_field_and_keeps_global_facts(tmp_path):
    """一行中已归属的动作不能掩盖另一字段缺项；全场事实按定义持续生效。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '逐项范围',
        })).json()['data']
        content = version['content']
        content['design'] = editable_design_sample()
        content['design']['applicability'] = [{
            'subject': {'kind': 'staging_activity', 'id': 'activity-1', 'field': 'ongoing_task'},
            'purpose': 'design', 'scope': 'shots', 'shot_ids': ['s1', 's2'],
        }]
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        graph = response.json()['data']['relationship_graph']
        assert graph['complete'] is False
        assert any(issue['owner'] == 'activity:activity-1' and issue['field'] == 'path'
                   for issue in graph['issues'])
        assert not any(issue['owner'] == 'activity:activity-1' and issue['field'] == 'ongoing_task'
                       for issue in graph['issues'])
        assert any(use['owner'] == 'fact:fact-1' and use['scope'] == 'scene_rule'
                   and use['purpose'] == 'constraint' for use in graph['uses'])
        assert any(use['owner'] == 'activity:activity-1' and use['field'] == 'ongoing_task'
                   and use['scope'] == 'shots' for use in graph['uses'])
        added = deepcopy(content['design']['direction']['shots'][-1])
        added['id'] = 's3'
        content['design']['direction']['shots'].append(added)
        updated = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert updated.status_code == 200, updated.text
        use = next(row for row in updated.json()['data']['relationship_graph']['uses']
                   if row['owner'] == 'activity:activity-1' and row['field'] == 'ongoing_task')
        assert use['scope'] == 'shots'
        assert use['shot_ids'] == ['s1', 's2']


@pytest.mark.asyncio
@pytest.mark.parametrize('repair', [False, True, 'initial', 'delete', 'background', 'add-shot'])
@pytest.mark.parametrize('legacy', [False, True])
async def test_whole_generation_repairs_scope_once_and_preserves_failed_output(tmp_path, monkeypatch, repair, legacy):
    """新任务保留合法候选；历史冻结任务仍按原契约拒绝不完整结果。"""
    calls = []

    def invoke(messages):
        calls.append(list(messages))
        args = json.loads(messages[1].content)
        output = deepcopy(args['previous_design'])
        activity = deepcopy(editable_design_sample()['staging']['activities'][0])
        for name, value in activity.items():
            if isinstance(value, dict) and 'state' in value:
                activity[name] = {}
        activity['ongoing_task'] = {'state': 'proposal', 'text': '收碗', 'sources': [
            {'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]}
        activity['trigger_event_id'] = None
        output['staging']['activities'] = [activity]
        if repair == 'delete' and len(calls) == 2:
            output['staging']['activities'] = []
        if repair == 'initial' or repair in (True, 'background', 'add-shot') and len(calls) == 2:
            output['applicability'] = [{
                'subject': {'kind': 'staging_activity', 'id': 'activity-1', 'field': 'ongoing_task'},
                'purpose': 'design', 'scope': 'shots', 'shot_ids': ['s1'],
            }]
            if repair == 'background':
                output['applicability'][0].update(purpose='background', scope='scene', shot_ids=[])
            if repair == 'add-shot':
                shot = deepcopy(output['direction']['shots'][0])
                shot['id'] = 'added-shot'
                camera = deepcopy(output['cinematography'][0])
                camera.update(id='added-camera', shot_id='added-shot')
                for row in (shot, camera):
                    for value in row.values():
                        if isinstance(value, dict) and value.get('text'):
                            value['sources'] = [{'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]
                output['direction']['shots'].append(shot)
                output['cinematography'].append(camera)
                output['applicability'][0]['shot_ids'] = ['added-shot']
        return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', lambda **_: SimpleNamespace(invoke=invoke))
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='scope-provider', name='openai', api_key='fixture', base_url='https://provider.invalid'))
            await db.flush()
            db.add(Model(id='scope-model', name='scope-test', category='text', provider_id='scope-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '生成范围检查',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        sample = editable_design_sample()
        content['design']['participants'] = [{'id': 'waiter', 'name': '店员'}]
        shot = deepcopy(sample['direction']['shots'][0])
        shot.update(beat_ids=[], event_ids=[], blocking_state_ids=[], criterion_ids=[], participant_ids=['waiter'])
        camera = deepcopy(sample['cinematography'][0])
        camera['criterion_ids'] = []
        content['design']['direction']['shots'] = [shot]
        content['design']['direction']['anchors'] = sample['direction']['anchors']
        content['design']['cinematography'] = [camera]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        original = saved.json()['data']
        response = await client.post(detail + '/design-suggestions', json={
            'request_id': str(uuid4()), 'expected_revision': original['revision'],
            'content': original['content'], 'model_id': 'scope-model'})
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        if legacy:
            async with sessions.begin() as db:
                from app.models.task import Task
                task = await db.get(Task, task_id)
                snapshot = deepcopy(task.input_snapshot)
                snapshot['run_args'].pop('design_candidate_version')
                task.input_snapshot = snapshot
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
        records = (await client.get(detail + '/design-suggestions')).json()['data']
        result = next(row for row in records if row['task_id'] == task_id)
        assert len(calls) == (1 if repair == 'initial' else 2)
        if repair is True or repair in ('initial', 'add-shot'):
            assert result['status'] == 'succeeded', result.get('error')
            assert result['design']['applicability'][0]['shot_ids'] == (['added-shot'] if repair == 'add-shot' else ['s1'])
            if repair == 'add-shot':
                assert any(row['shot_id'] == 'added-shot' for row in result['design']['cinematography'])
            assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview',
                json={'content': original['content']})).status_code == 200
        elif not legacy:
            assert result['status'] == 'succeeded', result
            assert result['candidate_attempt'] == (2 if repair is False else 1)
            assert result['design']['staging']['activities'][0]['ongoing_task']['text'] == '收碗'
            assert result['issues'][0]['owner'] == 'activity:activity-1'
            assert bool(result['diagnostics']) == (repair is not False)
            assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview',
                json={'content': original['content']})).status_code == 200
        else:
            assert result['status'] == 'failed', result
            assert result['design'] is None
            if repair != 'delete':
                assert '收碗' in result['diagnostics']['output']
            assert any('ongoing_task' in issue for issue in result['diagnostics']['issues'])
            assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview',
                json={'content': original['content']})).status_code == 422
        assert (await client.get(detail)).json()['data'] == original


@pytest.mark.asyncio
async def test_unassigned_actions_are_visible_and_only_consuming_units_need_scope_review(tmp_path):
    """设计范围与生产分工分别检查；另一完整镜头的单元继续准备。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '分工与缺项',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design'] = minimal_scoped_design_sample()
        design = content['design']
        second = deepcopy(design['direction']['shots'][0])
        second.update(id='s2', participant_ids=[], beat_ids=[], event_ids=[], criterion_ids=[])
        design['direction']['shots'].append(second)
        camera = deepcopy(design['cinematography'][0])
        camera.update(id='camera-2', shot_id='s2', criterion_ids=[])
        design['cinematography'].append(camera)
        activity = deepcopy(editable_design_sample()['staging']['activities'][0])
        for name, value in activity.items():
            if isinstance(value, dict) and 'state' in value:
                activity[name] = {}
        activity.update(participant_id='brother', trigger_event_id=None,
                        ongoing_task=note('沿桌边走动'), path=note('朝门口移动'))
        design['staging']['activities'] = [activity]
        design['applicability'] = [{
            'subject': {'kind': 'staging_activity', 'id': 'activity-1', 'field': 'ongoing_task'},
            'purpose': 'design', 'scope': 'shots', 'shot_ids': ['s1'],
        }]
        content['units'] = [
            {'id': 'u1', 'ratio': '16:9', 'instruction': '沿桌边走动',
             'coverage': [{'id': 'c1', 'shot_id': 's1', 'staging_activity_ids': ['activity-1']}]},
            {'id': 'u2', 'ratio': '16:9', 'instruction': '空镜', 'coverage': [{'id': 'c2', 'shot_id': 's2'}]},
        ]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved_content = saved.json()['data']['content']
        graph = saved.json()['data']['relationship_graph']
        assert any(issue['owner'] == 'beat:b1' and issue['field'] == 'must_show'
                   for issue in graph['preparation_issues'])
        for unit_id in ('u1', 'u2'):
            response = await client.post(detail + f'/units/{unit_id}/instruction-basis',
                                        json={'content': saved_content})
            assert response.status_code == 200, response.text
            scope = response.json()['data']['current']['scope']
            if unit_id == 'u1':
                assert any('activity:activity-1.path' in issue for issue in scope['unresolved'])
            else:
                assert scope['unresolved'] == []
                assert not any(row['owner'] == 'activity:activity-1' for row in scope['execution'])
