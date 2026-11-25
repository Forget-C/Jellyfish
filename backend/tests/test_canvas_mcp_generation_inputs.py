"""Verify CanvasGenerationInputs from the real MCP client."""

from contextlib import asynccontextmanager
from copy import deepcopy
import subprocess

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import dependencies
from app.core import storage
from app.main import app
from app.models.llm import Model, Provider
from tests.canvas_urls import seed_scene_canvas
from tests.generation_canvas_reference_fixtures import reference_image_sources
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@asynccontextmanager
async def connect(monkeypatch, canvas_client):
    """Use the fixture's database and the application's real MCP endpoint."""
    monkeypatch.setattr(dependencies, 'async_session_maker', canvas_client.canvas_sessions)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://test',
    ) as http:
        origin = {'Origin': 'http://localhost:7788'}
        url = '/api/v1/canvas-mcp/connection'
        response = await http.post(url, headers=origin)
        assert response.is_success, response.text
        http.headers['Authorization'] = f"Bearer {response.json()['data']['credential']}"
        try:
            async with streamable_http_client(
                'http://test/mcp', http_client=http,
            ) as (reader, writer, _), ClientSession(reader, writer) as client:
                await client.initialize()
                yield client
        finally:
            await http.delete(url, headers=origin)


async def call(client, tool, **arguments):
    result = await client.call_tool(tool, arguments)
    assert not result.isError, result
    return result.structuredContent


async def create_canvas(canvas_client, scene):
    if scene:
        response = await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '镜头'})
    else:
        response = await canvas_client.post('/canvases', json={'name': '自由创作'})
    assert response.is_success, response.text
    return response.json()['data']


async def enable_vidu(canvas_client):
    async with canvas_client.canvas_sessions.begin() as db:
        db.add(Provider(id='vidu', provider_key='vidu', name='Vidu', base_url='https://video.test', api_key='fixture'))
        await db.flush()
        model = await db.get(Model, 'canvas-video')
        model.name, model.provider_id = 'viduq2-pro', 'vidu'


@pytest.mark.asyncio
@pytest.mark.parametrize('scene', [False, True])
async def test_canvas_mcp_discovers_catalog_and_model_capabilities(canvas_client, monkeypatch, scene):
    canvas = await create_canvas(canvas_client, scene)
    await enable_vidu(canvas_client)
    scope = {'project_id': 'p'} if scene else {}
    canvas_ref = {'canvas_id': canvas['id'], **scope}
    async with connect(monkeypatch, canvas_client) as client:
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_catalog', 'canvas_model_capability'} <= tools
        catalog = await call(client, 'canvas_catalog', canvas_ref=canvas_ref)
        assert any(card['type'] == 'model.video' for card in catalog['cards'])
        assert any(policy['target_type'] == 'model.video' and policy['target_port'] == 'text'
                   for policy in catalog['connection_policies'])
        model = await call(client, 'canvas_model_capability', canvas_ref=canvas_ref, model_id='canvas-video')
        assert model['model_id'] == 'canvas-video'
        assert 'subject_image' in model['input_ports']
        assert '16:9' in model['ratios']


