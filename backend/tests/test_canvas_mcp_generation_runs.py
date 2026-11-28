"""Follow durable canvas runs through a real Streamable HTTP client."""
import asyncio
import json
from contextlib import asynccontextmanager

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import dependencies
from tests.test_canvas_mcp import AUTHORIZATION, create_mcp_app
from app.task_worker import TaskWorker
from tests.test_generation_canvas_runs import runtime


@asynccontextmanager
async def mcp_connection(app, transport=None):
    async with httpx.AsyncClient(
        transport=transport or httpx.ASGITransport(app=app), base_url='http://test', headers=AUTHORIZATION,
    ) as http, streamable_http_client(
        'http://test/mcp', http_client=http,
    ) as (reader, writer, _), ClientSession(reader, writer) as client:
        await client.initialize()
        yield client


def reference(runtime):
    return {'canvas_id': runtime.canvas_id, 'project_id': runtime.document.get('project_id')}


async def invoke(client, name, **arguments):
    result = await client.call_tool(name, arguments)
    assert not result.isError, result
    assert result.structuredContent is not None, result
    return result.structuredContent


async def run_command(runtime, request_id):
    precheck = await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})
    assert precheck.is_success, precheck.text
    body = precheck.json()['data']
    assert body['can_run'], body
    return {'request_id': request_id, 'preview_token': body['preview_token']}


class DropAdmissionResponse(httpx.ASGITransport):
    """Forward the submission, then simulate a lost HTTP response."""

    async def handle_async_request(self, request):
        response = await super().handle_async_request(request)
        if request.url.path == '/mcp' and request.method == 'POST':
            body = json.loads(request.content)
            if body.get('params', {}).get('name') == 'canvas_submit_run':
                await response.aclose()
                raise httpx.ReadError('Lost canvas admission response', request=request)
        return response


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent', 'app-handler'], indirect=True)
async def test_mcp_reads_empty_run_snapshot_for_both_canvas_kinds(runtime, monkeypatch):
    monkeypatch.setattr(dependencies, 'async_session_maker', runtime.sessions)
    app = create_mcp_app()
    async with app.router.lifespan_context(app), mcp_connection(app) as client:
        snapshot = await invoke(client, 'canvas_runtime_snapshot', canvas_ref=reference(runtime))
        assert snapshot == {'cursor': 0, 'runs': [], 'current_outputs': {}}


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['independent'], indirect=True)
async def test_mcp_replays_run_after_admission_response_is_lost(runtime, monkeypatch):
    monkeypatch.setattr(dependencies, 'async_session_maker', runtime.sessions)
    ref = reference(runtime)
    command = await run_command(runtime, 'lost-response')

    app = create_mcp_app()
    async with app.router.lifespan_context(app):
        with pytest.RaisesGroup(httpx.ReadError, flatten_subgroups=True):
            async with mcp_connection(app, DropAdmissionResponse(app=app)) as client:
                await client.call_tool('canvas_submit_run', {'canvas_ref': ref, 'command': command})

        async with mcp_connection(app) as client:
            receipt = (await invoke(client, 'canvas_read_run_receipt', canvas_ref=ref,
                                    request_id=command['request_id']))['result']
            assert receipt['request_id'] == command['request_id']
            assert await invoke(client, 'canvas_submit_run', canvas_ref=ref, command=command) == receipt
            snapshot = await invoke(client, 'canvas_runtime_snapshot', canvas_ref=ref)
            assert [run['id'] for run in snapshot['runs']] == [receipt['run_id']]
            task = (await invoke(client, 'canvas_read_task_run', canvas_ref=ref,
                                 task_id=receipt['task_ids'][0]))['result']
            assert task['id'] == receipt['run_id']
            assert task['nodes'][0]['status'] == 'queued'
            batch = (await invoke(client, 'canvas_read_run_events', canvas_ref=ref, cursor=0))['result']
            assert [(event['type'], event['run_id']) for event in batch] == [('node.updated', receipt['run_id'])]
            assert (await invoke(client, 'canvas_read_run_events', canvas_ref=ref,
                                 cursor=batch[0]['cursor']))['result'] == []
            assert (await invoke(client, 'canvas_read_run_receipt', canvas_ref=ref, request_id='missing'))['result'] is None
            assert (await invoke(client, 'canvas_read_task_run', canvas_ref=ref, task_id='missing'))['result'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['app-handler'], indirect=True)
