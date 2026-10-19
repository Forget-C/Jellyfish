"""当前单元检查的固定正文、依据与任务隔离，经真实 HTTP 验证。"""
from copy import deepcopy
import json
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
async def test_check_freezes_confirmed_inputs_and_does_not_apply_results(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='check-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id='check-text', name='gpt-test', category='text', provider_id='check-provider', params={}),
                        Model(id='check-video', name='test-video-model', category='video', provider_id='check-provider', params={})])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '检查输入'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'model_id': 'check-video', 'duration_ms': 5000, 'ratio': '16:9', 'instruction': '递出信封。', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '递出信封'}]}]
        detail = path + '/versions/' + version['id']
        unit_url = detail + '/units/unit'
        url = unit_url + '/instruction-checks'
        request = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'check-text'}
        assert (await client.post(url, json=request)).status_code == 409
        confirmation = await client.post(unit_url + '/instruction-basis/confirm', json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        content['units'][0]['instruction_basis_id'] = confirmation.json()['data']['basis_id']
        submitted = await client.post(url, json=request)
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        history = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1'})).json()['data']['items']
        origin = next(row['source'] for row in history if row['task_id'] == task_id)
        assert origin['version_id'] == version['id']
        assert origin['unit_id'] == 'unit'
        assert origin['id'] == version['sequence_id']
        assert (await client.post(url, json=request)).json()['data']['task_id'] == task_id
        assert (await client.post(url, json={**request, 'request_id': str(uuid4())})).status_code == 409
        changed = deepcopy(request)
        changed['content']['units'][0]['instruction'] = '收下信封。'
        assert (await client.post(url, json=changed)).status_code == 409
        rows = (await client.get(url)).json()['data']
        assert len(rows) == 1 and rows[0]['instruction'] == '递出信封。'
        assert rows[0]['result'] is None and rows[0]['status'] == 'queued'
        result = {'unit_id': 'unit', 'rows': [{'role': role, 'occurrence_id': 'coverage', 'verdict': 'pass', 'rationale': '明确表达递信动作', 'findings': []} for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
                  'destinations': [{'owner': 'coverage:coverage', 'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                                    'destination': 'instruction', 'instruction_excerpt': '递出信封', 'reference_id': None,
                                    'rationale': '正文直接表达'}]}
        async with sessions.begin() as db:
            frozen = (await db.get(Task, task_id)).input_snapshot['run_args']
            assert frozen['inputs']['design']['direction']['shots']
            def invoke(messages):
                sent = json.loads(messages[1].content)
                assert 'design' not in sent['inputs'] and sent['inputs']['scope']['execution']
                return SimpleNamespace(content=json.dumps(result))
            generate_directing_result('directing_instruction_check', SimpleNamespace(invoke=invoke), frozen)
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='check-fixture')
            await service.finish(task_id, result=result)
        rows = (await client.get(url)).json()['data']
        assert rows[0]['result'] == result
        assert rows[0]['inputs']['unit']['coverage'][0]['action_scope'] == '递出信封'
        assert (await client.get(detail)).json()['data'] == version
        changed['request_id'] = str(uuid4())
        changed['content']['units'][0]['coverage'][0]['action_scope'] = '收下信封'
        assert (await client.post(url, json=changed)).status_code == 409
        assert (await client.get(url)).json()['data'][0]['instruction'] == '递出信封。'

        compare_url = url + '/' + task_id + '/compare'
        compared = await client.post(compare_url, json={'content': content})
        assert compared.status_code == 200, compared.text
        assert compared.json()['data'] == {'task_id': task_id, 'matches_current': True, 'basis_current': True, 'confirmed': False}
        confirm_url = url + '/' + task_id + '/confirm'
        confirmed = await client.post(confirm_url, json={'content': content})
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()['data']['task_id'] == task_id
        assert (await client.get(detail)).json()['data'] == version
        text_changed = deepcopy(content)
        text_changed['units'][0]['instruction'] = '收下信封。'
        assert (await client.post(compare_url, json={'content': text_changed})).json()['data']['matches_current'] is False
        assert (await client.post(confirm_url, json={'content': text_changed})).status_code == 409
        unrelated = deepcopy(content)
        unrelated['units'].append({**deepcopy(content['units'][0]), 'id': 'other', 'instruction': '另一单元独立正文', 'instruction_basis_id': None})
        assert (await client.post(compare_url, json={'content': unrelated})).json()['data']['matches_current'] is True
        unconfirmed = deepcopy(content)
        unconfirmed['units'][0]['instruction_basis_id'] = None
        check = (await client.post(compare_url, json={'content': unconfirmed})).json()['data']
        assert check['matches_current'] is True and check['basis_current'] is False
        assert (await client.post(compare_url, json={'content': changed['content']})).json()['data']['matches_current'] is False
        assert (await client.post(compare_url.replace('/unit/', '/other/'), json={'content': unrelated})).status_code == 422

        reference_changed = deepcopy(content)
        reference_changed['units'][0]['references'] = [{'id': 'first-frame', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space', 'input_role': 'first_frame', 'participant_ids': [], 'ordinal': 0,
            'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}]
        reference_comparison = (await client.post(compare_url, json={'content': reference_changed})).json()['data']
        assert reference_comparison['matches_current'] is False
        assert reference_comparison['basis_current'] is False
        assert (await client.post(confirm_url, json={'content': reference_changed})).status_code == 409
        assert (await client.post(url, json={**request, 'request_id': str(uuid4()), 'content': reference_changed})).status_code == 409

        bound = deepcopy(content)
        bound['units'][0]['instruction_check_task_id'] = task_id
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': bound})
        assert saved.status_code == 200, saved.text
        assert (await client.post(compare_url, json={'content': saved.json()['data']['content']})).json()['data']['confirmed'] is True
        prepare_url = unit_url + '/video/prepare'
        prepared = await client.post(prepare_url, json={'expected_revision': 2})
        assert prepared.status_code == 200, prepared.text
        execution = prepared.json()['data']
        assert execution['request']['execution_prompt'] == '递出信封。'
        assert execution['request']['model_id'] == 'check-video'
        assert execution['request']['operation_input']['seconds'] == 5
        assert execution['check_task_id'] == task_id
        assert (await client.post(prepare_url, json={'expected_revision': 1})).status_code == 409
        bound['units'][0]['instruction'] = '收下信封。'
        assert (await client.post(compare_url, json={'content': bound})).json()['data']['confirmed'] is False
        changed_saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': bound})
        assert changed_saved.status_code == 200, changed_saved.text
        assert (await client.post(prepare_url, json={'expected_revision': 3})).status_code == 409
        bound['units'][0]['instruction_check_task_id'] = 'missing-check'
        assert (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': bound})).status_code == 422
        request['expected_revision'] = 3

        # 读出历史结果也校验固定清单，不把损坏或漏岗的结果当作成功检查。
        again = await client.post(url, json={**request, 'request_id': str(uuid4())})
        assert again.status_code == 200, again.text
        async with sessions.begin() as db:
            service = TaskService(db)
            second_id = again.json()['data']['task_id']
            assert await service.claim(second_id, worker_id='check-fixture')
            await service.finish(second_id, result={**result, 'rows': result['rows'][:-1]})
        assert (await client.get(url)).status_code == 422
