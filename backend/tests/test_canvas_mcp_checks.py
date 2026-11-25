"""Canvas inspection through the MCP Streamable HTTP client."""

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import dependencies
from app.task_worker import TaskWorker
from tests.test_canvas_mcp import AUTHORIZATION, create_mcp_app
from tests.test_generation_canvas_checks import connect_check, duration_canvas, save_canvas
from tests.test_generation_canvas_runs import accept, runtime  # noqa: F401


@asynccontextmanager
async def _connect(runtime, monkeypatch):
    app = create_mcp_app()
    monkeypatch.setattr(dependencies, 'async_session_maker', runtime.sessions)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://test', headers=AUTHORIZATION,
    ) as http, streamable_http_client(
        'http://test/mcp', http_client=http,
    ) as (reader, writer, _), ClientSession(reader, writer) as client:
        await client.initialize()
        yield client


async def _call(client, name, arguments):
    result = await client.call_tool(name, arguments)
    assert not result.isError, result
    return result.structuredContent


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_preview_run_cancel_and_archive_pre_generation_check(runtime, monkeypatch):
    document = duration_canvas(runtime.document)
    document['cards'][3]['check_model_id'] = runtime.model_id
    connect_check(document)
    await save_canvas(runtime.client, runtime.url, document, 1)
    ref = {'canvas_id': runtime.canvas_id, 'project_id': runtime.project_id}
    scope = {'canvas_ref': ref, 'card_id': 'check'}

    async with _connect(runtime, monkeypatch) as client:
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {
            'canvas_check_preview', 'canvas_check_run', 'canvas_check_reports',
            'canvas_check_cancel', 'canvas_check_archived_reports',
        } <= tools

        rejected = await client.call_tool('canvas_check_preview', {
            **scope, 'canvas_ref': {'canvas_id': runtime.canvas_id},
        })
        assert rejected.isError
        preview = await _call(client, 'canvas_check_preview', scope)
        assert preview['basis']['target_card_id'] == 'model'
        assert (await _call(client, 'canvas_check_reports', scope))['result'] == []
        basis = {'expected_revision': preview['basis']['revision'], 'basis_hash': preview['basis']['basis_hash']}
        duration, = (item for item in preview['items'] if item['category'] == 'P06')
        report = await _call(client, 'canvas_check_run', {**scope, 'body': {**basis, 'item_id': duration['id']}})
        result, = report['results']
        assert result['outcome'] == 'risk' and '12' in result['message'] and '5' in result['message']

        semantic = next(item for item in preview['items'] if item['category'] == 'P01')
        queued = await _call(client, 'canvas_check_run', {**scope, 'body': {**basis, 'item_id': semantic['id']}})
        assert queued['executions'][0]['status'] == 'queued'
        cancelled = await _call(client, 'canvas_check_cancel', {**scope, 'report_id': queued['id']})
        assert cancelled['id'] == queued['id'] and cancelled['executions'][0]['status'] == 'cancelled'
        assert (await _call(client, 'canvas_check_reports', scope))['result'] == [cancelled, report]

        document['cards'].pop()
        document['edges'].pop()
        del document['input_order']['check']
        await save_canvas(runtime.client, runtime.url, document, 2)
        archived = await _call(client, 'canvas_check_archived_reports', {'canvas_ref': ref})
        assert archived['result'] == [cancelled, report]


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_check_and_recheck_one_retained_product(runtime, monkeypatch):
    document = runtime.document
    document['cards'].extend([
        {'id': 'shot', 'type': 'direction.shot', 'visible_result': {'text': '红伞留在门边', 'state': 'fact'}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': runtime.model_id},
    ])
    document['edges'] = [
        {'id': 'adopt', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'},
    ]
    document['input_order'] = {'m': {'text': ['adopt']}}
    connect_check(document, source='m')
    await save_canvas(runtime.client, runtime.url, document, 1)

    class Model:
        def __init__(self, **_params):
            pass

        async def astream(self, _messages):
            yield SimpleNamespace(content='门边放着一把红伞。')

        async def ainvoke(self, messages):
            context = json.loads(messages[1].content)
            return SimpleNamespace(content=json.dumps({'results': [
                {'item_id': item['item_id'], 'outcome': 'conforming', 'message': '文字可见',
                 'submitted_excerpt': '门边放着一把红伞。'}
                for item in context['requirements']
            ]}))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', Model)
    worker = TaskWorker(runtime.sessions)

    async def advance():
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())

    scope = {'canvas_ref': {'canvas_id': runtime.canvas_id, 'project_id': runtime.project_id}, 'card_id': 'check'}
    try:
        generated, _ = await accept(runtime)
        await advance()
        async with _connect(runtime, monkeypatch) as client:
            tools = {tool.name for tool in (await client.list_tools()).tools}
            assert {
                'canvas_check_products', 'canvas_post_check_preview', 'canvas_post_check_run', 'canvas_check_recheck',
            } <= tools
            product, = (await _call(client, 'canvas_check_products', scope))['result']
            assert product['run_id'] == generated['run_id']
            target = {**scope, **{key: product[key] for key in ('run_id', 'node_id', 'position')}}
            preview = await _call(client, 'canvas_post_check_preview', target)
            assert preview['product']['text'] == '门边放着一把红伞。' and preview['estimated_calls'] == 1
            report = await _call(client, 'canvas_post_check_run', {**target, 'body': {
                'expected_revision': preview['revision'], 'basis_hash': preview['basis']['basis_hash'],
                'expected_calls': preview['estimated_calls'],
            }})
            await advance()

            historical, = (await _call(client, 'canvas_check_reports', scope))['result']
            assert historical['id'] == report['id'] and historical['product'] == preview['product']
            original, = historical['results']
            assert original['outcome'] == 'conforming'
            request = await _call(client, 'canvas_check_recheck', {**scope, 'report_id': report['id'], 'body': {
                'item_id': original['item_id'], 'clarification': '核对门边物件',
            }})
            await advance()
            rechecked, previous = (await _call(client, 'canvas_check_reports', scope))['result']
            assert previous == historical
            assert rechecked['id'] == request['id'] and rechecked['product'] == historical['product']
            assert rechecked['recheck']['original_result'] == original
            assert rechecked['results'] == [original]
    finally:
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
