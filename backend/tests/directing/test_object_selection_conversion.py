"""维护转换后通过公开接口观察资源级选用，不支持旧字段读取。"""
import pytest

from app.models.directing import Sequence
from app.models.studio import Character, CharacterImage, FileUsage
from tests.directing.test_store import database
from tests.directing.test_api import client_for


@pytest.mark.asyncio
async def test_convert_member_selection_preserves_story_and_current_main(tmp_path):
    from app.services.studio.object_selection_conversion import preflight, apply_plan
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Character(id='person', project_id='p1', name='青年男子', style='真人都市'))
            await db.flush()
            db.add(CharacterImage(character_id='person', file_id='image1', is_primary=True, is_view_default=True))
            db.add(Sequence(id='scene', chapter_id='ch1', position=0, title='相遇', source={'version': 'v1'},
                object_preparation={'revision': 1, 'source_digest': 'old', 'objects': [{'id': 'zhang', 'kind': 'character', 'name': '张三',
                    'description': '青年', 'excerpt': '兄弟', 'span': {'start': 0, 'end': 2}, 'asset_id': 'person',
                    'image_file_id': 'image1', 'reference_source': {'kind': 'character', 'asset_id': 'person'}}]}))
            db.add(FileUsage(project_id='p1', chapter_id='ch1', file_id='image1', usage_kind='directing_reference', source_ref='scene-object:scene:zhang'))
            db.add(FileUsage(project_id='p1', chapter_id='ch1', file_id='image1', usage_kind='canvas_history', source_ref='keep'))
        async with sessions() as db:
            plan = await preflight(db)
        assert len(plan['sequences']) == 1
        assert plan['sequences'][0]['objects'][0]['action'] == 'convert'
        assert len(plan['release_usages']) == 1
        assert len(plan['retained_usages']) == 1
        import hashlib
        import json
        from types import SimpleNamespace
        from app.scripts.convert_object_selections import run
        plan_path, backup, output = [tmp_path / name for name in ('plan.json', 'backup.json', 'result.json')]
        args = SimpleNamespace(database_url=str(sessions.kw['bind'].url), output=str(plan_path),
            apply=False, plan=None, expected_sha256=None, backup=None)
        await run(args)
        assert json.loads(plan_path.read_text()) == plan
        args.apply, args.plan, args.backup, args.output = True, str(plan_path), str(backup), str(output)
        args.expected_sha256 = hashlib.sha256(plan_path.read_bytes()).hexdigest()
        await run(args)
        assert json.loads(output.read_text())['released_usages'] == 1
        assert backup.stat().st_mode & 0o777 == 0o600
        assert json.loads(backup.read_text())['released_usages'][0]['usage_kind'] == 'directing_reference'
        endpoint = '/api/v1/studio/projects/p1/directing/chapters/ch1/sequences/scene/objects'
        response = await client.get(endpoint)
        assert response.status_code == 200, response.text
        obj = response.json()['data']['objects'][0]
        assert (obj['name'], obj['description'], obj['asset_id'], obj['image_file_id']) == ('张三', '青年', 'person', 'image1')
        # 同一个公开画布入口读取转换后的动态对象；不重写已有固定图片。
        canvas = (await client.post('/api/v1/studio/generation-canvases/p1', json={'name': '转换后'})).json()['data']
        document = canvas['document']
        document['cards'] = [{'id': 'ref', 'type': 'reference.character', 'name': '张三',
            'scene_object_source': {'sequence_id': 'scene', 'object_id': 'zhang'}}]
        url = '/api/v1/studio/generation-canvases/p1/' + canvas['id']
        saved = await client.put(url, json={'request_id': 'converted', 'expected_revision': 0, 'document': document})
        assert saved.status_code == 200, saved.text
        outputs = await client.get(url + '/cards/ref/outputs')
        assert outputs.status_code == 200, outputs.text
        assert outputs.json()['data']['outputs'][0]['file_id'] == 'image1'
        async with sessions.begin() as db:
            replay = await apply_plan(db, plan)
            assert replay['already_applied']


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['upload', 'missing_resource', 'unverified_upload'])
async def test_conversion_upload_or_conflict_is_visible_through_api(tmp_path, mode):
    from app.services.studio.object_selection_conversion import preflight, apply_plan
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Character(id='person', project_id='p1', name='青年男子', style='真人都市'))
            await db.flush()
            db.add(Sequence(id='scene', chapter_id='ch1', position=0, title='相遇', source={'version': 'v1'},
                object_preparation={'revision': 1, 'source_digest': 'old', 'objects': [{'id': 'zhang', 'kind': 'character',
                    'name': '张三', 'description': '青年', 'excerpt': '兄弟', 'span': {'start': 0, 'end': 2},
                    'asset_id': 'missing' if mode == 'missing_resource' else 'person', 'image_file_id': 'image1'}]}))
            if mode == 'upload':
                db.add(FileUsage(project_id='p1', chapter_id='ch1', file_id='image1', usage_kind='generation_upload', source_ref='scene-object:scene:zhang'))
        async with sessions() as db:
            plan = await preflight(db)
        assert plan['sequences'][0]['objects'][0]['action'] == ('add_member' if mode == 'upload' else 'clear_conflict')
        async with sessions.begin() as db:
            await apply_plan(db, plan)
        endpoint = '/api/v1/studio/projects/p1/directing/chapters/ch1/sequences/scene/objects'
        response = await client.get(endpoint)
        assert response.status_code == 200, response.text
        obj = response.json()['data']['objects'][0]
        assert obj['name'] == '张三'
        assert obj['asset_id'] == ('person' if mode == 'upload' else None)
        if mode == 'upload':
            # 保留既有默认选择；新增成员不会被静默设成主图。
            assert obj['reference_state'] == 'missing'
            assert response.json()['data']['assets'][0]['id'] == 'person'


@pytest.mark.asyncio
async def test_conversion_refuses_changed_preparation_and_retains_it(tmp_path):
    from app.services.studio.object_selection_conversion import preflight, apply_plan
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add(Sequence(id='scene', chapter_id='ch1', position=0, title='相遇', source={'version': 'v1'},
                object_preparation={'revision': 1, 'source_digest': 'old', 'objects': [{'id': 'zhang', 'kind': 'character',
                    'name': '张三', 'description': '', 'excerpt': '兄弟', 'span': {'start': 0, 'end': 2}, 'image_file_id': None}]}))
        async with sessions() as db:
            plan = await preflight(db)
        async with sessions.begin() as db:
            row = await db.get(Sequence, 'scene')
            row.object_preparation = {**row.object_preparation, 'revision': 2}
        async with sessions.begin() as db:
            with pytest.raises(ValueError, match='重新预检'):
                await apply_plan(db, plan)
