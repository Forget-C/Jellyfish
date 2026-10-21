"""补拍通过真实 HTTP 保留来源与准备输入。"""
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
async def test_supplement_preserves_source_and_inherits_preparation(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'))
            await db.flush()
            db.add_all([Model(id=identity, name=name, category=category, provider_id='provider', params={})
                        for identity, name, category in [('text', 'gpt-test', 'text'),
                            ('source-video', 'sora-2', 'video'), ('target-video', 'sora-2-pro', 'video')]])
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '补拍'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        note = {'state': 'proposal', 'text': '拆信；读信；抬头',
                'sources': [{'kind': 'human', 'reference': 'user', 'version': '1'}]}
        content['design']['direction']['shots'] = [{'id': 'shot', 'visible_result': note, 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}}]
        content['units'] = [{'id': 'source', 'ratio': '16:9', 'model_id': 'source-video',
            'parameters': {'seed': 17}, 'instruction': '仅抬头',
            'instruction_source': {'kind': 'human', 'reference': 'user', 'version': '1'},
            'coverage': [{'id': 'source-coverage', 'shot_id': 'shot', 'action_scope': '拆信；读信；抬头'}]},
            {'id': 'second', 'ratio': '16:9', 'coverage': [{'id': 'second-coverage', 'shot_id': 'shot', 'action_scope': '读信'}]}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        content = saved.json()['data']['content']
        url = detail + '/unit-design-suggestions'
        submitted = await client.post(url, json={'request_id': str(uuid4()), 'expected_revision': 2,
            'content': content, 'shot_id': 'shot', 'source_unit_id': 'source', 'target_model_id': 'target-video',
            'model_id': 'text', 'instruction': '保留原单元，仅新增抬头补拍'})
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()['data']['task_id']
        proposed = {'shot_id': 'shot', 'target_model_id': 'target-video', 'organization': '保留原单元并补拍',
            'units': [{'id': unit['id'], 'ratio': unit['ratio'], 'reason': '保留', 'coverage': unit['coverage']}
                      for unit in content['units']] + [{'id': 'supplement', 'ratio': '16:9', 'reason': '补拍',
                       'coverage': [{'id': 'supplement-coverage', 'shot_id': 'shot', 'action_scope': '抬头'}]}]}
        async with sessions.begin() as db:
            task = await db.get(Task, task_id)
            result = generate_directing_result('directing_unit_design',
                SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(proposed))), task.input_snapshot['run_args'])
            service = TaskService(db)
            assert await service.claim(task_id, worker_id='fixture')
            await service.finish(task_id, result=result.model_dump(mode='json'))
        applied = await client.post(url + '/' + task_id + '/apply', json={'content': content})
        assert applied.status_code == 200, applied.text
        candidate = applied.json()['data']
        assert candidate['units'][:2] == content['units']
        supplement = candidate['units'][2]
        assert supplement['model_id'] == 'target-video'
        assert supplement['parameters'] == {'seed': 17}
        assert supplement['instruction'] == '仅抬头'
        assert supplement['instruction_source'] == content['units'][0]['instruction_source']
        assert supplement['instruction_basis_id'] is None and supplement['instruction_check_task_id'] is None
        assert supplement['coverage'][0]['action_scope'] == '抬头'
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': candidate})
        assert saved.status_code == 200, saved.text
        assert (await client.get(detail)).json()['data']['content'] == candidate
