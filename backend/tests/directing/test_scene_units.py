"""可编辑单元通过真实场次版本接口保存；准备缺项与非法引用分别处理。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_incomplete_units_save_independently_and_protect_referenced_shot(tmp_path):
    """同镜头补拍有独立身份；未选模型可保存，删除被引用镜头须先解除单元覆盖。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '单元准备'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{
            'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': None, 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {},
        }]
        content['units'] = [{'id': identity, 'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one'}],
                             'ratio': ratio} for identity, ratio in [('unit-one', '16:9'), ('unit-two', '9:16')]]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = (await client.get(detail)).json()['data']
        assert [unit['id'] for unit in saved['content']['units']] == ['unit-one', 'unit-two']
        assert [unit['model_id'] for unit in saved['content']['units']] == [None, None]
        assert [unit['ratio'] for unit in saved['content']['units']] == ['16:9', '9:16']
        content = saved['content']
        for invalid in ['delete-shot', 'unknown-model', 'unknown-beat', 'duplicate-unit']:
            candidate = deepcopy(content)
            if invalid == 'delete-shot':
                candidate['design']['direction']['shots'] = []
            elif invalid == 'unknown-model':
                candidate['units'][0]['model_id'] = 'missing-model'
            elif invalid == 'unknown-beat':
                candidate['units'][0]['coverage'][0]['beat_ids'] = ['missing-beat']
            else:
                candidate['units'][1]['id'] = 'unit-one'
            rejected = await client.put(detail, json={
                'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
            assert rejected.status_code == 422, (invalid, rejected.text)
            if invalid == 'delete-shot':
                assert 'unit-one' in rejected.text and 'shot-one' in rejected.text
            assert (await client.get(detail)).json()['data']['content'] == content
        content['output_aspect_ratio'] = '1:1'
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert response.status_code == 200, response.text
        assert [unit['ratio'] for unit in response.json()['data']['content']['units']] == ['16:9', '9:16']


@pytest.mark.asyncio
async def test_unit_reference_requires_real_file_type_project_and_asset_origin(tmp_path):
    """可用素材能回读；伪造资产、跨项目引用及错误媒体类型不能写入方案。"""
    from app.models.studio import FileUsage
    from app.models.types import FileUsageKind

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(FileUsage(file_id='video2', project_id='p2', usage_kind=FileUsageKind.directing_reference,
                             source_ref='foreign'))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '参考准备'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{
            'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': None, 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {},
        }]
        binding = {'id': 'reference-one', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space',
                   'participant_ids': [], 'ordinal': 0,
                   'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}
        content['units'] = [{'id': 'unit-one', 'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one'}],
                             'ratio': '16:9', 'references': [binding]}]
        for invalid in ['asset-origin', 'foreign-project', 'wrong-type', 'missing-file']:
            candidate = deepcopy(content)
            reference = candidate['units'][0]['references'][0]
            if invalid == 'asset-origin':
                reference['asset_origin'] = {'kind': 'scene', 'id': 'missing-place', 'name': '伪造场所'}
            elif invalid == 'foreign-project':
                reference.update(file_id='video2', media_kind='video')
                reference['source'].update(file_id='video2', reference='video2')
            elif invalid == 'wrong-type':
                reference['media_kind'] = 'video'
            else:
                reference['file_id'] = 'missing-image'
            response = await client.put(detail, json={
                'request_id': str(uuid4()), 'expected_revision': 1, 'content': candidate})
            assert response.status_code == (404 if invalid == 'missing-file' else 422), (invalid, response.text)
            assert (await client.get(detail)).json()['data']['revision'] == 1
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        assert response.json()['data']['content']['units'][0]['references'][0]['file_id'] == 'image1'


@pytest.mark.asyncio
async def test_ai_whole_design_cannot_remove_a_shot_used_by_current_unit(tmp_path):
    """建议生成后新增的真实单元也参与应用校验，拒绝整份结果且保留原内容。"""
    from app.models.llm import Model, Provider
    from app.models.task import Task
    from app.services.task_service import TaskService

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='text-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add(Model(id='text-model', name='gpt-test', category='text', provider_id='text-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '引用保护'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{
            'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {},
        }]
        task_response = await client.post(detail + '/design-suggestions', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'text-model'})
        assert task_response.status_code == 200, task_response.text
        task_id = task_response.json()['data']['task_id']
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            proposal = deepcopy(task.input_snapshot['run_args']['previous_design'])
            proposal['direction']['shots'] = []
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture-worker')
            await service.finish(task_id, result=proposal)
        content['units'] = [{'id': 'unit-added-later', 'ratio': '16:9',
                             'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one'}]}]
        saved = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        response = await client.post(detail + '/design-suggestions/' + task_id + '/preview',
                                     json={'content': saved.json()['data']['content']})
        assert response.status_code == 422, response.text
        assert 'unit-added-later' in response.text and 'shot-one' in response.text
        assert (await client.get(detail)).json()['data']['content'] == saved.json()['data']['content']


@pytest.mark.asyncio
async def test_unit_dependency_can_be_declared_unready_but_must_name_frozen_source(tmp_path):
    """保存待准备依赖不伪造落幅；不存在的来源单元或半份证据仍须拒绝。"""
    from app.services.directing.store import DirectingStore
    from tests.directing.samples import design_sample, plan_sample
    from tests.directing.test_store import frozen

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        sequence_id = path.rsplit('/', 1)[1]
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, sequence_id, 'design', design_sample('dialogue'))
            plan = await frozen(store, sequence_id, 'plan', plan_sample(design.id))
            plan_id = plan.id
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '前段依赖'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = version['content']
        content['design']['direction']['shots'] = [{
            'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {},
        }]
        content['units'] = [{'id': 'unit-one', 'ratio': '16:9',
            'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one'}],
            'dependencies': [{'plan_revision_id': plan_id, 'unit_id': 'u1'}]}]
        saved = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        link = saved.json()['data']['content']['units'][0]['dependencies'][0]
        assert link['frame_id'] is None and link['reference_id'] is None
        for change in [{'unit_id': 'unknown'}, {'plan_revision_id': 'unknown'}, {'frame_id': 'missing-frame'}]:
            candidate = deepcopy(saved.json()['data']['content'])
            candidate['units'][0]['dependencies'][0].update(change)
            response = await client.put(detail, json={
                'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
            assert response.status_code == 422, response.text
            assert (await client.get(detail)).json()['data']['revision'] == 2


@pytest.mark.asyncio
async def test_manual_instruction_saves_on_its_unit_without_executing(tmp_path):
    """人工正文属于原单元；可保存未完成准备，错误正文类型整次拒绝。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '人工指令'})).json()['data']
        content = version['content']
        content['design']['direction']['shots'] = [{
            'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': None, 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {},
        }]
        content['units'] = [{'id': identity, 'ratio': '16:9',
                            'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one'}],
                            'instruction': instruction}
                           for identity, instruction in [('unit-one', '手指停在日期旁。\n镜头保持静止。'), ('unit-two', '')]]
        detail = path + '/versions/' + version['id']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = (await client.get(detail)).json()['data']
        assert [unit['instruction'] for unit in saved['content']['units']] == ['手指停在日期旁。\n镜头保持静止。', '']
        content['units'][0]['instruction'] = {'text': '不允许隐式转换'}
        rejected = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert rejected.status_code == 422
        assert (await client.get(detail)).json()['data'] == saved
