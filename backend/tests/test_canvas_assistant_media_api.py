"""Assistant reference-media behavior at the canvas and provider interfaces."""

import io
import json
import subprocess
from types import SimpleNamespace

import httpx
from PIL import Image
import pytest

from app.core import storage
from app.models.llm import Model, ModelSettings, Provider
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.mark.asyncio
async def test_assistant_sends_and_retains_only_the_selected_reference_images(canvas_client, monkeypatch):
    objects = {}
    requests = []
    async def upload(*, key, data, **kwargs):
        objects[key] = data.read(), kwargs['content_type']
    async def info(*, key):
        data, mime = objects[key]
        return SimpleNamespace(size=len(data), content_type=mime)
    async def download(*, key):
        return objects[key][0]
    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'get_file_info', info)
    monkeypatch.setattr(storage, 'download_file', download)

    real_send = httpx.AsyncClient.send
    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        requests.append(body['messages'])
        return httpx.Response(200, request=request, json={
            'id': 'generated-answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '比较参考素材 1 和 2'}}],
        })
    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {'image_inputs': {'declaration': 'supported'}}
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    async def image(name, color):
        buffer = io.BytesIO()
        Image.new('RGB', (12, 12), color).save(buffer, 'PNG')
        response = await canvas_client.post('/files/upload', files={'file': (name, buffer.getvalue(), 'image/png')})
        assert response.status_code == 201, response.text
        return response.json()['data']['id']

    left, right = await image('red.png', 'red'), await image('blue.png', 'blue')
    canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    command = {'request_id': 'images', 'text': '比较这两张图片', 'attachment_file_ids': [left, right]}
    sent = await canvas_client.post(url + '/assistant', json=command)
    assert sent.status_code == 200, sent.text
    result = sent.json()['data']
    assert [(item['file_id'], item['observation']) for item in result['attachments']] == [(left, 'image'), (right, 'image')]
    blocks = requests[0][-1]['content']
    assert len([block for block in blocks if block['type'] == 'image_url']) == 2
    assert left in str(blocks) and right in str(blocks)
    assert (await canvas_client.get(url + '/assistant')).json()['data']['turns'] == [result]
    assert (await canvas_client.post(url + '/assistant', json=command)).json()['data'] == result
    assert len(requests) == 1
    assert (await canvas_client.post(url + '/assistant', json=dict(command, attachment_file_ids=[right]))).status_code == 409
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    file_details = (await canvas_client.get(f'/files/{left}')).json()['data']
    assert {usage['usage_kind'] for usage in file_details['usages']} == {'canvas_assistant_attachment'}
    other = (await canvas_client.post('/canvases', json={'name': '另一张画布'})).json()['data']
    other_url = f"/canvases/{other['id']}/assistant"
    assert (await canvas_client.get(other_url)).json()['data']['turns'] == []
    await canvas_client.post(other_url, json={'request_id': 'message', 'text': '不用参考素材'})
    assert requests[-1][-1]['content'] == '不用参考素材'

    clip = subprocess.run(
        ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=16x16:d=1',
         '-c:v', 'mpeg4', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
        check=True, capture_output=True, timeout=20,
    ).stdout
    uploaded = await canvas_client.post('/files/upload', files={'file': ('clip.mp4', clip, 'video/mp4')})
    assert uploaded.status_code == 201, uploaded.text
    video_id = uploaded.json()['data']['id']
    inquiry = {'request_id': 'video', 'text': '看这段视频和另一张图',
               'attachment_file_ids': [video_id, 'missing-file']}
    answer = await canvas_client.post(url + '/assistant', json=inquiry)
    assert answer.status_code == 200, answer.text
    videos = answer.json()['data']['attachments']
    assert videos[0]['observation'] == 'video_frame'
    assert videos[0]['at_ms'] == 0
    assert videos[1]['observation'] == 'unavailable'
    blocks = requests[-1][-1]['content']
    assert [block['type'] for block in blocks] == ['text', 'text', 'image_url', 'text']
    assert blocks[2]['image_url']['url'].startswith('data:image/png;base64,')
    assert '视频静帧不能用于判断连续动作' in blocks[0]['text']

    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = {}
    limited = await canvas_client.post(url + '/assistant', json=dict(inquiry, request_id='limited'))
    assert limited.status_code == 200, limited.text
    assert [item['observation'] for item in limited.json()['data']['attachments']] == ['unavailable', 'unavailable']
    blocks = requests[-1][-1]['content']
    assert [block['type'] for block in blocks] == ['text', 'text', 'text']
    assert '当前助手模型或接入无法读取图片' in blocks[0]['text']

    foreign = await canvas_client.post(
        '/files/upload', files={'file': ('foreign.png', b'foreign', 'image/png')},
        data={'project_id': 'other', 'usage_kind': 'generation_upload'},
    )
    foreign_id = foreign.json()['data']['id']
    scene = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '项目画布'})).json()['data']
    scene_url = canvas_url(f"/canvases/p/{scene['id']}")
    response = await canvas_client.post(append_canvas_path(scene_url, '/assistant'), json={
        'request_id': 'foreign', 'text': '找参考', 'attachment_file_ids': [foreign_id],
    })
    assert response.status_code == 200, response.text
    assert response.json()['data']['attachments'] == [{
        'file_id': foreign_id, 'name': None, 'file_type': None, 'observation': 'unavailable', 'at_ms': None,
    }]

    assert (await canvas_client.delete(url, params={'expected_revision': canvas['revision']})).status_code == 200
    file_details = (await canvas_client.get(f'/files/{left}')).json()['data']
    assert file_details['usages'] == []
