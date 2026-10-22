"""同组多图经场次保存、固定任务和真实媒体读取到供应商传输边界。"""
import asyncio
import base64
from copy import deepcopy
import json
from uuid import uuid4

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import FileItem
from app.services.task_service import TaskService
from app.task_worker import TaskWorker
from tests.directing.samples import complete_shot_scope_sample
from tests.directing.test_api import client_for
from tests.directing.test_identity_reference_groups import version_with_identity
from tests.directing.test_scene_video import reference_storage  # noqa: F401
from tests.directing.test_store import database


@pytest.mark.asyncio
@pytest.mark.parametrize('bytes_available', [True, False])
async def test_group_images_keep_order_and_fixed_identity_through_worker(tmp_path, reference_storage, bytes_available):
    reference_storage['/scene-test/files/space.png'] = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
    reference_storage['/scene-test/files/second.png'] = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC')
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add_all([Provider(id='text-provider', name='openai', base_url='https://api.openai.com/v1', api_key='fixture'),
                        Provider(id='subject-provider', name='vidu', base_url='https://api.vidu.cn', api_key='fixture')])
            await db.flush()
            db.add_all([Model(id='text', name='gpt-test', category='text', provider_id='text-provider', params={}),
                        Model(id='video', name='viduq2', category='video', provider_id='subject-provider', params={}),
                        FileItem(id='second-image', type='image', name='另一视角', storage_key='files/second.png')])
        detail, content = await version_with_identity(client)
        unit = content['units'][0]
        unit.update(model_id='video', instruction='人物递出信封。', duration_ms=5000, parameters={'seed': 17})
        unit['coverage'][0]['action_scope'] = '递出信封'
        unit['references'].append({**deepcopy(unit['references'][0]), 'id': 'r2', 'file_id': 'second-image', 'ordinal': 1})
        complete_shot_scope_sample(content, '递出信封')
        url = detail + '/units/unit'
        basis = await client.post(url + '/instruction-basis/confirm', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert basis.status_code == 200, basis.text
        unit['instruction_basis_id'] = basis.json()['data']['basis_id']
        check = await client.post(url + '/instruction-checks', json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content, 'model_id': 'text'})
        assert check.status_code == 200, check.text
        check_id = check.json()['data']['task_id']
        async with sessions.begin() as db:
            service = TaskService(db)
            assert await service.claim(check_id, worker_id='check-fixture')
            await service.finish(check_id, result={'unit_id': 'unit', 'rows': [
                {'role': role, 'occurrence_id': 'coverage', 'verdict': 'pass', 'rationale': '动作与身份明确', 'findings': []}
                for role in ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']],
                'destinations': [
                    {'owner': 'coverage:coverage', 'field': 'action_scope', 'coverage_item_ids': ['coverage'],
                     'destination': 'instruction', 'instruction_excerpt': '递出信封', 'rationale': '正文表达动作'},
                    {'owner': 'participant:person', 'field': 'identity', 'coverage_item_ids': ['coverage'],
                     'destination': 'reference', 'reference_id': 'r1', 'rationale': '固定身份组'}]})
        confirmed = await client.post(url + '/instruction-checks/' + check_id + '/confirm', json={'content': content})
        assert confirmed.status_code == 200, confirmed.text
        unit['instruction_check_task_id'] = check_id
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        submitted = await client.post(url + '/video', json={'request_id': str(uuid4()), 'expected_revision': 2})
        assert submitted.status_code == 200, submitted.text
        video_id = submitted.json()['data']['task_id']
        original = saved.json()['data']['content']['units'][0]['references']
        unit['references'] = [unit['references'][1]]
        changed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert changed.status_code == 200, changed.text
        if not bytes_available:
            reference_storage.pop('/scene-test/files/second.png')
        requests = []
        def provider(request):
            requests.append((request.url.path, json.loads(request.content)))
            return httpx.Response(200, json={'task_id': 'subject-provider-task'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
            worker = TaskWorker(sessions, client=transport)
            try:
                await worker.tick()
                await asyncio.gather(*list(worker.jobs.values()))
            finally:
                worker.text_pool.shutdown(wait=True)
        video = next(row for row in (await client.get(url + '/video')).json()['data'] if row['task_id'] == video_id)
        assert video['preparation']['inputs']['unit']['references'] == original
        assert video['takes'] == []
        if bytes_available:
            assert video['status'] == 'running'
            assert requests == [('/ent/v2/reference2video', {
                'model': 'viduq2', 'prompt': '人物递出信封。', 'aspect_ratio': '16:9', 'duration': 5, 'seed': 17,
                'subjects': [{'name': 'person-group', 'images': [
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC']}],
            })]
        else:
            assert video['status'] == 'failed'
            assert requests == []
