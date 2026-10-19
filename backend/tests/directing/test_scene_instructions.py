"""当前单元指令建议通过真实 HTTP 和任务事务验证。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_instruction_preview_is_unit_scoped_and_rechecks_manual_input(tmp_path):
    """同请求不重复；别的单元编辑不影响本次建议，本单元改动阻止旧建议。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='text-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='text-model', name='gpt-test', category='text', provider_id='text-provider', params={}),
                        Model(id='video-model', name='test-video-model', category='video', provider_id='text-provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '指令建议'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot-one', 'beat_ids': [], 'event_ids': [],
            'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': uid, 'model_id': 'video-model', 'duration_ms': 5000, 'ratio': '16:9',
            'coverage': [{'id': 'coverage-one', 'shot_id': 'shot-one', 'action_scope': '递出信封'}]}
            for uid in ['unit-one', 'unit-two']]
        style_url = path.split('/sequences/')[0] + '/styles'
        source = {'kind': 'human', 'reference': 'style-author', 'version': '1'}
        style_response = await client.post(style_url, json={'content': {'title': '指令固定风格', 'sources': [source], 'rules': [
            {'id': 'steady', 'role': 'cinematography', 'requirement': '固定机位，保持空间关系', 'status': 'confirmed', 'sources': [source]},
            {'id': 'candidate', 'role': 'performance', 'requirement': '尚未确认的风格不执行', 'sources': [source]},
        ]}})
        assert style_response.status_code == 200, style_response.text
        style = style_response.json()['data'][0]
        assert (await client.post(style_url + '/' + style['id'] + '/confirm', json={'expected_version': style['version']})).status_code == 200
        content['design']['style_revision_id'] = style['id']
        content['design']['direction']['viewpoint'] = {'state': 'proposal', 'text': '当次观察视点', 'sources': [source]}
        detail = path + '/versions/' + version['id']
        url = detail + '/units/unit-one/instruction-suggestions'
        body = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'text-model'}
        for field, value in [('model_id', None), ('duration_ms', 3500), ('ratio', '4:5'), ('parameters', {'unknown': 3})]:
            invalid = deepcopy(body)
            invalid['content']['units'][0][field] = value
            rejected = await client.post(url, json=invalid)
            assert rejected.status_code == 422, (field, rejected.text)
        assert (await client.get(url)).json()['data'] == []
        response = await client.post(url, json=body)
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == task_id)
        assert origin['version_id'] == version['id']
        assert origin['unit_id'] == 'unit-one'
        assert origin['id'] == version['sequence_id']
        assert (await client.post(url, json=body)).json()['data']['task_id'] == task_id
        assert (await client.post(url, json={**body, 'requirements': '另一要求'})).status_code == 409
        assert (await client.post(url, json={**body, 'request_id': str(uuid4())})).status_code == 409
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='instruction-fixture')
            await service.finish(task_id, result={'unit_id': 'unit-one', 'text': '中景，递出信封并等待对方接取。'})
        preview_url = url + '/' + task_id + '/preview'
        preview = await client.post(preview_url, json={'content': content})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['text'] == '中景，递出信封并等待对方接取。'
        assert (await client.get(detail)).json()['data'] == version
        apply_url = url + '/' + task_id + '/apply'
        applied = await client.post(apply_url, json={'content': content})
        assert applied.status_code == 200, applied.text
        receipt = applied.json()['data']
        assert receipt['basis_id']
        assert receipt['text'] == '中景，递出信封并等待对方接取。'
        assert (await client.post(apply_url, json={'content': content})).json()['data'] == receipt
        assert (await client.get(detail)).json()['data'] == version
        bound = deepcopy(content)
        bound['units'][0].update(instruction=receipt['text'], instruction_source=receipt['source'], instruction_basis_id=receipt['basis_id'])
        basis_url = detail + '/units/unit-one/instruction-basis'
        assert (await client.post(basis_url, json={'content': bound})).json()['data']['status'] == 'current'
        bound['units'][0]['coverage'][0]['action_scope'] = '收下信封'
        assert (await client.post(basis_url, json={'content': bound})).json()['data']['status'] == 'changed'
        assert (await client.post(apply_url, json={'content': bound})).status_code == 409
        other = deepcopy(content)
        other['units'][1]['instruction'] = '另一个单元的人工正文'
        assert (await client.post(preview_url, json={'content': other})).status_code == 200
        unrelated = deepcopy(content)
        unrelated['design']['direction']['shots'].append({
            **deepcopy(content['design']['direction']['shots'][0]), 'id': 'shot-other',
            'visible_result': {'state': 'proposal', 'text': '另一镜头独立动作', 'sources': [source]},
        })
        unrelated['units'][1]['coverage'][0]['shot_id'] = 'shot-other'
        unrelated_preview = await client.post(preview_url, json={'content': unrelated})
        assert unrelated_preview.status_code == 200, unrelated_preview.text
        related = deepcopy(unrelated)
        related['design']['direction']['shots'][0]['visible_result'] = {'state': 'proposal', 'text': '本镜头变为收信', 'sources': [source]}
        assert (await client.post(preview_url, json={'content': related})).status_code == 409
        changed = deepcopy(content)
        changed['units'][0]['instruction'] = '新的人工正文'
        assert (await client.post(preview_url, json={'content': changed})).status_code == 409
        assert (await client.post(preview_url.replace('/unit-one/', '/unit-two/'), json={'content': content})).status_code == 422
        rows = (await client.get(url)).json()['data']
        assert len(rows) == 1 and rows[0]['task_id'] == task_id
        assert rows[0]['unit']['id'] == 'unit-one'
        assert rows[0]['generation_model_name'] == 'gpt-test'
        assert rows[0]['generation_model_id'] == 'text-model'
        assert rows[0]['video_model_name'] == 'test-video-model'
        assert [rule['requirement'] for rule in rows[0]['style_rules']] == ['固定机位，保持空间关系']
        assert any(use['owner'] == 'style:steady' and use['text'] == '固定机位，保持空间关系'
                   and use['phase'] == 'video' for use in rows[0]['unit_scope']['constraints'])
        assert rows[0]['style_rules'][0]['sources'] == [{**source, 'file_id': None, 'media_range': None}]
        assert rows[0]['design']['direction']['viewpoint']['text'] == '当次观察视点'


        other_task = await client.post(url.replace('/unit-one/', '/unit-two/'), json=body)
        assert other_task.status_code == 200, other_task.text
        assert other_task.json()['data']['task_id'] != task_id
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(other_task.json()['data']['task_id'], worker_id='wrong-unit-fixture')
            await service.finish(other_task.json()['data']['task_id'], result={'unit_id': 'unit-one', 'text': '错误目标'})
        wrong = await client.post(url.replace('/unit-one/', '/unit-two/') + '/' + other_task.json()['data']['task_id'] + '/preview', json={'content': content})
        assert wrong.status_code == 422
        assert '身份' in wrong.json()['detail']


        # 限定范围以 Unicode 字符计数，重复文字不用于猜测修改位置。
        scoped = deepcopy(body)
        scoped['content']['units'][0]['instruction'] = '🙂开头旧文结尾'
        scoped['scope'] = {'start': 3, 'end': 5}
        for scope in [{'start': -1, 'end': 5}, {'start': 5, 'end': 3}, {'start': 3, 'end': 99}]:
            invalid = {**scoped, 'request_id': str(uuid4()), 'scope': scope}
            assert (await client.post(url, json=invalid)).status_code == 422
        scoped['request_id'] = str(uuid4())
        scoped_task = await client.post(url, json=scoped)
        assert scoped_task.status_code == 200, scoped_task.text
        scoped_id = scoped_task.json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(scoped_id, worker_id='scoped-instruction-fixture')
            await service.finish(scoped_id, result={'unit_id': 'unit-one', 'text': '🙂开头新的动作结尾'})
        scoped_preview = await client.post(url + '/' + scoped_id + '/preview', json={'content': scoped['content']})
        assert scoped_preview.status_code == 200, scoped_preview.text
        assert scoped_preview.json()['data']['text'] == '🙂开头新的动作结尾'
        scoped_rows = (await client.get(url)).json()['data']
        assert next(row for row in scoped_rows if row['task_id'] == scoped_id)['scope'] == {'start': 3, 'end': 5}
        scoped['request_id'] = str(uuid4())
        invalid_task = (await client.post(url, json=scoped)).json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(invalid_task, worker_id='out-of-scope-fixture')
            await service.finish(invalid_task, result={'unit_id': 'unit-one', 'text': '改了开头新的动作结尾'})
        invalid_preview = await client.post(url + '/' + invalid_task + '/preview', json={'content': scoped['content']})
        assert invalid_preview.status_code == 422
        assert '范围' in invalid_preview.json()['detail']
        assert (await client.get(detail)).json()['data'] == version

        # 发起任务时就隔离无关镜头，而不是事后忽略实际发送过的输入。
        isolated = await client.post(url, json={**body, 'request_id': str(uuid4()), 'content': unrelated})
        assert isolated.status_code == 200, isolated.text
        isolated_id = isolated.json()['data']['task_id']
        isolated_record = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == isolated_id)
        assert [shot['id'] for shot in isolated_record['design']['direction']['shots']] == ['shot-one']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(isolated_id, worker_id='isolated-design-fixture')
            await service.finish(isolated_id, result={'unit_id': 'unit-one', 'text': '原单元独立指令'})
        unrelated['design']['direction']['shots'][1]['visible_result']['text'] = '另一镜头再次修改'
        isolated_url = url + '/' + isolated_id + '/preview'
        assert (await client.post(isolated_url, json={'content': unrelated})).status_code == 200
        changed_shared = deepcopy(unrelated)
        changed_shared['design']['direction']['viewpoint']['text'] = '共享观察视点改变'
        assert (await client.post(isolated_url, json={'content': changed_shared})).status_code == 409
        changed_action = deepcopy(unrelated)
        changed_action['units'][0]['coverage'][0]['action_scope'] = '收下信封'
        assert (await client.post(isolated_url, json={'content': changed_action})).status_code == 409
        changed_parameter = deepcopy(unrelated)
        changed_parameter['units'][0]['parameters'] = {'seed': 42}
        assert (await client.post(isolated_url, json={'content': changed_parameter})).status_code == 409

        # 当前设计后来保存了新内容，旧建议仍展示原任务的输入。
        updated = deepcopy(content)
        updated['design']['direction']['viewpoint']['text'] = '保存后的新观察视点'
        saved_current = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': updated})
        assert saved_current.status_code == 200, saved_current.text
        old_record = next(row for row in (await client.get(url)).json()['data'] if row['task_id'] == task_id)
        assert old_record['design']['direction']['viewpoint']['text'] == '当次观察视点'
        assert old_record['style_rules'][0]['requirement'] == '固定机位，保持空间关系'
        assert (await client.get(detail)).json()['data']['content']['design']['direction']['viewpoint']['text'] == '保存后的新观察视点'
