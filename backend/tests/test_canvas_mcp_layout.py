"""Layout round trips through the real MCP client and application."""

from contextlib import asynccontextmanager
from hashlib import sha256

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import dependencies
from app.core.db import Base
from app.main import app
from app.models.studio import Project


@asynccontextmanager
async def layout_canvas(kind, monkeypatch):
    """Prepare a card using the existing canvas HTTP entry points."""
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(dependencies, 'async_session_maker', sessions)
    try:
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add(Project(id='p', name='项目', style='真人都市'))
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            async def create(path, data):
                response = await http.post('/api/v1/studio' + path, json=data)
                assert response.is_success, response.text
                return response.json()['data']

            canvases = '/generation-canvases'
            scope = {}
            if kind == 'scene':
                raw = '门打开了。'
                await create('/chapters', {
                    'id': 'chapter', 'project_id': 'p', 'index': 0, 'title': '章', 'raw_text': raw,
                })
                sequences = '/projects/p/directing/chapters/chapter/sequences'
                scene = await create(sequences, {
                    'title': '开门', 'position': 0, 'source_version': sha256(raw.encode()).hexdigest(),
                    'span': {'start': 0, 'end': len(raw)},
                })
                canvas = await create(f"{sequences}/{scene['id']}/canvases", {'name': '分镜画布'})
                scope = {'project_id': 'p'}
            else:
                canvas = await create(canvases, {'name': '自由画布'})
            canvas_ref = {'canvas_id': canvas['id'], **scope}
            document = canvas['document']
            document['cards'].append({'id': 'caption', 'type': 'content.text', 'text': '开门'})
            saved = await http.put(
                f"/api/v1/studio{canvases}/{canvas['id']}", params=scope,
                json={'request_id': 'seed-layout', 'expected_revision': 0, 'document': document},
            )
            assert saved.is_success, saved.text
            origin_headers = {'Origin': 'http://localhost:7788'}
            connection_url = '/api/v1/canvas-mcp/connection'
            connection = await http.post(connection_url, headers=origin_headers)
            assert connection.is_success, connection.text
            http.headers['Authorization'] = f"Bearer {connection.json()['data']['credential']}"
            try:
                async with streamable_http_client(
                    'http://test/mcp', http_client=http,
                ) as (reader, writer, _), ClientSession(reader, writer) as client:
                    await client.initialize()
                    yield client, canvas_ref
            finally:
                await http.delete(connection_url, headers=origin_headers)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['free', 'scene'])
async def test_canvas_mcp_layout_preview_and_projection_preserve_host_state(kind, monkeypatch):
    async with layout_canvas(kind, monkeypatch) as (client, canvas_ref):
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_preview_layout', 'canvas_project_layout'} <= tools
        positions = {'caption': {'x': 2, 'y': 4}}
        desired = {'caption': {'x': 30, 'y': 40}}
        preview = await client.call_tool('canvas_preview_layout', {
            'canvas_ref': canvas_ref, 'positions': positions, 'desired': desired,
        })
        assert not preview.isError, preview
        plan = preview.structuredContent
        assert plan == {'canvas_id': canvas_ref['canvas_id'], 'before': positions, 'after': desired}
        assert positions == {'caption': {'x': 2, 'y': 4}}

        projected = await client.call_tool('canvas_project_layout', {
            'canvas_ref': canvas_ref, 'plan': plan, 'positions': positions,
        })
        assert not projected.isError, projected
        assert projected.structuredContent == {'state': 'projected', 'positions': desired, 'conflicts': []}

        already_applied = await client.call_tool('canvas_project_layout', {
            'canvas_ref': canvas_ref, 'plan': plan, 'positions': projected.structuredContent['positions'],
        })
        assert not already_applied.isError, already_applied
        assert already_applied.structuredContent == {'state': 'no_change', 'positions': desired, 'conflicts': []}

        moved = {'caption': {'x': 12, 'y': 14}}
        conflict = await client.call_tool('canvas_project_layout', {
            'canvas_ref': canvas_ref, 'plan': plan, 'positions': moved,
        })
        assert not conflict.isError, conflict
        assert conflict.structuredContent == {'state': 'conflict', 'positions': moved, 'conflicts': ['caption']}

        wrong_canvas = await client.call_tool('canvas_project_layout', {
            'canvas_ref': {**canvas_ref, 'canvas_id': 'other'}, 'plan': plan, 'positions': positions,
        })
        assert wrong_canvas.isError

        current = await client.call_tool('canvas_read', {'canvas_ref': canvas_ref})
        assert not current.isError, current
        assert current.structuredContent['revision'] == 1
