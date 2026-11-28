"""Exercise grouped canvas edits through a real MCP client."""

from contextlib import asynccontextmanager
from hashlib import sha256

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import dependencies
from tests.test_canvas_mcp import AUTHORIZATION, create_mcp_app
from tests.directing.test_store import database


async def _post(http, path, body):
    response = await http.post('/api/v1/studio' + path, json=body)
    assert response.is_success, response.text
    return response.json()['data']


@asynccontextmanager
async def _workspace(tmp_path, monkeypatch, scene):
    app = create_mcp_app()
    async with database(tmp_path) as sessions:
        monkeypatch.setattr(dependencies, 'async_session_maker', sessions)
        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url='http://test',
        ) as http:
            ref = {}
            if scene:
                sequences = '/projects/p1/directing/chapters/ch1/sequences'
                raw = '兄弟在店中交谈'
                sequence = await _post(http, sequences, {
                    'title': '店内', 'position': 0, 'source_version': sha256(raw.encode()).hexdigest(),
                    'span': {'start': 0, 'end': len(raw)},
                })
                canvas = await _post(http, f"{sequences}/{sequence['id']}/canvases", {'name': '分镜画布'})
                ref['project_id'] = 'p1'
            else:
                canvas = await _post(http, '/generation-canvases', {'name': '自由画布'})
            ref['canvas_id'] = canvas['id']
            http.headers.update(AUTHORIZATION)
            async with streamable_http_client(
                'http://test/mcp', http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                yield client, http, ref


async def _call(client, name, arguments):
    result = await client.call_tool(name, arguments)
    assert not result.isError, result
    return result.structuredContent


@pytest.mark.asyncio
@pytest.mark.parametrize('scene', [False, True])
async def test_selected_group_remains_the_only_application_after_replay(tmp_path, monkeypatch, scene):
    async with _workspace(tmp_path, monkeypatch, scene) as (client, _, ref):
        tools = await client.list_tools()
        assert {'canvas_preview_edits', 'canvas_submit_edits', 'canvas_read_edit_receipt'} <= {
            tool.name for tool in tools.tools
        }
        scope = {'canvas_ref': ref}
        original = await _call(client, 'canvas_read', scope)
        plan = await _call(client, 'canvas_preview_edits', {
            **scope, 'expected_revision': original['revision'], 'groups': [
                {'id': 'a', 'cards': [{'id': 'caption-a', 'type': 'content.text', 'text': '旁白'}]},
                {'id': 'b', 'cards': [{'id': 'caption-b', 'type': 'content.text', 'text': '对白'}]},
            ],
        })
        assert [group['differences'][0]['path'] for group in plan['groups']] == [
            ['cards', 'caption-a'], ['cards', 'caption-b'],
        ]
        assert await _call(client, 'canvas_read', scope) == original
        submission = {**scope, 'preview_ref': plan['preview_ref'], 'request_id': 'only-b', 'group_ids': ['b']}
        altered = {'preview_ref': '0' + plan['preview_ref']}
        rejected = await client.call_tool('canvas_submit_edits', {**submission, **altered})
        assert rejected.isError
        assert await _call(client, 'canvas_read', scope) == original

        receipt = await _call(client, 'canvas_submit_edits', submission)
        assert [(group['group_id'], group['state']) for group in receipt['groups']] == [('b', 'applied')]
        assert await _call(client, 'canvas_submit_edits', submission) == receipt
        queried = await _call(client, 'canvas_read_edit_receipt', {**scope, 'request_id': 'only-b'})
        assert queried['result'] == receipt
        persisted = await _call(client, 'canvas_read', scope)
        assert persisted['revision'] == original['revision'] + 1
        assert {(card['id'], card.get('text')) for card in persisted['document']['cards']
                if card['id'].startswith('caption-')} == {('caption-b', '对白')}


@pytest.mark.asyncio
async def test_visible_group_previews_the_unsaved_document(tmp_path, monkeypatch):
    async with _workspace(tmp_path, monkeypatch, False) as (client, _, ref):
        tools = await client.list_tools()
        assert 'canvas_preview_visible_group' in {tool.name for tool in tools.tools}
        saved = await _call(client, 'canvas_read', {'canvas_ref': ref})
        draft_ref = {'canvas_id': 'visible-draft'}
        visible = {
            **saved['document'], 'id': draft_ref['canvas_id'],
            'cards': [{'id': 'caption', 'type': 'content.text', 'text': '未保存原稿'}],
        }
        group = await _call(client, 'canvas_preview_visible_group', {
            'canvas_ref': draft_ref, 'visible': visible, 'group_id': 'draft-edit', 'intents': [
                {'card_id': 'caption', 'target': {'kind': 'card_text'}, 'before': '未保存原稿', 'after': '改稿'},
            ],
        })
        assert group['id'] == 'draft-edit'
        assert group['differences'][0] == {
            'path': ['cards', 'caption', 'text'],
            'before': {'exists': True, 'value': '未保存原稿'},
            'after': {'exists': True, 'value': '改稿'},
        }
        result = await client.call_tool('canvas_read', {'canvas_ref': draft_ref})
        assert result.isError


@pytest.mark.asyncio
async def test_submit_reports_conflict_after_manual_source_change(tmp_path, monkeypatch):
    async with _workspace(tmp_path, monkeypatch, False) as (client, http, ref):
        scope = {'canvas_ref': ref}
        stored = await _call(client, 'canvas_read', scope)
        original_card = {'id': 'source', 'type': 'content.text', 'text': '原稿'}

        async def save(current, card, request_id):
            response = await http.put(f"/api/v1/studio/generation-canvases/{ref['canvas_id']}", json={
                'request_id': request_id, 'expected_revision': current['revision'],
                'document': {**current['document'], 'cards': [card]},
            })
            assert response.is_success, response.text
            return response.json()['data']['revision']

        revision = await save(stored, original_card, 'editor-original')
        stored = await _call(client, 'canvas_read', scope)
        plan = await _call(client, 'canvas_preview_edits', {
            **scope, 'expected_revision': revision,
            'groups': [{'id': 'draft-related', 'source_card_ids': ['source'],
                        'cards': [{'id': 'derived', 'type': 'content.text', 'text': '根据原稿写成'}]}],
        })
        revision = await save(stored, {**original_card, 'text': '手动改稿'}, 'editor-manual')
        receipt = await _call(client, 'canvas_submit_edits', {
            **scope, 'preview_ref': plan['preview_ref'], 'request_id': 'conflicted',
        })
        assert receipt['revision'] == revision
        assert receipt['groups'][0]['state'] == 'conflict'
        conflict = receipt['groups'][0]['conflicts'][0]
        assert conflict['difference']['path'] == ['cards', 'source']
        assert conflict['current']['value']['text'] == '手动改稿'
        result = await _call(client, 'canvas_read', scope)
        assert [(card['id'], card['text']) for card in result['document']['cards']] == [('source', '手动改稿')]
