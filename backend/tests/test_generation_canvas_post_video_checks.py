"""R04 sends the retained video stream through the real check worker."""
from tests.canvas_urls import append_canvas_path
import asyncio
import base64
import json
import shutil
import subprocess
from datetime import timedelta

import httpx
import pytest

from app.models.llm import Model, Provider
from app.services.task_service import utcnow
from app.task_worker import TaskWorker
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_images import image_storage  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('check_model', ['qwen3-vl-plus', 'qwen3.8-omni-flash'])
async def test_r04_sends_audio_free_video_and_validates_evidence_ranges(runtime, image_storage, tmp_path, monkeypatch, check_model):
    if not (shutil.which('ffmpeg') and shutil.which('ffprobe')):
        pytest.skip('ffmpeg and ffprobe required')
    original = tmp_path / 'original.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=1.5',
                    '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10:d=1.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,setpts=PTS+0.2/TB[v]', '-map', '[v]', '-map', '2:a',
                    '-c:v', 'libx264', '-c:a', 'aac', str(original)], check=True)
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name, model.params = 'video', 'doubao-seedance', {}
        (await db.get(Provider, runtime.provider_id)).provider_key = 'volcengine'
        db.add(Provider(id='vision-provider', provider_key='aliyun_bailian', name='aliyun_bailian', api_key='vision-secret',
                        base_url='https://vision.test/compatible-mode/v1'))
        await db.flush()
        db.add(Model(id='video-check', name=check_model, provider_id='vision-provider', category='text'))
        db.add(Model(id='image-check', name='qwen3-vl-flash', provider_id='vision-provider', category='text'))

    client, url = runtime.client, runtime.url
    document = runtime.document
    document['cards'][0].update(id='video', type='model.video', config={'ratio': '16:9', 'seconds': 5})
    document['cards'] += [
        {'id': 'activity', 'type': 'direction.environment', 'activity': {'state': 'fact', 'text': '先出现红色区域，再切换为蓝色'},
         'empty_space': {'state': 'fact', 'text': '切换前画面中心保持留白'}},
        {'id': 'style', 'type': 'direction.style', 'fields': {'colors': {'state': 'fact', 'text': '主要颜色可识别'}}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': 'video-check'},
    ]
    document['edges'] = [
        {'id': key, 'source_card': key, 'source_port': 'text', 'target_card': 'video', 'target_port': 'text'}
        for key in ('activity', 'style')
    ]
    document['input_order'] = {'video': {'text': ['activity', 'style']}}
    connect_check(document, source='video')
    await save_canvas(client, url, document, 1)
    calls = []

    def provider(request):
        if request.url.host == 'vision.test':
            body = json.loads(request.content)
            context, video = body['messages'][1]['content']
            context = json.loads(context['text'])
            calls.append((context, video))
            assert video['type'] == 'video_url' and video['fps'] == 2
            header, encoded = video['video_url']['url'].split(',', 1)
            assert header == 'data:video/mp4;base64' and len(encoded) < 10_000_000
            submitted = tmp_path / 'submitted.mp4'
            submitted.write_bytes(base64.b64decode(encoded))
            streams = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type',
                                               '-of', 'csv=p=0', str(submitted)]).decode().splitlines()
            assert streams == ['video']
            for at, channel in [('0.5', 0), ('2.0', 2)]:
                rgb = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', at, '-i', str(submitted),
                                               '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
                assert rgb[channel] > 200 and rgb[2 - channel] < 20
            reply = json.dumps({'results': [{
                'item_id': row['item_id'], 'outcome': 'conforming', 'message': '看见可定位的动作变化',
                'visible_evidence': '开头红色区域，随后切换为蓝色',
                'evidence_start_ms': 500, 'evidence_end_ms': 2000 if row['field_id'] == 'activity' else 4000,
            } for row in context['requirements']]})
            if check_model == 'qwen3.8-omni-flash':
                assert body['model'] == check_model and body['stream'] is True and body['modalities'] == ['text']
                assert body['response_format'] == {'type': 'json_object'} and body['reasoning_effort'] == 'none'
                chunks = [{'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': part},
                                        'finish_reason': None}]}
                          for part in (reply[:len(reply) // 2], reply[len(reply) // 2:])]
                events = ''.join(f'data: {json.dumps(chunk)}\n\n' for chunk in chunks)
                return httpx.Response(200, text=events + 'data: [DONE]\n\n', headers={'Content-Type': 'text/event-stream'})
            return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': reply,
            }}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'remote-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=original.read_bytes(), headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/output.mp4'}})

    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
        worker = TaskWorker(runtime.sessions, client=transport)

        async def advance():
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            clock[0] += timedelta(seconds=10)

        try:
            compiled = (await client.post(url + '/precheck', json={'card_id': 'video'})).json()['data']
            assert compiled['can_run'], compiled
            generation = await client.post(url + '/runs', json={'request_id': 'sequence-generation', 'preview_token': compiled['preview_token']})
            assert generation.status_code == 200, generation.text
            await advance()
            await advance()
            products = url + '/checks/check/products'
            product, = (await client.get(products)).json()['data']
            inspection = append_canvas_path(products, f"/{product['run_id']}/{product['node_id']}/{product['position']}")
            document = (await client.get(url)).json()['data']['document']
            document['cards'][1]['activity']['text'] = '修改为先蓝后红'
            await save_canvas(client, url, document, 2)
            preview = (await client.get(inspection)).json()['data']
            assert preview['observation_method'] == 'video_mixed' and preview['estimated_calls'] == 2
            assert {item['field_id'] for item in preview['items'] if item['category'] == 'R04'} == {'activity', 'empty_space'}

            # One request admits just the selected process field.
            activity = next(item for item in preview['items'] if item['field_id'] == 'activity')
            response = await client.post(inspection + '/runs', json={'expected_revision': preview['revision'],
                'basis_hash': preview['basis']['basis_hash'], 'expected_calls': 1, 'item_id': activity['id']})
            assert response.status_code == 200, response.text
            await advance()
            report, = (await client.get(url + '/checks/check/reports')).json()['data']
            assert len(calls) == 1 and report['product']['result_set_id'] == product['result_set_id']
            assert '先出现红色区域' in str(calls[0][0]) and '修改为先蓝后红' not in str(calls[0][0])
            result, = report['results']
            assert result['outcome'] == 'conforming' and '音轨未核验' in result['boundary']
            media, = result['observed_media']
            assert media['file_id'] == product['file_id']
            assert media['video_range'] == {'start_ms': 200, 'end_ms': 3200, 'sampling_fps': 2}
            assert media['evidence_range'] == {'start_ms': 700, 'end_ms': 2200}
            assert 'vision-secret' not in str(report) and 'base64' not in str(report)

            leave_blank = next(item for item in preview['items'] if item['field_id'] == 'empty_space')
            response = await client.post(inspection + '/runs', json={'expected_revision': preview['revision'],
                'basis_hash': preview['basis']['basis_hash'], 'expected_calls': 1, 'item_id': leave_blank['id']})
            assert response.status_code == 200, response.text
            await advance()
            uncertain, _ = (await client.get(url + '/checks/check/reports')).json()['data']
            assert uncertain['results'][0]['outcome'] == 'indeterminate'
            assert uncertain['results'][0]['observed_media'][0].get('evidence_range') is None

            recheck_path = (url + f"/checks/check/reports/{report['id']}/recheck")
            clarification = {'item_id': activity['id'], 'clarification': '请复看红色转蓝色的原区间'}
            response = await client.post(recheck_path, json=clarification)
            assert response.status_code == 200, response.text
            await advance()
            reviewed, _, retained = (await client.get(url + '/checks/check/reports')).json()['data']
            assert retained == report and reviewed['product'] == report['product']
            assert reviewed['results'] == [result]
            assert reviewed['recheck']['original_result'] == result
            assert len(calls) == 3 and calls[-1][1] == calls[0][1]
            assert calls[-1][0]['recheck']['clarification'] == clarification['clarification']

            image_storage.clear()
            response = await client.post(inspection + '/runs', json={'expected_revision': preview['revision'],
                'basis_hash': preview['basis']['basis_hash'], 'expected_calls': 1, 'item_id': activity['id']})
            assert response.status_code == 200, response.text
            await advance()
            unreadable, *_ = (await client.get(url + '/checks/check/reports')).json()['data']
            result, = unreadable['results']
            assert result['outcome'] == 'indeterminate' and not result['observed_media'] and len(calls) == 3

            response = await client.post(recheck_path, json=clarification)
            assert response.status_code == 200, response.text
            await advance()
            unavailable, *_ = (await client.get(url + '/checks/check/reports')).json()['data']
            unavailable_result, = unavailable['results']
            assert unavailable_result['outcome'] == 'indeterminate'
            assert not unavailable_result['observed_media'] and '视频序列' in unavailable_result['message']
            assert len(calls) == 3

            document['cards'][3]['check_model_id'] = 'image-check'
            await save_canvas(client, url, document, 3)
            limited = (await client.get(inspection)).json()['data']
            assert limited['observation_method'] == 'video_frame' and limited['estimated_calls'] == 1
            assert all(item['availability'] == 'unavailable' and '视频序列' in item['reason']
                       for item in limited['items'] if item['category'] == 'R04')
        finally:
            worker.text_pool.shutdown(wait=False)