@pytest.mark.asyncio
@pytest.mark.parametrize('scene', [False, True])
async def test_canvas_mcp_compiles_saved_and_visible_video_inputs(canvas_client, monkeypatch, scene):
    canvas = await create_canvas(canvas_client, scene)
    await enable_vidu(canvas_client)
    document = canvas['document']
    scope = {'project_id': 'p'} if scene else {}
    canvas_ref = {'canvas_id': canvas['id'], **scope}
    file_ids = {}
    for face in ('saved', 'visible'):
        uploaded = await canvas_client.post('/files/upload',
            data={'usage_kind': 'canvas_upload', 'source_ref': canvas['id'], **scope},
            files={'file': (f'{face}.png', b'image', 'image/png')})
        assert uploaded.status_code == 201, uploaded.text
        file_ids[face] = uploaded.json()['data']['id']
        document['cards'].append({'type': 'reference.character', 'id': face, 'name': face,
                                  'image_binding': {'file_id': file_ids[face]}})
        document['edges'].append({'id': face, 'source_card': face, 'source_port': 'image',
                                  'target_card': 'video', 'target_port': 'subject_image'})
    document['input_order'] = {'video': {'subject_image': ['saved', 'visible']}}
    document['cards'].append({
        'type': 'model.video', 'id': 'video', 'model_id': 'canvas-video', 'config': {'ratio': '16:9', 'seconds': 5},
        'prompt': {'segments': [{'kind': 'text', 'id': 'body', 'text': '雨夜推镜'}]},
        'input_bindings': [{'id': 'face', 'input_port': 'subject_image', 'subject_name': '小雪',
                            'source': {'canvas_id': canvas['id'], 'card_id': 'saved',
                                       'port_id': 'image', 'position': 0}}],
    })
    document['cards'].append({'type': 'model.video', 'id': 'missing-model'})
    reference_image_sources(document)
    response = await canvas_client.put(f"/canvases/{canvas['id']}", params=scope, json={
        'request_id': 'inputs', 'expected_revision': 0, 'document': document,
    })
    assert response.is_success, response.text
    visible = deepcopy(document)
    video = next(card for card in visible['cards'] if card['id'] == 'video')
    video['prompt']['segments'][0]['text'] = '晨光拉远'
    video['input_bindings'][0]['source']['card_id'] = 'visible'
    async with connect(monkeypatch, canvas_client) as client:
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert {'canvas_compile_input', 'canvas_compile_document', 'canvas_video_reference_context',
                'canvas_precheck'} <= tools
        saved = await call(client, 'canvas_compile_input', canvas_ref=canvas_ref, card_id='video')
        preview = await call(client, 'canvas_compile_document', canvas_ref=canvas_ref,
                             document=visible, card_id='video', expected_revision=1)
        for result, basis, prompt in [(saved, 'saved', '雨夜推镜'), (preview, 'provided', '晨光拉远')]:
            assert result['basis'] == basis
            assert result['revision'] == 1
            assert result['can_run'], result['diagnostics']
            assert prompt in result['text']
        assert saved['video_media']['subjects'][0]['media'][0]['file_id'] == file_ids['saved']
        assert preview['video_media']['subjects'][0]['media'][0]['file_id'] == file_ids['visible']
        context = await call(client, 'canvas_video_reference_context', canvas_ref=canvas_ref,
                             document=visible, card_ids=['video'], expected_revision=1)
        assert 'subject_image' in context['capabilities']['canvas-video']['input_ports']
        single = await call(client, 'canvas_precheck', canvas_ref=canvas_ref, command={'card_id': 'video'})
        assert single['preview_token'] and single['input']['text'] == saved['text'], single['diagnostics']
        blocked = await call(client, 'canvas_precheck', canvas_ref=canvas_ref, command={'card_id': 'missing-model'})
        assert not blocked['can_run'] and blocked['preview_token'] is None
        missing = next(item for item in blocked['diagnostics'] if item['code'] == 'MODEL_REQUIRED')
        assert missing['target'] == {'card_id': 'missing-model', 'path': ['model_id']}
        for kind, card_ids in [('target', []), ('selection', ['video'])]:
            unavailable = await client.call_tool('canvas_precheck', {
                'canvas_ref': canvas_ref, 'command': {'card_id': 'video', 'kind': kind, 'card_ids': card_ids},
            })
            assert unavailable.isError
            assert 'SINGLE_MODEL_ONLY' in unavailable.content[0].text
            assert 'video' in unavailable.content[0].text


@pytest.mark.asyncio
async def test_canvas_mcp_prepares_a_video_frame_without_editing_canvas(canvas_client, monkeypatch, tmp_path):
    blobs = {}

    async def upload(*, key, data, **_kwargs):
        blobs[key] = data.read()

    async def download(*, key):
        return blobs[key]

    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'download_file', download)
    clip = tmp_path / 'clip.mp4'
    subprocess.run([
        'ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x24:r=10:d=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(clip),
    ], check=True)

    canvas = await create_canvas(canvas_client, scene=False)
    canvas_ref = {'canvas_id': canvas['id']}
    response = await canvas_client.post('/files/upload',
        data={'usage_kind': 'canvas_upload', 'source_ref': canvas['id']},
        files={'file': ('clip.mp4', clip.read_bytes(), 'video/mp4')})
    assert response.status_code == 201, response.text
    source_file = response.json()['data']['id']
    document = canvas['document']
    document['cards'].append({'id': 'clip', 'type': 'content.video', 'file_id': source_file})
    saved = await canvas_client.put(f"/canvases/{canvas['id']}", json={
        'request_id': 'video-source', 'expected_revision': 0, 'document': document,
    })
    assert saved.is_success, saved.text
    async with connect(monkeypatch, canvas_client) as client:
        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert 'canvas_prepare_video_frame' in tools
        before = await call(client, 'canvas_read', canvas_ref=canvas_ref)
        command = {'request_id': 'select-frame', 'source_card_id': 'clip', 'source_file_id': source_file, 'at_ms': 300}
        first = await call(client, 'canvas_prepare_video_frame', canvas_ref=canvas_ref, command=command)
        second = await call(client, 'canvas_prepare_video_frame', canvas_ref=canvas_ref, command=command)
        assert first == second
        assert first['type'] == 'content.image' and first['file_id'] != source_file
        assert first['frame_origin']['source_file_id'] == source_file
        assert first['frame_origin']['at_ms'] == 300
        assert await call(client, 'canvas_read', canvas_ref=canvas_ref) == before
