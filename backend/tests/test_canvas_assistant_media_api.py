"""Assistant reference-media behavior at the canvas and provider interfaces."""

from base64 import b64decode
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
from tests.chat_events import observe_canvas_turn, read_canvas_chat_snapshot
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


@pytest.fixture
def recorded_media_storage(canvas_client, monkeypatch):
    """Make uploaded bytes available to the real media decoder."""
    objects = {}
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
    return canvas_client


@pytest.mark.asyncio
async def test_assistant_sends_and_retains_only_the_selected_reference_images(recorded_media_storage, monkeypatch):
    canvas_client = recorded_media_storage
    requests = []
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
    sent = await observe_canvas_turn(canvas_client, url, json=command)
    assert sent.receipt.status_code == 202, sent.receipt.text
    result = sent.detail
    assert [(item['file_id'], item['observation']) for item in result['attachments']] == [(left, 'image'), (right, 'image')]
    blocks = requests[0][-1]['content']
    assert len([block for block in blocks if block['type'] == 'image_url']) == 2
    assert left in str(blocks) and right in str(blocks)
    assert (await read_canvas_chat_snapshot(canvas_client, url)).json()['data']['turns'] == [result]
    assert (await observe_canvas_turn(canvas_client, url, json=command)).detail == result
    assert len(requests) == 1
    assert (await observe_canvas_turn(canvas_client, url, json=dict(command, attachment_file_ids=[right]))).receipt.status_code == 409
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    file_details = (await canvas_client.get(f'/files/{left}')).json()['data']
    assert {usage['usage_kind'] for usage in file_details['usages']} == {'canvas_assistant_attachment'}
    other = (await canvas_client.post('/canvases', json={'name': '另一张画布'})).json()['data']
    other_url = f"/canvases/{other['id']}/assistant"
    assert (await read_canvas_chat_snapshot(canvas_client, other_url)).json()['data']['turns'] == []
    await observe_canvas_turn(canvas_client, other_url, json={'request_id': 'message', 'text': '不用参考素材'})
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
    answer = await observe_canvas_turn(canvas_client, url, json=inquiry)
    assert answer.receipt.status_code == 202, answer.receipt.text
    videos = answer.detail['attachments']
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
    limited = await observe_canvas_turn(canvas_client, url, json=dict(inquiry, request_id='limited'))
    assert limited.receipt.status_code == 202, limited.receipt.text
    assert [item['observation'] for item in limited.detail['attachments']] == ['unavailable', 'unavailable']
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
    response = await observe_canvas_turn(canvas_client, append_canvas_path(scene_url, '/assistant'), json={
        'request_id': 'foreign', 'text': '找参考', 'attachment_file_ids': [foreign_id],
    })
    assert response.receipt.status_code == 202, response.receipt.text
    assert response.detail['attachments'] == [{
        'file_id': foreign_id, 'name': None, 'file_type': None, 'observation': 'unavailable', 'at_ms': None,
    }]

    assert (await canvas_client.delete(url, params={'expected_revision': canvas['revision']})).status_code == 200
    file_details = (await canvas_client.get(f'/files/{left}')).json()['data']
    assert file_details['usages'] == []


