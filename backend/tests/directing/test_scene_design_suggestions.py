"""场次方案 AI 建议的真实 HTTP、事务和任务生命周期边界。"""
import json
from types import SimpleNamespace
from copy import deepcopy
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.models.task import Task
from app.services.task_service import TaskService
from app.services.directing.ai import DirectingOutputError, generate_directing_result
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_whole_design_preview_preserves_version_and_rejects_new_manual_edit(tmp_path):
    """明确提交冻结整场依据；完成仅供预览，人工修改后不能应用旧建议。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='text-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='text-model', name='gpt-test', category='text', provider_id='text-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '方案'})).json()['data']
        detail = path + '/versions/' + version['id']
        body = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': version['content'],
                'model_id': 'text-model', 'instruction': '明确观察视点'}
        response = await client.post(detail + '/design-suggestions', json=body)
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == task_id)
        assert origin['version_id'] == version['id']
        assert origin['unit_id'] is None
        assert origin['id'] == version['sequence_id']
        assert (await client.post(detail + '/design-suggestions', json=body)).json()['data']['task_id'] == task_id
        assert (await client.post(detail + '/design-suggestions', json={**body, 'instruction': '另一要求'})).status_code == 409
        assert (await client.post(detail + '/design-suggestions', json={**body, 'request_id': str(uuid4())})).status_code == 409
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            assert task.input_snapshot['run_args']['script_text'] == version['content']['basis']['text']
            result = deepcopy(version['content']['design'])
            result['direction']['viewpoint'] = {'state': 'proposal', 'text': '从弟弟的观察视点展开',
                'sources': [{'kind': 'model', 'reference': task.input_snapshot['run_args']['task_identity'], 'version': '1'}]}
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='test-worker')
            invalid = deepcopy(result)
            invalid['direction']['viewpoint']['sources'] = [version['content']['basis']['source']]
            responses = iter([invalid, result])
            generated = generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(next(responses)))), task.input_snapshot['run_args'])
            assert generated.direction.viewpoint.sources[0].kind == 'model'
            await service.finish(task_id, result=generated.model_dump(mode='json'))
        preview = await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': version['content']})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['design']['direction']['viewpoint']['text'] == '从弟弟的观察视点展开'
        assert (await client.get(detail)).json()['data'] == version
        edited = deepcopy(version['content'])
        edited['design']['direction']['viewpoint'] = {'state': 'proposal', 'text': '新的人工观察方向',
            'sources': [{'kind': 'human', 'reference': 'local-user', 'version': '1'}]}
        rejected = await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': edited})
        assert rejected.status_code == 409
        assert '设计已变化' in rejected.json()['detail']
        assert (await client.get(detail)).json()['data'] == version
        changed_basis = deepcopy(version['content'])
        changed_basis['basis']['source']['version'] = 'another-source'
        assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': changed_basis})).status_code == 409
        assert (await client.post((detail + '/design-suggestions/' + task_id + '/preview').replace('/p1/', '/p2/'), json={'content': version['content']})).status_code == 422
        tasks = (await client.get(detail + '/design-suggestions')).json()['data']
        assert [row['task_id'] for row in tasks] == [task_id]
        assert tasks[0]['status'] == 'succeeded'
        assert tasks[0]['basis'] == version['content']['basis']
        # 新方案任务不能从旧端点采用为独立设计草稿。
        assert (await client.post(path + '/design/apply', json={'task_id': task_id})).status_code == 422

        # 后续独立请求返回伪造人工来源时，预览必须拒绝整份建议。
        next_task = (await client.post(detail + '/design-suggestions', json={**body, 'request_id': str(uuid4())})).json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(next_task, worker_id='test-worker')
            await service.finish(next_task, result=edited['design'])
        invalid_source = await client.post(detail + '/design-suggestions/' + next_task + '/preview', json={'content': version['content']})
        assert invalid_source.status_code == 422
        assert '来源' in invalid_source.json()['detail']


@pytest.mark.asyncio
async def test_scoped_design_changes_only_second_of_six_shots_and_rejects_outside_edits(tmp_path):
    """范围在请求时固定；整份模型结果越界时拒绝，不能挑出合法部分应用。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='scope-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='scope-model', name='gpt-test', category='text', provider_id='scope-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '六镜头'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': f'shot-{index}', 'beat_ids': [],
            'event_ids': [], 'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {}} for index in range(6)]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        content = saved.json()['data']['content']
        body = {'request_id': str(uuid4()), 'expected_revision': 2, 'content': content,
                'model_id': 'scope-model', 'instruction': '只明确第二镜头可见结果',
                'scope': ['/direction/shots/1/visible_result']}
        for invalid_scope in [[], ['/direction/shots/1/id'], ['/direction/shots/9/visible_result']]:
            assert (await client.post(detail + '/design-suggestions', json={**body, 'scope': invalid_scope})).status_code == 422
        for outside in [False, True]:
            response = await client.post(detail + '/design-suggestions', json={**body, 'request_id': str(uuid4())})
            assert response.status_code == 200, response.text
            task_id = response.json()['data']['task_id']
            async with sessions.begin() as db:
                task = await db.get(Task, task_id)
                assert task.input_snapshot['run_args']['design_scope'] == body['scope']
                proposal = deepcopy(content['design'])
                note = {'state': 'proposal', 'text': '第二镜头：手指停在信封上',
                    'sources': [{'kind': 'model', 'reference': task.input_snapshot['run_args']['task_identity'], 'version': '1'}]}
                proposal['direction']['shots'][1]['visible_result'] = note
                if outside:
                    proposal['direction']['shots'][0]['visible_result'] = note
                service = TaskService(db)
                assert await service.claim(task_id, worker_id='scope-worker')
                await service.finish(task_id, result=proposal)
            preview = await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': content})
            if outside:
                assert preview.status_code == 422
                assert '/direction/shots/0/visible_result' in preview.json()['detail']
            else:
                assert preview.status_code == 200, preview.text
                result = preview.json()['data']['design']
                assert result['direction']['shots'][1]['visible_result']['text'] == note['text']
                result['direction']['shots'][1]['visible_result'] = content['design']['direction']['shots'][1]['visible_result']
                assert result == content['design']
            assert (await client.get(detail)).json()['data'] == saved.json()['data']


