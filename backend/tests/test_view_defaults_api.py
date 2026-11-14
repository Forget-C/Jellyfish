"""视角默认图通过图片公开接口维护。"""
import pytest
from tests.directing.test_api import client_for
from tests.directing.test_store import database


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['actor', 'character', 'scene', 'prop', 'costume'])
async def test_view_default_is_stable_and_independent_of_primary(tmp_path, kind):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        endpoint = f'/api/v1/studio/entities/{kind}'
        created = await client.post(endpoint, json={'id': 'subject', 'name': '默认图对象', 'project_id': 'p1'})
        assert created.status_code == 201, created.text
        images = endpoint + '/subject/images'
        first = (await client.post(images, json={'view_angle': 'LEFT', 'file_id': 'image1'})).json()['data']
        assert first['is_view_default'] is True
        second = (await client.post(images, json={'view_angle': 'LEFT', 'file_id': 'image1'})).json()['data']
        assert second['is_view_default'] is False
        selected = await client.patch(f"{images}/{second['id']}", json={'is_view_default': True})
        assert selected.status_code == 200, selected.text
        rows = (await client.get(images)).json()['data']['items']
        assert [row['id'] for row in rows if row['is_view_default']] == [second['id']]
        assert next(row for row in rows if row['id'] == first['id'])['is_primary'] is True
        assert (await client.patch(f"{images}/{second['id']}", json={'view_angle': 'BACK'})).status_code == 422
        assert (await client.patch(f"{images}/{second['id']}", json={'is_view_default': False})).status_code == 422
        await client.delete(f"{images}/{second['id']}")
        rows = (await client.get(images)).json()['data']['items']
        assert next(row for row in rows if row['id'] == first['id'])['is_view_default'] is True


@pytest.mark.asyncio
async def test_generation_cannot_overwrite_an_existing_picture(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        from app.api.v1.routes.studio.generation_tasks import router
        client._transport.app.include_router(router, prefix='/api/v1/studio/generation-tasks')
        await client.post('/api/v1/studio/entities/actor', json={'id': 'subject', 'name': '演员'})
        image = (await client.post('/api/v1/studio/entities/actor/subject/images', json={'file_id': 'image1'})).json()['data']
        response = await client.post(f"/api/v1/studio/generation-tasks/actors/subject/slots/{image['id']}/tasks", json={
            'execution_prompt': '新图', 'operation_input': {'kind': 'image_generation', 'count': 1}})
        assert response.status_code == 409, response.text


@pytest.mark.asyncio
async def test_local_edit_render_uses_new_record_in_source_angle(tmp_path, monkeypatch):
    from app.core import storage
    async def file_info(**_kwargs):
        return None
    monkeypatch.setattr(storage, 'get_file_info', file_info)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        from app.api.v1.routes.studio.generation_prompts import router
        client._transport.app.include_router(router, prefix='/api/v1/studio/generation-prompts')
        await client.post('/api/v1/studio/entities/actor', json={'id': 'subject', 'name': '演员', 'supplementary_info': '短发'})
        images = '/api/v1/studio/entities/actor/subject/images'
        original = (await client.post(images, json={'file_id': 'image1', 'view_angle': 'LEFT'})).json()['data']
        target = (await client.post(images, json={'view_angle': 'LEFT'})).json()['data']
        options = {'mode': 'edit', 'edit_instruction': '修改背景', 'references': [{'file_id': 'image1', 'role': 'design'}]}
        response = await client.post(f"/api/v1/studio/generation-prompts/assets/actor/subject/slots/{target['id']}/render", json=options)
        assert response.status_code == 200, response.text
        assert response.json()['data']['recommended_media']['references'][0]['file_id'] == 'image1'
        wrong = (await client.post(images, json={'view_angle': 'BACK'})).json()['data']
        assert (await client.post(f"/api/v1/studio/generation-prompts/assets/actor/subject/slots/{wrong['id']}/render", json=options)).status_code == 422
        rows = (await client.get(images)).json()['data']['items']
        assert next(row for row in rows if row['id'] == original['id'])['file_id'] == 'image1'


@pytest.mark.asyncio
async def test_mysql_concurrent_first_images_have_one_default():
    import asyncio
    from uuid import uuid4
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from tests.services.test_task_mysql import isolated_database_url
    from app.models.studio import FileItem
    engine = create_async_engine(isolated_database_url())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    identity = uuid4().hex
    try:
        async with sessions.begin() as db:
            db.add(FileItem(id=identity, type='image', name='default check', storage_key=f'check/{identity}'))
        async with client_for(sessions) as client:
            base = f'/api/v1/studio/entities/actor/{identity}'
            await client.post('/api/v1/studio/entities/actor', json={'id': identity, 'name': identity})
            responses = await asyncio.gather(*(client.post(base + '/images', json={'view_angle': 'LEFT', 'file_id': identity}) for _ in range(2)))
            assert all(response.status_code == 201 for response in responses)
            rows = (await client.get(base + '/images')).json()['data']['items']
            assert sum(row['is_view_default'] for row in rows) == 1
            await client.delete(base)
    finally:
        async with sessions.begin() as db:
            from sqlalchemy import delete
            await db.execute(delete(FileItem).where(FileItem.id == identity))
        await engine.dispose()


@pytest.mark.asyncio
async def test_new_object_generation_rejects_candidate_mode(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        from app.api.v1.routes.studio.generation_tasks import router
        client._transport.app.include_router(router, prefix='/api/v1/studio/generation-tasks')
        await client.post('/api/v1/studio/entities/actor', json={'id': 'subject', 'name': '演员'})
        image = (await client.post('/api/v1/studio/entities/actor/subject/images', json={})).json()['data']
        response = await client.post(f"/api/v1/studio/generation-tasks/actors/subject/slots/{image['id']}/tasks", json={
            'execution_prompt': '局部修改', 'operation_input': {'kind': 'image_generation', 'save_as_candidate': True}})
        assert response.status_code == 422, response.text
