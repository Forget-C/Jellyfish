"""A real MCP client calls the Jellyfish ASGI app."""
import httpx
import pytest

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.config import Settings
from app import main


CONNECTION = '/api/v1/canvas-mcp/connection'
TEST_KEY = 'test-canvas-mcp-key'
AUTHORIZATION = {'Authorization': f'Bearer {TEST_KEY}'}


def create_mcp_app(*, mcp_enabled=True, mcp_secret_key=TEST_KEY):
    return main.create_app(Settings(
        _env_file=None, mcp_enabled=mcp_enabled, mcp_secret_key=mcp_secret_key,
    ))


@pytest.mark.asyncio
async def test_canvas_mcp_configured_key_survives_restart_and_supports_rotation(monkeypatch):
    monkeypatch.delenv('MCP_ENABLED', raising=False)
    for key in (TEST_KEY, TEST_KEY, 'rotated-key'):
        monkeypatch.setenv('MCP_SECRET_KEY', key)
        app = main.create_app(Settings(_env_file=None))
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            assert (await http.post('/mcp')).status_code == 401
            assert (await http.post('/mcp', headers={'Authorization': 'Bearer wrong'})).status_code == 401
            if key != TEST_KEY:
                assert (await http.post('/mcp', headers=AUTHORIZATION)).status_code == 401
            for method in ('GET', 'POST', 'DELETE'):
                assert (await http.request(method, CONNECTION)).status_code == 404
            http.headers['Authorization'] = f'Bearer {key}'
            assert (await http.post('/mcp', headers={'Origin': 'https://other.example'})).status_code == 403
            async with streamable_http_client(
                'http://test/mcp', http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                tools = await client.list_tools()
                assert {'canvas_list_free', 'canvas_list_scene', 'canvas_read'} <= {
                    tool.name for tool in tools.tools
                }


@pytest.mark.asyncio
@pytest.mark.parametrize(('enabled', 'key'), [(False, TEST_KEY), (True, ''), (True, '  ')])
async def test_canvas_mcp_is_unavailable_when_disabled_or_unconfigured(enabled, key):
    app = create_mcp_app(mcp_enabled=enabled, mcp_secret_key=key)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://test', headers=AUTHORIZATION,
    ) as http:
        assert (await http.get('/health')).status_code == 200
        assert (await http.post('/mcp')).status_code == 404


@pytest.mark.asyncio
async def test_canvas_mcp_lists_both_scopes_and_reads_references(monkeypatch):
    from hashlib import sha256
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app import dependencies
    from app.core.db import Base
    from app.models.studio import Project

    app = create_mcp_app()
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
            async def create_storyboard(project_id):
                chapter_id = f'{project_id}-chapter'
                await create('/chapters', {'id': chapter_id, 'project_id': project_id, 'index': 0,
                                           'title': '章', 'raw_text': raw})
                sequences = f'/projects/{project_id}/directing/chapters/{chapter_id}/sequences'
                scene = await create(sequences, {
                    'title': '开门', 'position': 0, 'source_version': sha256(raw.encode()).hexdigest(),
                    'span': {'start': 0, 'end': len(raw)},
                })
                storyboard = await create(f"{sequences}/{scene['id']}/canvases", {'name': '分镜画布'})
                return chapter_id, scene, storyboard

            chapter_id, scene, storyboard = await create_storyboard('p')
            other_chapter_id, other_scene, other_storyboard = await create_storyboard('other')
            http.headers.update(AUTHORIZATION)
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
                    'project_id': 'p', 'chapter_id': chapter_id, 'sequence_id': scene['id'],
                })
                assert [item['id'] for item in listing['canvases']] == [storyboard['id']]
                other_listing = await call('canvas_list_scene', {
                    'project_id': 'other', 'chapter_id': other_chapter_id, 'sequence_id': other_scene['id'],
                })
                assert [item['id'] for item in other_listing['canvases']] == [other_storyboard['id']]
                for item in [*rows, *listing['canvases'], *other_listing['canvases']]:
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
    finally:
        await engine.dispose()
