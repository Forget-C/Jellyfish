"""对象选用的公开接口验证共享资产关联与人物身份。"""
import pytest

from app.models.directing import Sequence
from app.models.studio import Prop
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
async def test_select_library_prop_links_project_and_unbinding_keeps_resource(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Prop(id='sword', name='长剑', style='真人都市'))
        endpoint = await prepared_scene(client, sessions)
        assets_url = '/api/v1/studio/projects/p1/directing/assets'
        assert (await client.get(assets_url)).json()['data'] == []
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'sword'})
        assert chosen.status_code == 200, chosen.text
        assert chosen.json()['data']['objects'][0]['asset_id'] == 'sword'
        assert [asset['id'] for asset in (await client.get(assets_url)).json()['data']] == ['sword']
        cleared = await client.put(endpoint + '/object1', json={'expected_revision': 2})
        assert cleared.status_code == 200, cleared.text
        assert [asset['id'] for asset in (await client.get(assets_url)).json()['data']] == ['sword']
        invalid = await client.put(endpoint + '/object1', json={'expected_revision': 3, 'asset_id': 'missing'})
        assert invalid.status_code == 400


@pytest.mark.asyncio
async def test_actor_selection_creates_stable_project_role_and_uses_existing_front_image(tmp_path):
    from app.models.studio import Actor, ActorImage, FileItem
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Actor(id='actor', name='青年演员', style='真人都市'))
            db.add(FileItem(id='side', name='侧面', type='image', storage_key='side.png'))
            await db.flush()
            db.add_all([ActorImage(actor_id='actor', file_id='image1', view_angle='FRONT'),
                        ActorImage(actor_id='actor', file_id='side', view_angle='LEFT')])
        endpoint = await prepared_scene(client, sessions, 'character')
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'actor_id': 'actor', 'auto_select_image': True})
        assert chosen.status_code == 200, chosen.text
        data = chosen.json()['data']
        role = data['objects'][0]
        assert role['asset_id'] != 'actor' and role['image_file_id'] == 'image1'
        assert role['reference_state'] == 'ready'
        asset = next(item for item in data['assets'] if item['id'] == role['asset_id'])
        assert asset['actor_id'] == 'actor'
        assert {(image['file_id'], image['view_angle']) for image in asset['reference_images']} == {('image1', 'FRONT'), ('side', 'LEFT')}
        side = await client.put(endpoint + '/object1', json={'expected_revision': 2, 'asset_id': role['asset_id'], 'image_file_id': 'side'})
        assert side.status_code == 200, side.text
        assert (await client.get(endpoint)).json()['data']['objects'][0]['image_file_id'] == 'side'
        again = await client.put(endpoint + '/object1', json={'expected_revision': 3, 'actor_id': 'actor', 'auto_select_image': True})
        assert again.status_code == 200, again.text
        assert again.json()['data']['objects'][0]['asset_id'] == role['asset_id']
        assert len([item for item in again.json()['data']['assets'] if item['kind'] == 'character']) == 1
        cleared = await client.put(endpoint + '/object1', json={'expected_revision': 4, 'asset_id': role['asset_id']})
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()['data']['objects'][0]['reference_source'] == {'kind': 'actor', 'asset_id': 'actor'}
        invalid = await client.put(endpoint + '/object1', json={'expected_revision': 5, 'asset_id': role['asset_id'], 'image_file_id': 'video1'})
        assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_role_composition_saves_library_assets_and_rejects_stale_or_invalid_changes(tmp_path):
    from app.models.studio import Actor, Costume, Character
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add_all([Actor(id='actor', name='演员', style='真人都市'),
                Costume(id='coat', name='长袍', style='真人都市'), Prop(id='sword', name='剑', style='真人都市'),
                Character(id='role', project_id='p1', name='张三', style='真人都市')])
        url = '/api/v1/studio/projects/p1/directing/characters/role/composition'
        response = await client.get(url)
        assert response.status_code == 200, response.text
        previous = response.json()['data']
        command = {'expected_revision': previous['revision'], 'actor_id': 'actor', 'costume_id': 'coat', 'prop_ids': ['sword']}
        saved = await client.put(url, json=command)
        assert saved.status_code == 200, saved.text
        current = saved.json()['data']
        assert (current['actor_id'], current['costume_id'], current['prop_ids']) == ('actor', 'coat', ['sword'])
        assert (await client.put(url, json=command)).json() == saved.json()
        assert (await client.put(url, json={**command, 'actor_id': None})).status_code == 409
        assert (await client.get(url.replace('/p1/', '/p2/'))).status_code == 404
        invalid = await client.put(url, json={**command, 'expected_revision': current['revision'], 'prop_ids': ['missing']})
        assert invalid.status_code == 400
        assert (await client.get(url)).json()['data'] == current


