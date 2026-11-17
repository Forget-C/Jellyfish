"""Public historical video checks distinguish endpoints, path and continuity evidence."""
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
async def test_r05_endpoints_and_r06_occlusion_use_their_own_evidence(runtime, image_storage, tmp_path, monkeypatch):
    if not (shutil.which('ffmpeg') and shutil.which('ffprobe')):
        pytest.skip('ffmpeg and ffprobe required')
    clip = tmp_path / 'clip.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=1',
                    '-f', 'lavfi', '-i', 'color=black:s=64x64:r=10:d=0.5',
                    '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10:d=1',
                    '-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=1',
                    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0', '-c:v', 'libx264', str(clip)], check=True)
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name, model.params = 'video', 'doubao-seedance', {}
        (await db.get(Provider, runtime.provider_id)).name = 'volcengine'
        db.add(Provider(id='vision-provider', name='aliyun_bailian', api_key='vision-secret',
                        base_url='https://vision.test/compatible-mode/v1'))
        await db.flush()
        db.add(Model(id='video-check', name='qwen3-vl-plus', provider_id='vision-provider', category='text'))
        db.add(Model(id='static-check', name='qwen3-vl-flash', provider_id='vision-provider', category='text'))

    client, url = runtime.client, runtime.url
    doc = runtime.document
    doc['cards'][0].update(id='video', type='model.video', config={'ratio': '16:9', 'seconds': 5})
    doc['cards'] += [
        {'id': 'movement', 'type': 'direction.movement', 'fields': {
            'movement_start': {'state': 'fact', 'text': '开头取红色区域'},
            'movement_path': {'state': 'fact', 'text': '中途一直沿红色区域移动'},
            'end_frame': {'state': 'fact', 'text': '落幅回到红色区域'},
        }},
        {'id': 'keep', 'type': 'direction.continuity', 'category': 'appearance',
         'before': {'state': 'fact', 'text': '初始可见区域为红色'},
         'following_constraints': {'state': 'fact', 'text': '在被遮挡的时刻也保持原状态'}},
        {'id': 'change', 'type': 'direction.continuity', 'category': 'appearance',
         'before': {'state': 'fact', 'text': '原状态为红色'},
         'change': {'state': 'fact', 'text': '观察到蓝色阶段'},
         'after': {'state': 'fact', 'text': '随后恢复红色'}},
        {'id': 'visible-keep', 'type': 'direction.continuity', 'category': 'appearance',
         'following_constraints': {'state': 'fact', 'text': '可见区域保持红色'}},
        {'id': 'check', 'type': 'review.check', 'check_model_id': 'video-check'},
    ]
    sources = ('movement', 'keep', 'change', 'visible-keep')
    doc['edges'] = [{'id': key, 'source_card': key, 'source_port': 'text', 'target_card': 'video', 'target_port': 'text'}
                    for key in sources]
    doc['input_order'] = {'video': {'text': list(sources)}}
    connect_check(doc, source='video')
    await save_canvas(client, url, doc, 1)
    calls = []
    only_endpoints = False

    def pixels(video, at):
        return subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', at, '-i', str(video),
                                        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])[:3]

    def provider(request):
        if request.url.host == 'vision.test':
            body = json.loads(request.content)
            context, media = body['messages'][1]['content']
            requirements = json.loads(context['text'])['requirements']
            calls.append((media['type'], requirements))
            if media['type'] == 'image_url':
                payload = base64.b64decode(media['image_url']['url'].split(',')[1])
                color = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo',
                                        '-pix_fmt', 'rgb24', 'pipe:1'], input=payload, capture_output=True, check=True).stdout
                assert color[0] > 200 and color[2] < 20
                answers = [{'item_id': row['item_id'], 'outcome': 'conforming', 'message': '此帧为红色',
                            'visible_evidence': '可见红色区域'} for row in requirements]
            else:
                observed = tmp_path / 'observed.mp4'
                observed.write_bytes(base64.b64decode(media['video_url']['url'].split(',')[1]))
                assert pixels(observed, '0.5')[0] > 200 and pixels(observed, '3.0')[0] > 200
                assert max(pixels(observed, '1.0')) < 20 and pixels(observed, '2.0')[2] > 200
                answers = []
                for row in requirements:
                    source = row['source_card_id']
                    during = 1000 if source == 'keep' else 2000
                    answers.append({'item_id': row['item_id'], 'outcome': 'conforming' if source == 'change' else 'nonconforming',
                        'message': '按可见过程对照', 'visible_evidence': '红色出发并回到红色，中途出现其他画面',
                        'evidence_start_ms': 500, 'evidence_end_ms': 3000,
                        'visibility': 'occluded' if source == 'keep' else 'visible',
                        'moments': [{'phase': 'before', 'at_ms': 500, 'description': '红色区域'},
                                    {'phase': 'during', 'at_ms': during, 'description': '遮挡' if source == 'keep' else '蓝色区域'},
                                    {'phase': 'after', 'at_ms': 3000, 'description': '红色区域重新可见'}]})
                    if only_endpoints:
                        answers[-1]['moments'].pop(1)
            return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps({'results': answers}),
            }}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'remote-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=clip.read_bytes(), headers={'Content-Type': 'video/mp4'})
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

        async def get(path):
            response = await client.get(path)
            assert response.status_code == 200, response.text
            return response.json()['data']

        try:
            compiled = (await client.post(url + '/precheck', json={'card_id': 'video'})).json()['data']
            assert compiled['can_run'], compiled
            generation = await client.post(url + '/runs', json={'request_id': 'continuous-generation', 'preview_token': compiled['preview_token']})
            assert generation.status_code == 200, generation.text
            await advance()
            await advance()
            checks = url + '/checks/check'
            product, = await get(checks + '/products')
            inspection = append_canvas_path(checks, f"/products/{product['run_id']}/{product['node_id']}/{product['position']}")
            preview = await get(inspection)
            assert preview['observation_method'] == 'video_mixed' and preview['estimated_calls'] == 3
            assert {item['category'] for item in preview['items']} == {'R05', 'R06'}
            response = await client.post(inspection + '/runs', json={'expected_revision': preview['revision'],
                'basis_hash': preview['basis']['basis_hash'], 'expected_calls': 3})
            assert response.status_code == 200, response.text
            await advance()
            report, = await get(checks + '/reports')
            assert report['product']['file_id'] == product['file_id']
            results = {result['item_id']: result for result in report['results']}
            for field, time in [('movement_start', 0), ('end_frame', 3400)]:
                result = results[f'R05:movement:{field}']
                assert result['outcome'] == 'conforming'
                assert result['observed_media'][0]['frame_at_ms'] == time
                assert '未观察其他时刻或动作过程' in result['boundary']
            path = results['R05:movement:movement_path']
            assert path['outcome'] == 'nonconforming'
            assert path['observed_media'][0]['moments'][1] == {'phase': 'during', 'at_ms': 2000, 'description': '蓝色区域'}
            keep = results['R06:keep:continuity']
            assert keep['outcome'] == 'indeterminate' and '遮挡' in keep['message']
            assert keep['observed_media'][0]['moments'][1]['description'] == '遮挡'
            change = results['R06:change:continuity']
            assert change['outcome'] == 'conforming'
            assert [moment['phase'] for moment in change['observed_media'][0]['moments']] == ['before', 'during', 'after']
            assert '未采样' in change['boundary']
            assert results['R06:visible-keep:continuity']['outcome'] == 'nonconforming'
            assert sorted(kind for kind, _ in calls) == ['image_url', 'image_url', 'video_url']

            only_endpoints = True
            response = await client.post(inspection + '/runs', json={'expected_revision': preview['revision'],
                'basis_hash': preview['basis']['basis_hash'], 'expected_calls': 1, 'item_id': 'R05:movement:movement_path'})
            assert response.status_code == 200, response.text
            await advance()
            endpoint_only, previous = await get(checks + '/reports')
            result, = endpoint_only['results']
            assert result['outcome'] == 'indeterminate' and '过程' in result['message']
            assert not result['observed_media'][0].get('moments') and previous == report

            doc = (await get(url))['document']
            doc['cards'][-1]['check_model_id'] = 'static-check'
            await save_canvas(client, url, doc, 2)
            limited = await get(inspection)
            assert limited['observation_method'] == 'video_frame' and limited['estimated_calls'] == 2
            assert {item['field_id'] for item in limited['items'] if item['availability'] == 'ready'} == {'movement_start', 'end_frame'}
            assert all('视频序列' in item['reason'] for item in limited['items'] if item['availability'] == 'unavailable')

            only_endpoints = False
            for item_id, media_type in [('R05:movement:end_frame', 'image_url'), ('R06:change:continuity', 'video_url')]:
                call_count = len(calls)
                response = await client.post(append_canvas_path(checks, f"/reports/{report['id']}/recheck"), json={
                    'item_id': item_id, 'clarification': '请复看原视频中对应的画面依据',
                })
                assert response.status_code == 200, response.text
                await advance()
                records = await get(checks + '/reports')
                reviewed = next(entry for entry in records if entry['id'] == response.json()['data']['id'])
                assert reviewed['product'] == report['product'] and reviewed['results'] == [results[item_id]]
                assert reviewed['recheck']['original_result'] == results[item_id]
                assert len(calls) == call_count + 1
                kind, observed_requirements = calls[-1]
                assert kind == media_type
                assert [row['item_id'] for row in observed_requirements] == [item_id]
        finally:
            worker.text_pool.shutdown(wait=False)
