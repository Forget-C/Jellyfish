"""Historical visual checks use real media through HTTP, generation and Worker."""
import asyncio
import base64
import json
import shutil
import subprocess
from datetime import timedelta

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import FileItem
from app.services.studio.file_usages import upsert_file_usage
from app.services.task_service import utcnow
from app.task_worker import TaskWorker
from tests.test_generation_canvas_check_reference_media import solid_png
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_images import image_storage  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize(('modality', 'with_reference'), [('image', False), ('video', False), ('image', True)])
async def test_post_visual_check_shares_real_media_preserves_evidence_and_leaves_audio_unverified(
        runtime, image_storage, tmp_path, monkeypatch, modality, with_reference):
    if modality == 'video' and not (shutil.which('ffmpeg') and shutil.which('ffprobe')):
        pytest.skip('ffmpeg and ffprobe required')
    red = solid_png((255, 0, 0))
    green = solid_png((0, 255, 0))
    media = red
    if modality == 'video':
        target = tmp_path / 'fixture.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=1',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-vf', 'setpts=PTS+0.2/TB',
                        '-c:v', 'libx264', '-c:a', 'aac', str(target)], check=True)
        media = target.read_bytes()

    async with runtime.sessions.begin() as db:
        generation = await db.get(Model, runtime.model_id)
        generation.category = modality
        generation.name = 'image-model' if modality == 'image' else 'doubao-seedance'
        generation.params = {}
        if modality == 'video':
            (await db.get(Provider, runtime.provider_id)).name = 'volcengine'
        db.add(Provider(id='visual-provider', name='aliyun_bailian', api_key='visual-secret',
                        base_url='https://vision.test/compatible-mode/v1'))
        await db.flush()
        db.add(Model(id='visual-model', name='qwen3-vl-plus', provider_id='visual-provider', category='text'))
        db.add(Model(id='text-only', name='text-only', provider_id='visual-provider', category='text'))
        if with_reference:
            db.add(FileItem(id='reference-image', name='coat.png', type='image', storage_key='coat-image', content_type='image/png'))
            await db.flush()
            await upsert_file_usage(db, file_id='reference-image', project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
            image_storage['coat-image'] = (green, 'image/png', {})

    client, url = runtime.client, runtime.url
    document = runtime.document
    model = document['cards'][0]
    model.update(id='visual', type=f'model.{modality}', config={'ratio': '16:9', 'seconds': 5} if modality == 'video' else {'count': 1})
    document['cards'] += [
        {'id': 'shot', 'type': 'direction.shot', 'visible_result': {'state': 'fact', 'text': '能看见红色背景'}},
        {'id': 'coat', 'type': 'content.costume', 'object_id': 'coat', 'name': '外套', 'text': '红色外套'},
        {'id': 'style', 'type': 'direction.style', 'fields': {'colors': {'state': 'fact', 'text': '红色占主要面积'}}},
        {'id': 'sound', 'type': 'direction.sound', 'environment': {'state': 'fact', 'text': '能听见持续低鸣'}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': 'visual-model'},
    ]
    document['edges'] = [
        {'id': source, 'source_card': source, 'source_port': 'text', 'target_card': 'visual', 'target_port': 'text'}
        for source in ('shot', 'coat', 'style', 'sound')
    ]
    document['input_order'] = {'visual': {'text': ['shot', 'coat', 'style', 'sound']}}
    model['input_bindings'] = [
        {'id': source, 'input_port': 'text', 'source': {'canvas_id': runtime.canvas_id, 'card_id': source,
                                                        'port_id': 'text', 'position': 0}}
        for source in ('shot', 'coat', 'style', 'sound')
    ]
    if with_reference:
        def source(card_id, port, **extra):
            return {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': port, 'position': 0, **extra}
        document['cards'] += [
            {'id': 'asset', 'type': 'content.image', 'file_id': 'reference-image'},
            {'id': 'reference', 'type': 'reference.costume', 'angle': '侧面',
             'name_binding': source('coat', 'object', object_id='coat'),
             'image_binding': {'file_id': 'reference-image', 'source': source('asset', 'image')}},
        ]
        document['edges'] += [
            {'id': 'name', 'source_card': 'coat', 'source_port': 'object', 'target_card': 'reference', 'target_port': 'name'},
            {'id': 'file', 'source_card': 'asset', 'source_port': 'image', 'target_card': 'reference', 'target_port': 'image_source'},
            {'id': 'image', 'source_card': 'reference', 'source_port': 'image', 'target_card': 'visual', 'target_port': 'image'},
        ]
        document['input_order']['reference'] = {'name': ['name'], 'image_source': ['file']}
        document['input_order']['visual']['image'] = ['image']
        model['input_bindings'].append({'id': 'image', 'input_port': 'image', 'source': source('reference', 'image')})
    connect_check(document, source='visual')
    await save_canvas(client, url, document, 1)

    calls = []
    def provider(request):
        if request.url.host == 'vision.test':
            body = json.loads(request.content)
            content = body['messages'][1]['content']
            calls.append(content)
            context = json.loads(content[0]['text'])
            return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps({'results': [
                    {'item_id': item['item_id'], 'outcome': 'conforming', 'message': '可见红色',
                     'visible_evidence': '当前画面中红色区域清晰'}
                    for item in context['requirements']
                ]}),
            }}]})
        if modality == 'image':
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(media).decode()}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'remote-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=media, headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})

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
            compiled = (await client.post(url + '/precheck', json={'card_id': 'visual'})).json()['data']
            assert compiled['can_run'], compiled
            generation = await client.post(url + '/runs', json={'request_id': 'visual-generation', 'preview_token': compiled['preview_token']})
            assert generation.status_code == 200, generation.text
            await advance()
            await advance()
            products = url + '/checks/check/products'
            product, = (await client.get(products)).json()['data']
            assert product['modality'] == modality and product['generation_status'] == 'succeeded'
            inspection = f"{products}/{product['run_id']}/{product['node_id']}/{product['position']}"

            document = (await client.get(url)).json()['data']['document']
            document['cards'][1]['visible_result']['text'] = '能看见蓝色背景'
            await save_canvas(client, url, document, 2)
            ready = (await client.get(inspection)).json()['data']
            assert ready['product']['file_id'] == product['file_id']
            assert ready['basis']['revision'] == 2 and ready['revision'] == 3
            assert ready['estimated_calls'] == (2 if with_reference else 1) and not calls
            assert {item['category'] for item in ready['items'] if item['availability'] == 'ready'} == {'R01', 'R02', 'R03'}
            audio, = [item for item in ready['items'] if item['source']['card_id'] == 'sound']
            assert audio['availability'] == 'unavailable' and '音轨' in audio['reason']
            submitted = await client.post(inspection + '/runs', json={
                'expected_revision': ready['revision'], 'basis_hash': ready['basis']['basis_hash'], 'expected_calls': ready['estimated_calls'],
            })
            assert submitted.status_code == 200, submitted.text
            await advance()
            history, = (await client.get(url + '/checks/check/reports')).json()['data']
            assert history['product']['result_set_id'] == product['result_set_id']
            assert sorted(map(len, calls)) == ([2, 3] if with_reference else [2])
            general = next(call for call in calls if len(call) == 2)
            assert '红色背景' in general[0]['text'] and '蓝色背景' not in general[0]['text']
            assert '持续低鸣' not in general[0]['text']
            image = base64.b64decode(general[1]['image_url']['url'].split(',')[1])
            assert image.startswith(b'\x89PNG\r\n\x1a\n')
            if modality == 'image':
                assert image == red
            if with_reference:
                comparison = next(call for call in calls if len(call) == 3)
                assert '原描述' in comparison[0]['text'] and '侧面' in comparison[0]['text'] and '红色背景' not in comparison[0]['text']
                assert base64.b64decode(comparison[2]['image_url']['url'].split(',')[1]) == green
            assert len(history['results']) == 3
            for result in history['results']:
                evidence = result['observed_media'][0]
                assert evidence['file_id'] == product['file_id'] and evidence['modality'] == modality
                assert evidence.get('frame_at_ms') == (200 if modality == 'video' else None)
                assert '音轨未核验' in result['boundary']
            if with_reference:
                result = next(result for result in history['results'] if result['item_id'].startswith('R02:'))
                assert result['observed_media'][1]['file_id'] == 'reference-image'
            assert any(row['item_id'] == audio['id'] for row in history['omitted'])
            assert 'visual-secret' not in str(history) and 'base64' not in str(history)
            document['cards'][5]['check_model_id'] = 'text-only'
            await save_canvas(client, url, document, 3)
            unavailable = (await client.get(inspection)).json()['data']
            assert unavailable['estimated_calls'] == 0
            assert all(item['availability'] == 'unavailable' for item in unavailable['items'])
            assert '图片读取能力' in unavailable['reason']
        finally:
            worker.text_pool.shutdown(wait=False)