async def test_mcp_reconnect_reads_output_completed_while_connection_closed(runtime, monkeypatch):
    monkeypatch.setattr(dependencies, 'async_session_maker', runtime.sessions)
    ref = reference(runtime)
    command = await run_command(runtime, 'publish-output')

    def provider_reply(_request):
        chunk = {'choices': [{'index': 0, 'delta': {'content': '在断线后完成的正文'}, 'finish_reason': None}]}
        return httpx.Response(200, text=f'data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n',
                              headers={'Content-Type': 'text/event-stream'})

    app = create_mcp_app()
    async with app.router.lifespan_context(app):
        async with mcp_connection(app) as client:
            receipt = await invoke(client, 'canvas_submit_run', canvas_ref=ref, command=command)
            cursor = (await invoke(client, 'canvas_runtime_snapshot', canvas_ref=ref))['cursor']

        async with httpx.AsyncClient(transport=httpx.MockTransport(provider_reply)) as provider:
            worker = TaskWorker(runtime.sessions, client=provider)
            try:
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
            finally:
                worker.text_pool.shutdown(wait=False)

        async with mcp_connection(app) as client:
            task_run = (await invoke(client, 'canvas_read_task_run', canvas_ref=ref,
                                     task_id=receipt['task_ids'][0]))['result']
            assert task_run['id'] == receipt['run_id']
            node = task_run['nodes'][0]
            assert node['status'] == 'succeeded'
            events = (await invoke(client, 'canvas_read_run_events', canvas_ref=ref, cursor=cursor))['result']
            assert events[-1]['type'] == 'run.finished'
            assert events[-1]['run_id'] == receipt['run_id']
            outputs = await invoke(client, 'canvas_card_outputs', canvas_ref=ref, card_id='m')
            assert outputs['outputs'][0]['payload'] == {'kind': 'text', 'text': '在断线后完成的正文'}
            prepared = (await invoke(client, 'canvas_prepare_output_content', canvas_ref=ref,
                                     run_id=receipt['run_id'], node_id=node['id'], position=0))['result']
            assert prepared['type'] == 'content.text'
            assert prepared['text'] == '在断线后完成的正文'
            assert prepared['origin']['node_id'] == node['id']
            saved = await invoke(client, 'canvas_read', canvas_ref=ref)
            assert all(card['id'] != prepared['id'] for card in saved['document']['cards'])


@pytest.mark.asyncio
@pytest.mark.parametrize('cancel_node', [False, True], ids=['run', 'node'])
async def test_mcp_explicitly_cancels_queued_run_or_node(runtime, monkeypatch, cancel_node):
    monkeypatch.setattr(dependencies, 'async_session_maker', runtime.sessions)
    ref = reference(runtime)
    command = await run_command(runtime, 'cancel-scope')

    app = create_mcp_app()
    async with app.router.lifespan_context(app), mcp_connection(app) as client:
        discovered = {tool.name: tool for tool in (await client.list_tools()).tools}
        expected = {
            'canvas_submit_run', 'canvas_read_run_receipt', 'canvas_read_task_run', 'canvas_runtime_snapshot',
            'canvas_read_run_events', 'canvas_cancel_run', 'canvas_card_outputs', 'canvas_prepare_output_content',
        }
        assert expected <= discovered.keys()
        assert all(discovered[name].outputSchema is not None for name in expected)
        receipt = await invoke(client, 'canvas_submit_run', canvas_ref=ref, command=command)
        task_id = receipt['task_ids'][0]
        result = (await invoke(client, 'canvas_read_task_run', canvas_ref=ref, task_id=task_id))['result']
        node = result['nodes'][0]
        assert node['status'] == 'queued'
        arguments = {'canvas_ref': ref, 'run_id': receipt['run_id']}
        if cancel_node:
            invalid = await client.call_tool('canvas_cancel_run', {**arguments, 'node_id': 'wrong-id'})
            assert invalid.isError and 'NODE_NOT_FOUND' in invalid.content[0].text
            arguments['node_id'] = node['id']
        cancelled = await invoke(client, 'canvas_cancel_run', **arguments)
        assert cancelled['id'] == receipt['run_id']
        assert cancelled['nodes'][0]['status'] == 'cancelled'
        reread = (await invoke(client, 'canvas_read_task_run', canvas_ref=ref, task_id=task_id))['result']
        assert reread['nodes'][0]['status'] == 'cancelled'