@pytest.mark.asyncio
async def test_design_preview_rejects_file_source_deleted_after_task_finishes(tmp_path):
    """未保存输入的真实来源在执行期间受保护，结束后删除则不能再应用建议。"""
    from fastapi import HTTPException
    from app.services.studio.files import delete_file

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='file-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='file-model', name='gpt-test', category='text', provider_id='file-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '来源核对'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['sources'].append({'kind': 'file', 'reference': 'image1', 'version': '1', 'file_id': 'image1'})
        response = await client.post(detail + '/design-suggestions', json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content, 'model_id': 'file-model'})
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        async with sessions.begin() as db:
            with pytest.raises(HTTPException) as error:
                await delete_file(db, file_id='image1')
            assert error.value.status_code == 409
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='file-worker')
            await service.finish(task_id, result=content['design'])
        assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': content})).status_code == 200
        async with sessions.begin() as db:
            await delete_file(db, file_id='image1')
        rejected = await client.post(detail + '/design-suggestions/' + task_id + '/preview', json={'content': content})
        assert rejected.status_code == 410
        assert (await client.get(detail)).json()['data'] == version


@pytest.mark.parametrize('source', [
    {'kind': 'chapter', 'reference': 'chapter', 'version': '1'},
    {'kind': 'human', 'reference': 'author', 'version': '1'},
    {'kind': 'model', 'reference': 'old-task', 'version': '1'},
    {'kind': 'model', 'reference': 'current-task', 'version': '2'},
])
@pytest.mark.parametrize('scope', [None, ['/direction/information_change']])
def test_generation_retries_invalid_task_sources_before_returning_success(source, scope):
    """结构合法的错误来源必须在完成前纠错；保留原人工内容不应触发误判。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign

    original = EditableSceneDesign(sources=[{'kind': 'chapter', 'reference': 'chapter', 'version': '1'}]).model_dump(mode='json')
    original['direction']['viewpoint'] = {'state': 'proposal', 'text': '保留人工视点',
        'sources': [{'kind': 'human', 'reference': 'author', 'version': '1'}]}
    invalid = deepcopy(original)
    invalid['direction']['information_change'] = {'state': 'proposal', 'text': '读信后产生迟疑', 'sources': [source]}
    corrected = deepcopy(invalid)
    corrected['direction']['information_change']['sources'] = [{'kind': 'model', 'reference': 'current-task', 'version': '1'}]
    args = {'scene_version_design': True, 'task_identity': 'current-task', 'previous_design': original,
        'design_scope': scope}
    messages_seen = []

    def invoke(messages):
        messages_seen.append(list(messages))
        return SimpleNamespace(content=json.dumps(invalid if len(messages_seen) == 1 else corrected))

    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert len(messages_seen) == 2
    assert result.direction.information_change.sources[0].reference == 'current-task'
    assert result.direction.viewpoint == EditableSceneDesign.model_validate(original).direction.viewpoint
    assert '来源' in messages_seen[1][-1].content
    with pytest.raises(DirectingOutputError, match='来源'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), args)
