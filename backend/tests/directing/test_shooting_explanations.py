"""拍摄解释通过章节接口独立保存。"""
import asyncio
from types import SimpleNamespace

import pytest

from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database

BASE = '/api/v1/studio/projects/p1/directing/chapters/ch1'


@pytest.mark.asyncio
async def test_save_shooting_explanations_without_scenes(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        chapter = (await client.get(BASE)).json()['data']
        path = BASE + '/shooting-explanations'
        body = {'source_version': chapter['source_version'], 'expected_version': 0,
                'request_id': 'first-save', 'preparation': {'notes': [{'id': 'space', 'text': '其余人物仍在车旁'}]}}
        response = await client.put(path, json=body)
        assert response.status_code == 200, response.text
        assert response.json()['data']['version'] == 1
        assert (await client.put(path, json=body)).json() == response.json()
        assert (await client.put(path, json={**body, 'request_id': 'stale'})).status_code == 409
        assert (await client.get(path, params={'source_version': chapter['source_version']})).json() == response.json()
        current = (await client.get(BASE)).json()['data']
        assert current['sequences'] == []
        assert current['current_version'] is None
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text += '另一段。'
        latest = (await client.get(BASE)).json()['data']
        projected = (await client.get(path, params={'source_version': latest['source_version']})).json()['data']
        assert projected['version'] == 0
        assert projected['preparation']['notes'][0]['choice'] == 'review'
        first = await client.post(BASE + '/sequences', json={'title': '第一场', 'position': 0,
            'source_version': latest['source_version'], 'span': {'start': 0, 'end': 2}})
        assert first.status_code == 200, first.text
        persisted = (await client.get(path, params={'source_version': latest['source_version']})).json()['data']
        assert persisted['version'] == 1
        assert persisted['preparation'] == projected['preparation']


@pytest.mark.asyncio
async def test_whole_chapter_check_keeps_original_report(tmp_path, monkeypatch):
    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, messages):
            assert '整章拍摄检查' in messages[0].content
            assert '甲在车旁。乙从另一侧下车。' in messages[1].content
            return SimpleNamespace(content='{"issues":[{"id":"route","category":"path","kind":"optional",'
                                           '"excerpt":"乙从另一侧下车","problem":"可选择出车后的路线"}]}')

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = '甲在车旁。乙从另一侧下车。'
            db.add(Provider(id='provider', name='openai', base_url='https://prep.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='text', name='text', category='text', provider_id='provider'))
        chapter = (await client.get(BASE)).json()['data']
        path = BASE + '/shooting-checks'
        response = await client.post(path, json={'source_version': chapter['source_version'],
                                                'request_id': 'chapter-check', 'model_id': 'text'})
        assert response.status_code == 200, response.text
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
        result = (await client.get(path, params={'source_version': chapter['source_version']})).json()['data']
        assert result['status'] == 'succeeded', result
        assert result['report']['issues'][0]['excerpt'] == '乙从另一侧下车'
        assert (await client.get(BASE)).json()['data']['sequences'] == []


@pytest.mark.asyncio
async def test_notes_follow_actual_source_and_scene_range(tmp_path):
    raw = '甲在车旁。乙到教室。'
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = raw
        old = (await client.get(BASE)).json()['data']
        scenes = []
        for position, (start, end) in enumerate(((0, 5), (5, 10))):
            response = await client.post(BASE + '/sequences', json={'title': f'场{position}', 'position': position,
                'source_version': old['source_version'], 'span': {'start': start, 'end': end}})
            assert response.status_code == 200, response.text
            scenes.append(BASE + '/sequences/' + response.json()['data']['id'])
        path = BASE + '/shooting-explanations'
        body = {'source_version': old['source_version'], 'expected_version': 0, 'request_id': 'old',
                'preparation': {'notes': [
                    {'id': 'car', 'text': '特写时甲仍在车旁', 'scope': {'start': 0, 'end': 5}, 'excerpt': '甲在车旁'},
                    {'id': 'room', 'text': '保持室内状态', 'scope': {'start': 5, 'end': 10}},
                    {'id': 'all', 'text': '时间连续'}]}}
        response = await client.put(path, json=body)
        assert response.status_code == 200, response.text
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = '雨停了。甲在车旁。乙到车站。'
        latest = (await client.get(BASE)).json()['data']
        inherited = (await client.get(path, params={'source_version': latest['source_version']})).json()['data']
        local, changed, global_note = inherited['preparation']['notes']
        assert local['scope'] == {'start': 4, 'end': 9} and local['choice'] == 'adopt'
        assert changed['choice'] == global_note['choice'] == 'review'
        assert changed['previous_scope_text'] == '乙到教室。'
        for scene, expected in zip(scenes, (['car', 'all'], ['room', 'all'])):
            canvas = await client.post(scene + '/canvases', json={'name': '旧原文画布'})
            assert canvas.status_code == 200, canvas.text
            assert [item['id'] for item in canvas.json()['data']['document']['fixed_source']['shooting_notes']] == expected

        async def save_division(request_id, source, spans, *, restore=None):
            current = (await client.get(BASE)).json()['data']['sequences']
            draft = {'source_version': source, 'source_basis_id': restore, 'source_revision_id': restore,
                'baseline': [{'sequence_id': row['id'], 'version': row['version']} for row in current],
                'members': [{'key': row['id'], 'sequence_id': row['id'], 'title': row['title'],
                             'span': {'start': start, 'end': end}, 'reconfirm_source': True}
                            for row, (start, end) in zip(current, spans)],
                'lineage': [{'sequence_id': row['id'], 'target_keys': [row['id']]} for row in current],
                'exited_sequence_ids': []}
            preview = await client.post(BASE + '/division/preview', json=draft)
            assert preview.status_code == 200, preview.text
            saved = await client.put(BASE + '/division', json={'request_id': request_id, 'draft': draft,
                'preview_token': preview.json()['data']['preview_token'], 'identity_changes_confirmed': True})
            assert saved.status_code == 200, saved.text
            return saved.json()['data']['chapter']

        old_head = latest['current_version']['id']
        await save_division('use-new', latest['source_version'], ((4, 9), (9, 14)))
        inherited_saved = (await client.get(path, params={'source_version': latest['source_version']})).json()['data']
        assert inherited_saved['preparation'] == inherited['preparation']
        body['request_id'] = 'old-revised'
        body['expected_version'] = 1
        body['preparation']['notes'][0]['text'] = '后补说明，甲保持车旁站位'
        update = await client.put(path, json=body)
        assert update.status_code == 200, update.text
        restored = await save_division('restore-old', old['source_version'], ((0, 5), (5, 10)), restore=old_head)
        assert restored['raw_text'] == raw
        basis = (await client.get(scenes[0] + '/storyboards/basis')).json()['data']
        assert basis['shooting_notes'][0]['text'] == '后补说明，甲保持车旁站位'
