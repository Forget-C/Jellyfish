"""场次拍摄说明经保存、历史和生成公共接口保留。"""
import pytest

from app.services.directing.division_history import DivisionHistoryService
from app.services.directing.division import DivisionService
from tests.directing.test_division import setup_two, save
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_preparation_saved_with_scene_and_version(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            value = draft.model_dump(mode='json')
            value['members'][0]['shooting_preparation'] = {'notes': [
                {'id': 'route', 'text': '可从车头绕行', 'choice': 'adopt', 'excerpt': ''}]}
            updated = type(draft).model_validate(value)
            saved, _ = await save(service, updated)
            note = saved.chapter.sequences[0].shooting_preparation.notes[0]
            assert note.text == '可从车头绕行'
            history = await DivisionHistoryService(db, 'p1').version_detail('ch1', saved.chapter.current_version.id)
            assert history.chapter.sequences[0].shooting_preparation.notes[0] == note
            assert saved.chapter.current_version.number == 3


@pytest.mark.asyncio
async def test_immediate_save_is_versioned_idempotent_and_preserves_source(tmp_path):
    from app.core.contracts.directing.shooting_preparation import ShootingPreparationSave
    from app.services.directing.shooting_preparation import ShootingPreparationService
    from app.services.directing.store import RevisionConflict
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ShootingPreparationService(db, 'p1')
            await setup_two(service)
            before = await service.list_sequences('ch1')
            row = before.sequences[0]
            body = ShootingPreparationSave(request_id='instant', expected_version=row.version,
                preparation={'notes': [{'id': 'offscreen', 'text': '特写时其余人物仍在场'}]})
            saved = await service.save_preparation('ch1', row.id, body)
            assert saved.current_version.number == 3
            assert saved.sequences[0].source_text == row.source_text
            assert saved.sequences[1] == before.sequences[1]
            assert await service.save_preparation('ch1', row.id, body) == saved
            with pytest.raises(RevisionConflict):
                await service.save_preparation('ch1', row.id, body.model_copy(update={'request_id': 'different'}))


@pytest.mark.asyncio
async def test_draft_shooting_check_freezes_inputs_without_creating_scene(tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from tests.directing.test_api import client_for
    class ControlledModel:
        def __init__(self, **_kwargs):
            pass
        def invoke(self, _messages):
            return SimpleNamespace(content='{"issues": [{"id": "space", "category": "position", "kind": "insufficient_basis", "excerpt": "兄弟", "problem": "人物相对位置待明确", "suggestion": "可由生成安排可行站位"}]}')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            from app.models.studio import Chapter
            (await db.get(Chapter, 'ch1')).raw_text = '兄弟在店中交谈兄弟在店中交谈'
            db.add(Provider(id='prep-provider', name='openai', base_url='https://prep.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='prep-text', name='text', category='text', provider_id='prep-provider'))
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = (await client.get(base)).json()['data']
        response = await client.post(base + '/shooting-checks', json={'source_version': source['source_version'], 'source_start': 0, 'request_id': 'check', 'draft_key': 'new-scene',
            'source_text': '兄弟在店中交谈', 'preparation': {}, 'model_id': 'prep-text'})
        assert response.status_code == 200, response.text
        accepted = response.json()['data']
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
        result = (await client.get(base + '/shooting-checks/' + accepted['task_id'])).json()['data']
        assert result['status'] == 'succeeded', result
        assert result['report']['issues'][0]['category'] == 'position'
        assert result['source_text'] == '兄弟在店中交谈'
        assert result['basis_current'] is True
        latest = (await client.get(base + '/shooting-checks?draft_key=new-scene')).json()['data']
        assert latest['task_id'] == accepted['task_id']
        assert (await client.get(base)).json()['data']['sequences'] == []
        scene = (await client.post(base + '/sequences', json={'title': '店内', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': 7}})).json()['data']
        path = base + '/sequences/' + scene['id'] + '/shooting-preparation'
        stored = (await client.put(path, json={'request_id': 'store-check', 'expected_version': scene['version'],
            'preparation': {'check_task_id': accepted['task_id']}})).json()['data']
        assert stored['sequences'][0]['shooting_preparation']['check_covered'] is True
        other = (await client.post(base + '/sequences', json={'title': '同文另一处', 'position': 1,
            'source_version': source['source_version'], 'span': {'start': 7, 'end': 14}})).json()['data']
        other_saved = (await client.put(base + '/sequences/' + other['id'] + '/shooting-preparation',
            json={'request_id': 'other-position', 'expected_version': other['version'],
                  'preparation': {'check_task_id': accepted['task_id']}})).json()['data']
        assert other_saved['sequences'][1]['shooting_preparation']['check_covered'] is False
        from app.models.studio import Chapter
        async with sessions.begin() as db:
            chapter = await db.get(Chapter, 'ch1')
            chapter.source_explanations = [{'id': 'name', 'kind': 'explanation', 'excerpt': '兄弟',
                'text': '这里指二人', 'source_version': source['source_version'], 'policy_version': 2}]
        changed = (await client.get(base + '/shooting-checks/' + accepted['task_id'])).json()['data']
        assert changed['basis_current'] is False
        assert changed['report'] == result['report']
        stored_after = (await client.put(path, json={'request_id': 'store-new-basis',
            'expected_version': stored['sequences'][0]['version'],
            'preparation': {'check_task_id': accepted['task_id']}})).json()['data']
        assert stored_after['sequences'][0]['shooting_preparation']['check_covered'] is False
        historical = (await client.get(base + '/division/versions/' + stored['current_version']['id'])).json()['data']
        assert historical['chapter']['sequences'][0]['shooting_preparation']['check_covered'] is True


@pytest.mark.asyncio
async def test_old_source_version_can_save_preparation_without_adopting_new_text(tmp_path):
    from app.models.studio import Chapter
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            before = await service.list_sequences('ch1')
            (await db.get(Chapter, 'ch1')).raw_text = '完全不同的新文章'
            value = draft.model_dump(mode='json')
            value['source_basis_id'] = before.current_version.id
            value['members'][0]['shooting_preparation'] = {'notes': [{'id': 'keep', 'text': '人物仍在店内'}]}
            saved, _ = await save(service, type(draft).model_validate(value))
            assert saved.chapter.raw_text == '兄弟在店中交谈'
            assert saved.chapter.sequences[0].source_text == '兄弟在'
            assert saved.chapter.sequences[0].source.version == before.source_version


@pytest.mark.asyncio
async def test_range_change_keeps_notes_pending_review(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            value = draft.model_dump(mode='json')
            value['members'][0]['shooting_preparation'] = {'notes': [{'id': 'keep', 'text': '人物在店内'}]}
            first, _ = await save(service, type(draft).model_validate(value), 'notes')
            from tests.directing.test_division import draft_for
            changed = await draft_for(service)
            changed.members[0].shooting_preparation = first.chapter.sequences[0].shooting_preparation
            changed.members[0].span.end = 4
            changed.members[1].span.start = 4
            saved, _ = await save(service, changed, 'range')
            assert saved.chapter.sequences[0].shooting_preparation.notes[0].choice == 'review'


@pytest.mark.asyncio
async def test_source_reconfirmation_keeps_notes_when_scene_content_is_unchanged(tmp_path):
    from app.models.studio import Chapter
    from tests.directing.test_division import draft_for
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            draft = await setup_two(service)
            value = draft.model_dump(mode='json')
            value['members'][0]['shooting_preparation'] = {'notes': [{'id': 'keep', 'text': '人物仍在店中'}]}
            first, _ = await save(service, type(draft).model_validate(value), 'adopt')
            (await db.get(Chapter, 'ch1')).raw_text += '。外面下雨。'
            updated = await draft_for(service)
            updated.members[0].shooting_preparation = first.chapter.sequences[0].shooting_preparation
            for member in updated.members:
                member.reconfirm_source = True
            saved, _ = await save(service, updated, 'source')
            assert saved.chapter.sequences[0].shooting_preparation.notes[0].choice == 'adopt'
