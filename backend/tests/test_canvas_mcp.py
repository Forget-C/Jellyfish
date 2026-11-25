"""A real MCP client calls the Jellyfish ASGI app."""
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.config import settings
from app.main import app


CONNECTION = '/api/v1/canvas-mcp/connection'
ORIGIN = 'http://localhost:7788'


@pytest.mark.asyncio
@pytest.mark.parametrize('end_connection', ['close', 'expiry'])
async def test_canvas_mcp_connection_reconnects_and_revokes(monkeypatch, end_connection):
    from app.canvas_mcp import connection as credentials

    now = datetime(2026, 1, 1, tzinfo=UTC)
    statuses = []

    async def observe_response(response):
        statuses.append(response.status_code)

    class Clock:
        @staticmethod
        def now(_timezone):
            return now

    monkeypatch.setattr(credentials, 'datetime', Clock)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://test',
    ) as http:
        assert ORIGIN in settings.cors_origins_list
        assert (await http.post('/mcp')).status_code == 401
        assert (await http.post(CONNECTION, headers={'Origin': 'https://other.example'})).status_code == 403
        response = await http.post(CONNECTION, headers={'Origin': ORIGIN})
        assert response.status_code == 200
        connection = response.json()['data']
        assert connection['path'] == '/mcp'
        assert 'no-store' in response.headers['cache-control']
        status = (await http.get(CONNECTION)).json()['data']
        assert status == {'expires_at': connection['expires_at']}
        http.headers['Authorization'] = f"Bearer {connection['credential']}"
        for _ in range(2):
            async with streamable_http_client(
                f"http://test{connection['path']}", http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                tools = await client.list_tools()
                assert {'canvas_list_free', 'canvas_list_scene', 'canvas_read'} <= {
                    tool.name for tool in tools.tools
                }
        assert (await http.post('/mcp', headers={'Origin': 'https://other.example'})).status_code == 403
        assert (await http.delete(CONNECTION, headers={'Origin': 'https://other.example'})).status_code == 403
        with pytest.raises(ExceptionGroup):
            async with streamable_http_client(
                'http://test/mcp', http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                if end_connection == 'close':
                    assert (await http.delete(CONNECTION, headers={'Origin': ORIGIN})).status_code == 200
                else:
                    now += timedelta(days=1)
                http.event_hooks['response'].append(observe_response)
                await client.list_tools()
        assert statuses == [401]
        assert (await http.post('/mcp')).status_code == 401


@pytest.mark.asyncio
async def test_canvas_mcp_lists_both_scopes_and_reads_references(monkeypatch):
    from hashlib import sha256
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app import dependencies
    from app.core.db import Base
    from app.models.studio import Project

    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(dependencies, 'async_session_maker', sessions)
    try:
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add_all([Project(id='p', name='项目', style='真人都市'), Project(id='other', name='其他', style='真人都市')])
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            async def create(path, data):
                response = await http.post('/api/v1/studio' + path, json=data)
                assert response.is_success, response.text
                return response.json()['data']

            first = await create('/generation-canvases', {'name': '自由画布甲'})
            second = await create('/generation-canvases', {'name': '自由画布乙'})
            await create('/generation-canvases', {'name': '其他'})
            raw = '门打开了。'
            await create('/chapters', {'id': 'chapter', 'project_id': 'p', 'index': 0,
                                       'title': '章', 'raw_text': raw})
            sequences = '/projects/p/directing/chapters/chapter/sequences'
            scene = await create(sequences, {
                'title': '开门', 'position': 0, 'source_version': sha256(raw.encode()).hexdigest(),
                'span': {'start': 0, 'end': len(raw)},
            })
            storyboard = await create(f"{sequences}/{scene['id']}/canvases", {'name': '分镜画布'})
            connection = (await http.post(CONNECTION, headers={'Origin': ORIGIN})).json()['data']
            http.headers['Authorization'] = f"Bearer {connection['credential']}"
            async with streamable_http_client(
                'http://test/mcp', http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()

                async def call(name, arguments):
                    result = await client.call_tool(name, arguments)
                    assert not result.isError, result
                    return result.structuredContent

                rows = []
                for page in (1, 2):
                    listing = await call('canvas_list_free', {'q': '自由画布', 'page': page, 'page_size': 1})
                    assert listing['pagination']['total'] == 2
                    assert len(listing['items']) == 1
                    rows.extend(listing['items'])
                assert {item['id'] for item in rows} == {first['id'], second['id']}
                listing = await call('canvas_list_scene', {
                    'project_id': 'p', 'chapter_id': 'chapter', 'sequence_id': scene['id'],
                })
                assert [item['id'] for item in listing['canvases']] == [storyboard['id']]
                for item in [*rows, *listing['canvases']]:
                    canvas = await call('canvas_read', {'canvas_ref': item['canvas_ref']})
                    assert canvas['document']['name'] == item['name']
                    assert canvas['revision'] == 0
                for ref in (
                    {'canvas_id': storyboard['id']},
                    {'canvas_id': storyboard['id'], 'project_id': 'other'},
                    {'canvas_id': first['id'], 'project_id': 'p'},
                ):
                    result = await client.call_tool('canvas_read', {'canvas_ref': ref})
                    assert result.isError
                    assert '"status": 404' in result.content[0].text
            await http.delete(CONNECTION, headers={'Origin': ORIGIN})
    finally:
        await engine.dispose()
