"""对象选用的公开接口验证项目独立对象与人物身份。"""
import pytest

from app.models.directing import Sequence
from tests.directing.test_api import client_for
from tests.directing.test_store import database


async def prepared_scene(client, sessions, kind='prop'):
    base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
    chapter = (await client.get(base)).json()['data']
    response = await client.post(base + '/sequences', json={'title': '对象选用', 'position': 0,
        'source_version': chapter['source_version'], 'span': {'start': 0, 'end': 4}})
    assert response.status_code == 200, response.text
    scene_id = response.json()['data']['id']
    async with sessions.begin() as db:
        scene = await db.get(Sequence, scene_id)
        scene.object_preparation = {'revision': 1, 'source_version': chapter['source_version'], 'source_digest': '',
            'objects': [{'id': 'object1', 'kind': kind, 'name': '张三' if kind == 'character' else '长剑',
                'description': '', 'excerpt': '兄弟', 'span': {'start': 0, 'end': 2}}]}
    return base + '/sequences/' + scene_id + '/objects'


@pytest.mark.asyncio
async def test_extraction_does_not_create_resources_and_only_project_objects_can_be_reused(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        endpoint = await prepared_scene(client, sessions)
        resources = '/api/v1/studio/projects/p1/directing/assets'
        assert (await client.get(resources)).json()['data'] == []
        created = await client.post('/api/v1/studio/entities/prop', json={
            'id': 'sword', 'name': '长剑', 'supplementary_info': '原始稳定设定'})
        assert created.status_code == 201, created.text
        unlinked = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'sword'})
        assert unlinked.status_code == 422
        linked = await client.post('/api/v1/studio/project-assets/prop', json={'project_id': 'p1', 'asset_id': 'sword'})
        assert linked.status_code == 400
        assert (await client.get(resources)).json()['data'] == []
        private = await client.post('/api/v1/studio/entities/prop', json={
            'id': 'project-sword', 'name': '长剑', 'project_id': 'p1', 'supplementary_info': '项目独立设定'})
        assert private.status_code == 201
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'project-sword'})
        assert chosen.status_code == 200, chosen.text
        assert chosen.json()['data']['objects'][0]['asset_id'] == 'project-sword'
        cleared = await client.put(endpoint + '/object1', json={'expected_revision': 2})
        assert cleared.status_code == 200
        assert [asset['id'] for asset in (await client.get(resources)).json()['data']] == ['project-sword']
        unchanged = await client.get('/api/v1/studio/entities/prop/sword')
        assert unchanged.json()['data']['supplementary_info'] == '原始稳定设定'


@pytest.mark.asyncio
async def test_character_is_explicitly_created_and_reference_main_is_independent(tmp_path, monkeypatch):
    from app.core import storage
    async def download(**kwargs):
        return b'independent actor bytes'
    async def upload(**kwargs):
        return None
    monkeypatch.setattr(storage, 'download_file', download)
    monkeypatch.setattr(storage, 'upload_file', upload)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        endpoint = await prepared_scene(client, sessions, 'character')
        assert (await client.get('/api/v1/studio/projects/p1/directing/assets')).json()['data'] == []
        actor = await client.post('/api/v1/studio/entities/actor', json={'id': 'actor', 'name': '青年演员'})
        assert actor.status_code == 201
        picture = await client.post('/api/v1/studio/entities/actor/actor/images', json={'file_id': 'image1', 'view_angle': 'LEFT'})
        assert picture.status_code == 201
        reference = {'file_id': 'image1', 'role': 'identity', 'source_kind': 'actor', 'source_id': 'actor', 'source_image_id': picture.json()['data']['id'], 'view_angle': 'LEFT'}
        role = await client.post('/api/v1/studio/entities/character', json={
            'id': 'role', 'project_id': 'p1', 'name': '张三', 'description': '角色自己的设定',
            'references': [reference], 'adopt_reference': reference})
        assert role.status_code == 201, role.text
        images = (await client.get('/api/v1/studio/entities/character/role/images')).json()['data']['items']
        main = next(image for image in images if image['is_primary'])
        assert main['file_id'] != 'image1' and main['view_angle'] == 'LEFT'
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'role'})
        assert chosen.status_code == 200, chosen.text
        current = chosen.json()['data']['objects'][0]
        assert current['asset_id'] == 'role' and current['image_file_id'] == main['file_id']
        assert 'reference_source' not in current
        assert current['reference_state'] == 'ready'
        actor_image_id = picture.json()['data']['id']
        await client.patch(f'/api/v1/studio/entities/actor/actor/images/{actor_image_id}', json={'file_id': None})
        retained = (await client.get(endpoint)).json()['data']['objects'][0]
        assert retained['image_file_id'] == main['file_id'] and retained['reference_state'] == 'ready'


@pytest.mark.asyncio
async def test_scene_reference_tracks_current_main_at_any_angle(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        endpoint = await prepared_scene(client, sessions)
        created = await client.post('/api/v1/studio/entities/prop', json={'id': 'sword', 'project_id': 'p1', 'name': '长剑'})
        assert created.status_code == 201
        picture = await client.post('/api/v1/studio/entities/prop/sword/images', json={'file_id': 'image1', 'view_angle': 'TOP'})
        assert picture.status_code == 201
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'sword'})
        assert chosen.status_code == 200, chosen.text
        assert chosen.json()['data']['objects'][0]['image_file_id'] == 'image1'
        from app.models.studio import FileItem
        async with sessions.begin() as db:
            db.add(FileItem(id='replacement-main', type='image', name='新主图', storage_key='replacement.png'))
        other = await client.post('/api/v1/studio/entities/prop/sword/images', json={'file_id': 'replacement-main', 'view_angle': 'BACK', 'is_primary': True})
        assert other.status_code == 201
        assert (await client.get(endpoint)).json()['data']['objects'][0]['image_file_id'] == 'replacement-main'
        stale = await client.put(endpoint + '/object1', json={'expected_revision': 1})
        assert stale.status_code == 409


@pytest.mark.asyncio
async def test_uncreated_candidate_cannot_use_upload_or_legacy_actor_selection(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        endpoint = await prepared_scene(client, sessions, 'character')
        uploaded = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'image_file_id': 'image1'})
        assert uploaded.status_code == 422
        legacy = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'actor_id': 'actor'})
        assert legacy.status_code == 422
        assert (await client.get('/api/v1/studio/projects/p1/directing/assets')).json()['data'] == []


@pytest.mark.asyncio
async def test_old_actor_composition_endpoint_is_removed(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        created = await client.post('/api/v1/studio/entities/character', json={'id': 'role', 'project_id': 'p1', 'name': '张三'})
        assert created.status_code == 201
        assert (await client.get('/api/v1/studio/projects/p1/directing/characters/role/composition')).status_code == 404
