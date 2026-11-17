"""共同删除接口的项目边界、修订与分镜任务并发保护。"""
from tests.canvas_urls import canvas_params, append_canvas_path, canvas_url, seed_scene_canvas, canvas_params

import asyncio

import pytest

from app.bootstrap import bootstrap_all_registries
from app.models.llm import Model, Provider
from app.services.task_service import TaskService
from tests.directing.test_api import client_for
from tests.directing.test_store import database

STUDIO = '/api/v1/studio'
CHAPTER = append_canvas_path(STUDIO, f'/projects/p1/directing/chapters/ch1')


async def scene_path(client, sessions):
    """准备可走真实分镜受理接口的场次和隔离模型。"""
    bootstrap_all_registries()
    async with sessions.begin() as db:
        db.add(Provider(id='delete-provider', name='openai', base_url='https://fixture.test/v1', api_key='fixture'))
        await db.flush()
        db.add(Model(id='delete-model', name='fixture-text', category='text', provider_id='delete-provider', params={}))
    chapter = (await client.get(CHAPTER)).json()['data']
    response = await client.post(CHAPTER + '/sequences', json={'title': '店中交谈', 'position': 0,
        'source_version': chapter['source_version'], 'span': {'start': 0, 'end': 7}})
    assert response.is_success, response.text
    return append_canvas_path(CHAPTER, f"/sequences/{response.json()['data']['id']}")


@pytest.mark.asyncio
async def test_delete_requires_current_confirmed_revision_and_preserves_other_canvas(tmp_path):
    """缺少修订或确认期间的新保存不能删除文档。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        scope = STUDIO + '/generation-canvases/p1'
        base = canvas_url(scope)
        first = (await seed_scene_canvas(client, scope, json={'name': '准备删除'})).json()['data']
        other = (await seed_scene_canvas(client, scope, json={'name': '保留画布'})).json()['data']
        path = append_canvas_path(base, f"/{first['id']}")
        assert (await client.delete(path)).status_code == 422
        assert (await client.delete(path.replace('project_id=p1', 'project_id=p2'), params={**canvas_params(path.replace('project_id=p1', 'project_id=p2')), **({'expected_revision': 0})})).status_code == 404
        saved = await client.put(path, json={'request_id': 'saved-while-confirming', 'expected_revision': 0,
            'document': {**first['document'], 'name': '确认期间的新保存'}})
        assert saved.is_success, saved.text
        conflict = await client.delete(path, params={**canvas_params(path), **({'expected_revision': 0})})
        assert conflict.status_code == 409 and conflict.json()['data']['code'] == 'DELETE_REVISION_CHANGED'
        assert (await client.get(path)).json()['data']['document']['name'] == '确认期间的新保存'
        assert (await client.delete(path, params={**canvas_params(path), **({'expected_revision': 1})})).is_success
        assert (await client.get(path)).status_code == 404
        assert (await client.get(append_canvas_path(base, '/' + other['id']))).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('running', [False, True])
async def test_active_storyboard_blocks_only_its_actual_canvas(tmp_path, running):
    """排队与运行的分镜都阻止删除，不影响同场其他画布。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        scene = await scene_path(client, sessions)
        admitted = await client.post(scene + '/storyboards', json={'request_id': 'board', 'name': '分镜',
            'text_model_id': 'delete-model', 'mode': 'faithful'})
        assert admitted.is_success, admitted.text
        task = admitted.json()['data']
        if running:
            async with sessions.begin() as db:
                assert await TaskService(db).claim(task['task_id'], worker_id='test-only-worker')
        other = (await client.post(scene + '/canvases', json={'name': '其他画布'})).json()['data']
        scope = STUDIO + '/generation-canvases/p1'
        base = canvas_url(scope)
        blocked = await client.delete(append_canvas_path(base, f"/{task['canvas_id']}"), params={**canvas_params(append_canvas_path(base, f"/{task['canvas_id']}")), **({'expected_revision': 0})})
        assert blocked.status_code == 409 and blocked.json()['data']['code'] == 'STORYBOARD_BUSY'
        assert (await client.get(append_canvas_path(base, f"/{task['canvas_id']}"))).is_success
        assert (await client.delete(append_canvas_path(base, f"/{other['id']}"), params={**canvas_params(append_canvas_path(base, f"/{other['id']}")), **({'expected_revision': 0})})).is_success
        read = await client.get(append_canvas_path(scene, f"/storyboards/{task['task_id']}"))
        assert read.json()['data']['status'] == ('running' if running else 'queued')
        async with sessions.begin() as db:
            await TaskService(db).finish(task['task_id'], error='fixture terminal failure')
        assert (await client.delete(append_canvas_path(base, f"/{task['canvas_id']}"), params={**canvas_params(append_canvas_path(base, f"/{task['canvas_id']}")), **({'expected_revision': 0})})).is_success
        unavailable = await client.get(append_canvas_path(scene, f"/storyboards/{task['task_id']}"))
        assert unavailable.status_code == 404 and '原画布已不可用' in unavailable.text
        retained = await client.get(f"/api/v1/film/tasks/{task['task_id']}/status")
        assert retained.json()['data']['status'] == 'failed'


@pytest.mark.asyncio
@pytest.mark.parametrize('concurrent', ['save', 'storyboard', 'run'])
async def test_delete_and_competing_write_have_one_winner(tmp_path, concurrent):
    """两个真实请求竞争时，不能同时成功删除并保存或受理分镜。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        scene = await scene_path(client, sessions)
        canvas = (await client.post(scene + '/canvases', json={'name': '竞争目标'})).json()['data']
        path = canvas_url(STUDIO + f"/generation-canvases/p1/{canvas['id']}")
        revision = 0
        if concurrent == 'save':
            write = client.put(path, json={'request_id': 'competing-save', 'expected_revision': 0,
                'document': {**canvas['document'], 'name': '竞争保存'}})
        elif concurrent == 'storyboard':
            write = client.post(append_canvas_path(scene, f"/canvases/{canvas['id']}/storyboards"), json={
                'request_id': 'competing-board', 'text_model_id': 'delete-model', 'mode': 'faithful'})
        else:
            document = canvas['document']
            document['cards'].append({'id': 'model', 'type': 'model.text', 'model_id': 'delete-model',
                'prompt': {'segments': [{'kind': 'text', 'id': 'body', 'text': '竞争运行'}]}})
            saved = await client.put(path, json={'request_id': 'seed-run', 'expected_revision': 0, 'document': document})
            assert saved.is_success, saved.text
            revision = saved.json()['data']['revision']
            precheck = await client.post(path + '/precheck', json={'card_id': 'model'})
            preview = precheck.json()['data']
            assert preview['can_run'], preview
            write = client.post(path + '/runs', json={'request_id': 'competing-run', 'preview_token': preview['preview_token']})
        deleted, written = await asyncio.gather(client.delete(path, params={**canvas_params(path), **({'expected_revision': revision})}), write)
        assert deleted.is_success != written.is_success, (deleted.text, written.text)
        if deleted.is_success:
            assert written.status_code == 404, written.text
            assert (await client.get(path)).status_code == 404
        else:
            assert deleted.status_code == 409, deleted.text
            assert (await client.get(path)).is_success
