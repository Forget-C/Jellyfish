"""章节管理摘要从公开接口读取，不返回完整画布、对象或资产数据。"""

from hashlib import sha256

import pytest

from app.models.directing import Sequence
from app.models.task import Task
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_management_overview_distinguishes_saved_empty_preparation_from_unprepared(tmp_path):
    """零对象的成功准备、原文过时、真实任务及跨项目归属都能分别识别。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        version = (await client.get(chapter)).json()['data']['source_version']

        async def create_scene(title, position, start, end):
            response = await client.post(chapter + '/sequences', json={
                'title': title, 'position': position, 'source_version': version, 'span': {'start': start, 'end': end},
            })
            assert response.is_success, response.text
            return response.json()['data']['id']

        second = await create_scene('谈话', 1, 3, 6)
        first = await create_scene('兄弟', 0, 0, 3)
        history = await create_scene('旧范围', 2, 6, 7)
        canvas = await client.post(chapter + '/sequences/' + first + '/canvases',
                                   json={'name': '管理方案'})
        assert canvas.is_success, canvas.text

        # Set up a committed extraction snapshot and an unrelated task.
        async with sessions.begin() as db:
            saved = await db.get(Sequence, first)
            saved.object_preparation = {
                'revision': 1, 'source_version': version, 'objects': [],
                'source_digest': sha256(f'{version}:0:兄弟在'.encode()).hexdigest(),
            }
            stale = await db.get(Sequence, history)
            stale.is_current = False
            stale.object_preparation = {'revision': 1, 'objects': [{}], 'source_digest': 'prior-source'}
            db.add_all([
                Task(id='extract-management', project_id='p1', target_id=first,
                     target_type='directing_sequence', kind='directing_object_extract', status='running', stage='running'),
                Task(id='foreign-storyboard', project_id='p2', target_id=second,
                     target_type='directing_sequence', kind='directing_storyboard', status='queued'),
            ])

        path = chapter + '/workbench-management'
        response = await client.get(path)
        assert response.is_success, response.text
        data = response.json()['data']
        assert data['has_source'] is True
        assert [row['id'] for row in data['sequences']] == [first, second]
        current, unprepared = data['sequences']
        assert current['object_count'] == 0 and current['has_object_preparation'] is True
        assert current['preparation_stale'] is False and current['canvas_count'] == 1
        assert current['object_task']['task_id'] == 'extract-management'
        assert current['object_task']['status'] == 'running'
        assert unprepared['object_count'] == 0 and unprepared['has_object_preparation'] is False
        assert unprepared['canvas_count'] == 0 and unprepared['storyboard_task'] is None
        assert data['historical_sequences'][0]['id'] == history
        assert data['historical_sequences'][0]['preparation_stale'] is True
        assert data['historical_sequences'][0]['object_count'] == 1
        assert not {'assets', 'objects', 'canvases', 'source_text'} & set(current)
        assert (await client.get(path.replace('/p1/', '/p2/'))).status_code == 422
