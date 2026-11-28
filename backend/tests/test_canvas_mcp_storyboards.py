"""Exercise the scene storyboard workflow through MCP Streamable HTTP."""

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import dependencies
from app.models.llm import Model, Provider
from app.task_worker import TaskWorker
from tests.directing.storyboard_prompt_fixture import video_prompt_response
from tests.directing.test_store import database
from tests.test_canvas_mcp import AUTHORIZATION, create_mcp_app


_EXCERPT = '兄弟在店中交谈'
_COMMAND = {'text_model_id': 'story-text', 'mode': 'faithful'}


class _Model:
    def __init__(self, **_kwargs):
        pass

    def invoke(self, messages):
        if response := video_prompt_response(messages):
            return response
        args = json.loads(messages[1].content)
        if 'storyboard_draft' in args:
            return SimpleNamespace(content='{"issues": []}')
        result = {'shots': [{'id': 'talk', 'excerpt': _EXCERPT}]}
        return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))


async def _data(response):
    assert response.is_success, response.text
    return response.json()['data']


@asynccontextmanager
async def _workspace(tmp_path, monkeypatch):
    monkeypatch.setattr('app.task_worker.build_langchain_chat', _Model)
    app = create_mcp_app()
    async with database(tmp_path) as sessions:
        monkeypatch.setattr(dependencies, 'async_session_maker', sessions)
        async with sessions.begin() as db:
            db.add(Provider(id='story-provider', provider_key='openai', name='openai',
                            base_url='https://story.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='story-text', name='text', category='text', provider_id='story-provider'))

        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            chapter = '/api/v1/studio/projects/p1/directing/chapters/ch1'
            source = await _data(await http.get(chapter))
            scene = await _data(await http.post(chapter + '/sequences', json={
                'title': '店内', 'position': 0, 'source_version': source['source_version'],
                'span': {'start': 0, 'end': len(_EXCERPT)},
            }))
            http.headers.update(AUTHORIZATION)
            worker = TaskWorker(sessions)
            try:
                async with streamable_http_client(
                    'http://test/mcp', http_client=http,
                ) as (reader, writer, _), ClientSession(reader, writer) as client:
                    await client.initialize()
                    yield client, http, worker, {'project_id': 'p1', 'chapter_id': 'ch1', 'sequence_id': scene['id']}
            finally:
                await asyncio.gather(*worker.jobs.values())
                worker.text_pool.shutdown(wait=False)


async def _call(client, name, arguments):
    result = await client.call_tool(name, arguments)
    assert not result.isError, result
    return result.structuredContent


async def _advance(worker):
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())


@pytest.mark.asyncio
async def test_extract_storyboard_and_read_scene_history(tmp_path, monkeypatch):
    async with _workspace(tmp_path, monkeypatch) as (client, _, worker, scene):
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {'scene_storyboard_basis', 'scene_storyboard_submit', 'scene_storyboard_list',
                'scene_storyboard_read'} <= tools
        basis = await _call(client, 'scene_storyboard_basis', scene)
        assert basis['source_text'] == _EXCERPT
        wrong_scene = await client.call_tool('scene_storyboard_basis', {**scene, 'project_id': 'p2'})
        assert wrong_scene.isError and '"status": 404' in wrong_scene.content[0].text
        submitted = await _call(client, 'scene_storyboard_submit', {
            **scene, 'body': {**_COMMAND, 'request_id': 'new-canvas', 'basis_token': basis['token']},
        })
        assert submitted['status'] == 'queued'
        canvas_scope = {'canvas_ref': submitted['canvas_ref']}
        assert (await _call(client, 'canvas_read', canvas_scope))['revision'] == 0
        await _advance(worker)

        task = await _call(client, 'scene_storyboard_read', {**scene, 'task_id': submitted['task_id']})
        assert task['status'] == 'succeeded' and task['candidate_available']
        assert [card['visible_result']['text'] for card in task['candidate']['document']['cards']
                if card['type'] == 'direction.shot'] == [_EXCERPT]
        history = await _call(client, 'scene_storyboard_list', {**scene, 'canvas_id': submitted['canvas_id']})
        assert [(row['task_id'], row['status']) for row in history['result']] == [(submitted['task_id'], 'succeeded')]


@pytest.mark.asyncio
async def test_reextract_retry_adopt_restore_and_check_saved_storyboard(tmp_path, monkeypatch):
    async with _workspace(tmp_path, monkeypatch) as (client, http, worker, scene):
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {
            'scene_storyboard_reextract', 'scene_storyboard_retry_basis', 'scene_storyboard_retry',
            'scene_storyboard_candidate', 'scene_storyboard_preview_application', 'scene_storyboard_apply',
            'scene_storyboard_restore', 'scene_storyboard_check_read', 'scene_storyboard_check_submit',
        } <= tools
        submitted = await _call(client, 'scene_storyboard_submit', {
            **scene, 'body': {**_COMMAND, 'request_id': 'original'},
        })
        await _advance(worker)

        ref = {'canvas_ref': submitted['canvas_ref']}
        target = {**ref, 'chapter_id': scene['chapter_id'], 'sequence_id': scene['sequence_id']}
        queued = await _call(client, 'scene_storyboard_reextract', {
            **target, 'body': {**_COMMAND, 'request_id': 'reextract'},
        })
        retry_target = {**scene, 'task_id': queued['task_id']}
        rejected = await client.call_tool('scene_storyboard_retry_basis', retry_target)
        assert rejected.isError and '"status": 409' in rejected.content[0].text
        await _data(await http.post(f"/api/v1/film/tasks/{queued['task_id']}/cancel", json={}))
        basis = await _call(client, 'scene_storyboard_retry_basis', retry_target)
        assert basis['canvas_id'] == submitted['canvas_id'] and basis['basis']['source_text'] == _EXCERPT
        retried = await _call(client, 'scene_storyboard_retry', {
            **retry_target, 'body': {'request_id': 'retry', 'basis_token': basis['basis']['token']},
        })
        assert retried['task_id'] != queued['task_id'] and retried['canvas_id'] == queued['canvas_id']
        await _advance(worker)

        history = (await _call(client, 'scene_storyboard_list', scene))['result']
        assert [(task['task_id'], task['status']) for task in history] == [
            (retried['task_id'], 'succeeded'), (queued['task_id'], 'cancelled'), (submitted['task_id'], 'succeeded'),
        ]
        candidate = (await _call(client, 'scene_storyboard_candidate', target))['result']
        assert candidate['task_id'] == retried['task_id'] and candidate['pending_application']

        before = await _call(client, 'canvas_read', ref)
        candidate_scope = {**scene, 'task_id': candidate['task_id']}
        application = {**candidate_scope, 'body': {'expected_revision': before['revision']}}
        preview = await _call(client, 'scene_storyboard_preview_application', application)
        assert 'direction.shot' in {card['type'] for card in preview['added']}
        assert await _call(client, 'canvas_read', ref) == before
        applied = await _call(client, 'scene_storyboard_apply', application)
        assert applied['document']['storyboard']['task_id'] == candidate['task_id']
        assert await _call(client, 'canvas_read', ref) == applied

        undone = await _call(client, 'scene_storyboard_restore', {**candidate_scope, 'body': {
            'request_id': 'undo', 'expected_revision': applied['revision'], 'direction': 'undo',
            'document': before['document'],
        }})
        assert (await _call(client, 'canvas_read', ref))['document'] == before['document']
        redone = await _call(client, 'scene_storyboard_restore', {**candidate_scope, 'body': {
            'request_id': 'redo', 'expected_revision': undone['revision'], 'direction': 'redo',
            'document': applied['document'],
        }})
        assert (await _call(client, 'canvas_read', ref))['document'] == applied['document']

        assert (await _call(client, 'scene_storyboard_check_read', target))['result'] is None
        check = await _call(client, 'scene_storyboard_check_submit', {**target, 'body': {
            'request_id': 'saved-check', 'expected_revision': redone['revision'],
        }})
        assert check['status'] == 'queued'
        await _advance(worker)
        checked = (await _call(client, 'scene_storyboard_check_read', target))['result']
        assert checked['task_id'] == check['task_id'] and checked['saved_check']
        assert checked['status'] == 'succeeded' and checked['review_state'] == 'passed'
        assert await _call(client, 'canvas_read', ref) == redone