@pytest.mark.asyncio
async def test_selected_actor_file_survives_slot_replacement_without_changing_choice(tmp_path):
    from app.models.studio import Actor, ActorImage, FileItem
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Actor(id='actor', name='演员', style='真人都市'))
            await db.flush()
            db.add(ActorImage(actor_id='actor', file_id='image1', view_angle='FRONT'))
        endpoint = await prepared_scene(client, sessions, 'character')
        chosen = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'actor_id': 'actor', 'auto_select_image': True})
        assert chosen.status_code == 200, chosen.text
        async with sessions.begin() as db:
            db.add(FileItem(id='replacement', name='新图', type='image', storage_key='new.png'))
            await db.flush()
            from sqlalchemy import select
            slot = await db.scalar(select(ActorImage).where(ActorImage.actor_id == 'actor'))
            slot.file_id = 'replacement'
        current = (await client.get(endpoint)).json()['data']['objects'][0]
        assert current['image_file_id'] == 'image1' and current['reference_state'] == 'ready'


@pytest.mark.asyncio
@pytest.mark.parametrize('angle,expected', [('LEFT', 'image1'), (None, None)])
async def test_actor_without_front_uses_available_angle_or_leaves_reference_empty(tmp_path, angle, expected):
    from app.models.studio import Actor, ActorImage
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Actor(id='actor', name='演员', style='真人都市'))
            await db.flush()
            if angle:
                db.add(ActorImage(actor_id='actor', file_id='image1', view_angle=angle))
        endpoint = await prepared_scene(client, sessions, 'character')
        response = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'actor_id': 'actor', 'auto_select_image': True})
        assert response.status_code == 200, response.text
        assert response.json()['data']['objects'][0]['image_file_id'] == expected


@pytest.mark.asyncio
async def test_invalid_image_rolls_back_library_association_and_rejects_actor_for_prop(tmp_path):
    from app.models.studio import Actor
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add_all([Prop(id='sword', name='长剑', style='真人都市'), Actor(id='actor', name='演员', style='真人都市')])
        endpoint = await prepared_scene(client, sessions)
        response = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'asset_id': 'sword', 'image_file_id': 'video1'})
        assert response.status_code == 422
        assert (await client.get('/api/v1/studio/projects/p1/directing/assets')).json()['data'] == []
        response = await client.put(endpoint + '/object1', json={'expected_revision': 1, 'actor_id': 'actor'})
        assert response.status_code == 422
        assert (await client.get(endpoint)).json()['data']['revision'] == 1


@pytest.mark.asyncio
async def test_concurrent_role_composition_writes_cannot_overwrite_the_same_revision(tmp_path):
    import asyncio
    from app.models.studio import Actor, Character
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add_all([Actor(id='one', name='演员一', style='真人都市'), Actor(id='two', name='演员二', style='真人都市'),
                Character(id='role', name='张三', project_id='p1', style='真人都市')])
        url = '/api/v1/studio/projects/p1/directing/characters/role/composition'
        revision = (await client.get(url)).json()['data']['revision']
        responses = await asyncio.gather(*[client.put(url, json={'expected_revision': revision, 'actor_id': actor}) for actor in ['one', 'two']])
        assert sorted(response.status_code for response in responses) == [200, 409]
        winner = next(response for response in responses if response.status_code == 200).json()['data']
        assert (await client.get(url)).json()['data'] == winner