@pytest.mark.asyncio
async def test_review_reports_only_the_interval_and_tracks_sent_to_the_provider(recorded_media_storage, monkeypatch):
    """Review the same three-second clip with each progressively richer input capability."""
    canvas_client = recorded_media_storage
    requests = []
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        payload = json.loads(request.content)
        seen = [message for message in payload['messages'] if message['role'] == 'tool']
        if seen:
            assert '证据' in json.loads(seen[0]['content'])['instructions']
            message = {'role': 'assistant', 'content': '保留这段节奏，先核对观察证据，再决定是否调整运镜。'}
            reason = 'stop'
        else:
            requests.append(next(message['content'] for message in reversed(payload['messages']) if message['role'] == 'user'))
            message = {'role': 'assistant', 'tool_calls': [{
                'index': 0, 'id': 'review-skill', 'type': 'function', 'function': {
                    'name': 'load_canvas_skill', 'arguments': '{"skill_id":"footage-review"}',
                },
            }]}
            reason = 'tool_calls'
        base = {'id': 'review-reply', 'created': 1, 'model': payload['model']}
        if payload.get('stream'):
            event = {**base, 'object': 'chat.completion.chunk',
                     'choices': [{'index': 0, 'finish_reason': reason, 'delta': message}]}
            return httpx.Response(200, request=request, headers={'content-type': 'text/event-stream'},
                                  content=f'data: {json.dumps(event)}\n\ndata: [DONE]\n\n')
        return httpx.Response(200, request=request, json={
            **base, 'object': 'chat.completion',
            'choices': [{'index': 0, 'finish_reason': reason, 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'local-test-key'
        provider.provider_key = 'aliyun_bailian'
        model = await db.get(Model, 'canvas-text')
        model.name = 'qwen3.8-omni-flash'
        db.add(ModelSettings(id=1, default_text_model_id='canvas-text'))

    clip = subprocess.run([
        'ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x128:r=10:d=3', '-f', 'lavfi',
        '-i', 'sine=frequency=600:sample_rate=16000:duration=3',
        '-c:v', 'libx264', '-bf', '0', '-threads', '1', '-c:a', 'aac',
        '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
    ], check=True, capture_output=True, timeout=15).stdout
    uploaded = await canvas_client.post('/files/upload', files={'file': ('known-timing.mp4', clip, 'video/mp4')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    canvas = (await canvas_client.post('/canvases', json={'name': '样片审看'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    for video, audio, evidence in [(False, False, 'video_frame'), (True, False, 'video_sequence'),
                                   (True, True, 'video_with_audio')]:
        async with canvas_client.canvas_sessions.begin() as db:
            model = await db.get(Model, 'canvas-text')
            model.capability_profile = {key: {'declaration': 'supported'} for key, enabled in {
                'image_inputs': True, 'video_inputs': video, 'audio_inputs': audio, 'tool_calling': True,
            }.items() if enabled}
        response = await observe_canvas_turn(canvas_client, url, json={
            'request_id': evidence, 'text': '只评估运镜和声画同步', 'attachment_file_ids': [file_id],
        })
        assert response.receipt.status_code == 202, response.receipt.text
        turn = response.detail
        observation = turn['attachments'][0]
        assert observation['observation'] == evidence
        assert turn['skills'] == [{'id': 'footage-review', 'name': '成片审看', 'version': '1.0.0'}]
        blocks = requests[-1]
        if not video:
            assert observation['at_ms'] == 0
            assert [b['type'] for b in blocks].count('image_url') == 1
            assert '视频静帧不能用于判断连续动作' in blocks[0]['text']
            continue
        assert 2_900 <= observation['end_ms'] - observation['start_ms'] <= 3_200
        encoded = next(block['video_url']['url'] for block in blocks if block['type'] == 'video_url')
        assert encoded.startswith('data:video/mp4;base64,')
        probe = subprocess.run([
            'ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', 'pipe:0',
        ], input=b64decode(encoded.split(',', 1)[1]), capture_output=True, check=True, timeout=15)
        kinds = {stream['codec_type'] for stream in json.loads(probe.stdout)['streams']}
        assert kinds == ({'video', 'audio'} if audio else {'video'})
        if audio:
            assert observation['start_ms'] <= observation['audio_start_ms'] < observation['audio_end_ms'] <= observation['end_ms']
        else:
            assert observation.get('audio_start_ms') is None
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(Model, 'canvas-text')).params = {'use_responses_api': True}
    sent = len(requests)
    incompatible = await observe_canvas_turn(canvas_client, url, json={
        'request_id': 'responses-video', 'text': '审看连续视频', 'attachment_file_ids': [file_id],
    })
    assert incompatible.receipt.status_code == 202 and incompatible.event['type'] == 'turn.interrupted'
    assert incompatible.detail['error_code'] == 'ASSISTANT_MODEL_INPUT_UNSUPPORTED'
    assert len(requests) == sent
    assert (await canvas_client.get(url + '/runtime')).json()['data']['runs'] == []
