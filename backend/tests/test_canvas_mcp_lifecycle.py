"""Exercise canvas lifecycle through the MCP client and Streamable HTTP."""
from contextlib import asynccontextmanager
from hashlib import sha256
from uuid import uuid4

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import dependencies
from app.core.db import Base
from app.main import app
from app.models.llm import Model, Provider
from app.models.studio import Project


@asynccontextmanager
async def mcp_lifecycle_client(tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/canvas.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(dependencies, 'async_session_maker', sessions)
    connection_path = '/api/v1/canvas-mcp/connection'
    origin = {'Origin': 'http://localhost:7788'}
    async with engine.begin() as db:
        await db.run_sync(Base.metadata.create_all)
    async with sessions.begin() as db:
        db.add(Project(id='p', name='项目', style='真人都市'))
        db.add(Provider(id='provider', provider_key='openai', name='test',
                        api_key='test', base_url='https://unused.test/v1'))
        await db.flush()
        db.add(Model(id='text-model', provider_id='provider', name='test-model', category='text', params={}))
    try:
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            response = await http.post(connection_path, headers=origin)
            assert response.is_success, response.text
            credential = response.json()['data']['credential']
            http.headers['Authorization'] = f'Bearer {credential}'
            try:
                async with streamable_http_client(
                    'http://test/mcp', http_client=http,
                ) as (reader, writer, _), ClientSession(reader, writer) as client:
                    await client.initialize()
                    yield client, http
            finally:
                await http.delete(connection_path, headers=origin)
    finally:
        await engine.dispose()


async def scene_scope(http):
    raw = '门打开了。'
    studio = '/api/v1/studio'
    chapter = await http.post(f'{studio}/chapters', json={
        'id': 'chapter', 'project_id': 'p', 'index': 0, 'title': '章', 'raw_text': raw,
    })
    assert chapter.is_success, chapter.text
    scene = await http.post(f'{studio}/projects/p/directing/chapters/chapter/sequences', json={
        'title': '开门', 'position': 0, 'source_version': sha256(raw.encode()).hexdigest(),
        'span': {'start': 0, 'end': len(raw)},
    })
    assert scene.is_success, scene.text
    return {'project_id': 'p', 'chapter_id': 'chapter', 'sequence_id': scene.json()['data']['id']}


async def call(client, name, **arguments):
    result = await client.call_tool(name, arguments)
    assert not result.isError, result
    assert result.structuredContent is not None, result
    return result.structuredContent


async def assert_error(client, name, code, **arguments):
    result = await client.call_tool(name, arguments)
    assert result.isError
    assert code in result.content[0].text


@pytest.mark.asyncio
async def test_mcp_creates_both_canvas_kinds_and_renames_free_canvas(tmp_path, monkeypatch):
    async with mcp_lifecycle_client(tmp_path, monkeypatch) as (client, http):
        scope = await scene_scope(http)
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_create_free', 'canvas_create_scene', 'canvas_rename_free'} <= names

        free = await call(client, 'canvas_create_free', command={'name': '自由画布'})
        scene = await call(client, 'canvas_create_scene', **scope, command={'name': '分镜画布'})
        assert (await call(client, 'canvas_read', canvas_ref=free['canvas_ref']))['document']['name'] == '自由画布'
        assert (await call(client, 'canvas_read', canvas_ref=scene['canvas_ref']))['document']['name'] == '分镜画布'
        renamed = await call(client, 'canvas_rename_free', canvas_ref=free['canvas_ref'],
                             command={'name': '改名后的自由画布', 'expected_revision': 0})
        assert renamed['revision'] == 1
        listing = await call(client, 'canvas_list_free', q='改名后')
        assert [item['id'] for item in listing['items']] == [free['id']]
        rejected = await client.call_tool('canvas_rename_free', {
            'canvas_ref': scene['canvas_ref'], 'command': {'name': '不可改名', 'expected_revision': 0},
        })
        assert rejected.isError


@pytest.mark.asyncio
async def test_mcp_saves_and_deletes_both_canvas_kinds_at_expected_revision(tmp_path, monkeypatch):
    async with mcp_lifecycle_client(tmp_path, monkeypatch) as (client, http):
        scope = await scene_scope(http)
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_save', 'canvas_delete'} <= names

        free = await call(client, 'canvas_create_free', command={})
        scene = await call(client, 'canvas_create_scene', **scope, command={})
        for canvas in (free, scene):
            ref = canvas['canvas_ref']
            document = {**canvas['document'], 'name': '新修订'}
            saved = await call(client, 'canvas_save', canvas_ref=ref, command={
                'request_id': 'new-revision', 'expected_revision': 0, 'document': document,
            })
            assert saved['revision'] == 1
            await assert_error(client, 'canvas_save', 'REVISION_CONFLICT', canvas_ref=ref, command={
                'request_id': 'stale-revision', 'expected_revision': 0,
                'document': {**document, 'name': '旧客户端名称'},
            })
            await assert_error(client, 'canvas_delete', 'DELETE_REVISION_CHANGED',
                               canvas_ref=ref, expected_revision=0)
            reread = await call(client, 'canvas_read', canvas_ref=ref)
            assert reread['document']['name'] == '新修订'
            await call(client, 'canvas_delete', canvas_ref=ref, expected_revision=1)
            await assert_error(client, 'canvas_read', '"status": 404', canvas_ref=ref)


@pytest.mark.asyncio
async def test_mcp_delete_respects_active_run(tmp_path, monkeypatch):
    async with mcp_lifecycle_client(tmp_path, monkeypatch) as (client, http):
        canvas = await call(client, 'canvas_create_free', command={})
        document = canvas['document']
        document['cards'] = [{
            'id': 'model', 'type': 'model.text', 'model_id': 'text-model',
            'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': '准备运行'}]},
        }]
        ref = canvas['canvas_ref']
        await call(client, 'canvas_save', canvas_ref=ref, command={
            'request_id': 'save', 'expected_revision': 0, 'document': document,
        })
        canvas_path = f"/api/v1/studio/generation-canvases/{canvas['id']}"
        precheck = await http.post(f'{canvas_path}/precheck', json={'card_id': 'model'})
        assert precheck.is_success, precheck.text
        run = await http.post(f'{canvas_path}/runs', json={
            'request_id': 'run', 'preview_token': precheck.json()['data']['preview_token'],
        })
        assert run.is_success, run.text

        await assert_error(client, 'canvas_delete', 'RUN_SCOPE_BUSY', canvas_ref=ref, expected_revision=1)
        assert (await call(client, 'canvas_read', canvas_ref=ref))['revision'] == 1


@pytest.mark.asyncio
async def test_mcp_draft_preview_is_read_only_and_first_save_is_replayable(tmp_path, monkeypatch):
    async with mcp_lifecycle_client(tmp_path, monkeypatch) as (client, _):
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_draft_read', 'canvas_draft_preview', 'canvas_draft_save'} <= names
        canvas_id = str(uuid4())
        draft = await call(client, 'canvas_draft_read', canvas_id=canvas_id)
        assert draft['revision'] == -1
        card = {'id': 'first-card', 'type': 'content.text', 'text': '自由草稿内容'}
        preview = await call(client, 'canvas_draft_preview', document=draft['document'],
                             groups=[{'id': 'first-edit', 'cards': [card]}])
        assert preview['groups'][0]['differences'][0]['path'] == ['cards', 'first-card']
        await assert_error(client, 'canvas_read', '"status": 404', canvas_ref=draft['canvas_ref'])
        command = {
            'request_id': 'draft-first-save',
            'expected_revision': 0,
            'document': {**draft['document'], 'cards': [card]},
        }
        await assert_error(client, 'canvas_draft_save', 'assistant', canvas_id=canvas_id,
                           command={**command, 'assistant': {}})
        saved = await call(client, 'canvas_draft_save', canvas_id=canvas_id, command=command)
        assert saved['revision'] == 1
        assert await call(client, 'canvas_draft_save', canvas_id=canvas_id, command=command) == saved
        assert (await call(client, 'canvas_list_free'))['pagination']['total'] == 1
        read = await call(client, 'canvas_read', canvas_ref=draft['canvas_ref'])
        assert read['document']['cards'][0]['text'] == '自由草稿内容'
