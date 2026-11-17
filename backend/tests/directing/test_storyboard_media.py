"""Extracted references and actual single-card production through public HTTP and Worker."""
import asyncio
import base64
import json
from copy import deepcopy
from types import SimpleNamespace

import httpx
from tests.directing.storyboard_prompt_fixture import video_prompt_response

import pytest

from app.bootstrap import bootstrap_all_registries
from app.models.llm import Model, Provider
from app.models.studio import Chapter
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['image', 'video'])
async def test_storyboard_optional_empty_reference_and_explicit_media_admission(tmp_path, monkeypatch, image_storage, modality):
    original = '小雨推门。椅子倒了。'
    semantic = {
        'missed_objects': [{'id': 'rain', 'kind': 'character', 'name': '小雨', 'excerpt': '小雨推门'},
                           {'id': 'chair', 'kind': 'prop', 'name': '椅子', 'excerpt': '椅子倒了'}],
        'shots': [{'id': 'open', 'excerpt': '小雨推门。', 'object_ids': ['rain']},
                  {'id': 'fall', 'excerpt': '椅子倒了。', 'object_ids': ['chair']}],
    }

    class ControlledText:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, _messages):
            if response := video_prompt_response(_messages):
                return response
            if 'storyboard_draft' in json.loads(_messages[1].content):
                return SimpleNamespace(content='{"issues": []}')
            return SimpleNamespace(content=json.dumps(semantic, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledText)
    bootstrap_all_registries()
    calls = []

    def external(request):
        calls.append(request)
        if request.url.host == 'image.test':
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'actual-image-fixture').decode()}]})
        if request.method == 'POST':
            return httpx.Response(200, json={'task_id': 'fixture-video'})
        if request.url.host == 'video.test':
            return httpx.Response(200, json={'status': 'succeeded', 'creations': [{'url': 'https://media.test/clip.mp4'}]})
        return httpx.Response(200, content=b'actual-video-fixture', headers={'Content-Type': 'video/mp4'})

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = original
            db.add_all([Provider(id='image-provider', name='openai', base_url='https://image.test/v1', api_key='test'),
                        Provider(id='video-provider', name='vidu', base_url='https://video.test', api_key='test')])
            await db.flush()
            db.add_all([Model(id='text', name='text', category='text', provider_id='image-provider'),
                        Model(id='image', name='image-model', category='image', provider_id='image-provider'),
                        Model(id='video', name='viduq2', category='video', provider_id='video-provider')])
        root = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(root)).json()['data']
        scene = await client.post(root + '/sequences', json={'title': '推门', 'position': 0,
            'source_version': chapter['source_version'], 'span': {'start': 0, 'end': len(original)}})
        assert scene.status_code == 200, scene.text
        path = root + '/sequences/' + scene.json()['data']['id'] + '/storyboards'
        start = await client.post(path, json={'request_id': 'story', 'text_model_id': 'text', 'production_model_id': modality, 'mode': 'faithful'})
        assert start.status_code == 200, start.text
        started = start.json()['data']
        base = '/api/v1/studio/generation-canvases/p1/'
        canvas = base + started['canvas_id']

        async def read():
            return (await client.get(canvas)).json()['data']

        async def save(document, request_id):
            result = await client.put(canvas, json={'request_id': request_id,
                'expected_revision': (await read())['revision'], 'document': document})
            assert result.status_code == 200, result.text

        async def precheck(card_id, path=canvas):
            response = await client.post(path + '/precheck', json={'card_id': card_id})
            assert response.status_code == 200, response.text
            return response.json()['data']

        async with httpx.AsyncClient(transport=httpx.MockTransport(external)) as media:
            worker = TaskWorker(sessions, client=media)
            try:
                async def tick():
                    await worker.tick()
                    await asyncio.gather(*worker.jobs.values())

                await tick()
                task = (await client.get(path + '/' + started['task_id'])).json()['data']
                assert task['status'] == 'succeeded', task
                document = task['candidate']['document']
                await save(document, 'storyboard:' + started['task_id'])
                storyboard = document['storyboard']
                first, second = [shot['model_card_ids'][0] for shot in storyboard['shots']]
                blank = next(item for item in document['cards'] if item['type'] == 'reference.character')
                assert blank['image_binding'] is None
                preview = await precheck(first)
                assert preview['can_run'] and preview['preview_token'], preview
                assert preview['execution_nodes'] == [first] and preview['input']['media'] == []
                warnings = [item for item in preview['diagnostics'] if item['code'] == 'CREATIVE_REFERENCE_IMAGE_MISSING']
                assert len(warnings) == 1 and warnings[0]['target']['card_id'] == blank['id'], preview['diagnostics']
                assert warnings[0]['severity'] == 'warning' and warnings[0]['blocks'] == []
                assert calls == [] and (await client.get(canvas + '/runtime')).json()['data']['runs'] == []

                ordinary = await client.post(base.rstrip('/'), json={'name': '普通画布'})
                assert ordinary.status_code == 200, ordinary.text
                ordinary_state = ordinary.json()['data']
                ordinary_path = base + ordinary_state['id']
                ordinary_doc = ordinary_state['document']
                ordinary_doc['cards'] = [{**blank, 'name_binding': None}, {
                    'id': 'ordinary-model', 'type': 'model.' + modality, 'model_id': modality,
                    'prompt': {'segments': [{'id': 'text', 'kind': 'text', 'text': '小雨推门。'}]},
                    'config': {'ratio': '16:9'} if modality == 'video' else {},
                }]
                saved = await client.put(ordinary_path, json={'request_id': 'ordinary-reference',
                    'expected_revision': ordinary_state['revision'], 'document': ordinary_doc})
                assert saved.status_code == 200, saved.text
                ordinary_preview = await precheck('ordinary-model', ordinary_path)
                assert ordinary_preview['can_run'] and not ordinary_preview['diagnostics'], ordinary_preview

                run_body = {'request_id': 'confirm-' + modality, 'preview_token': preview['preview_token']}
                accepted = await client.post(canvas + '/runs', json=run_body)
                assert accepted.status_code == 200, accepted.text
                assert (await client.post(canvas + '/runs', json=run_body)).json() == accepted.json()
                for _ in range(22):
                    await tick()
                    runtime = (await client.get(canvas + '/runtime')).json()['data']
                    assert len(runtime['runs']) == 1
                    node, = runtime['runs'][0]['nodes']
                    assert node['status'] not in ('failed', 'cancelled'), node
                    if node['status'] == 'succeeded':
                        break
                    await asyncio.sleep(.12)
                assert node['status'] == 'succeeded', node
                assert node['card_id'] == first and second not in runtime['current_outputs']
                assert runtime['current_outputs'][first][0]['file_id']
                posts = [call for call in calls if call.method == 'POST']
                assert len(posts) == 1
                body = json.loads(posts[0].content)
                assert '小雨推门' in body['prompt']
                assert 'images' not in body and 'subjects' not in body
                assert posts[0].url.path.endswith('/images/generations' if modality == 'image' else '/text2video')
                frozen = node['basis']
                assert frozen['input']['media'] == []
                changed = (await read())['document']
                bound = deepcopy(changed)
                binding_id = storyboard['shots'][0]['reference_uses'][0]['binding_id']
                port = 'image' if modality == 'image' else 'subject_image'
                bound['edges'].append({'id': binding_id, 'source_card': blank['id'], 'source_port': 'image',
                                       'target_card': first, 'target_port': port})
                bound['input_order'].setdefault(first, {})[port] = [binding_id]
                await save(bound, 'unadopted-candidate')
                candidate = await precheck(first)
                assert candidate['can_run'] and candidate['input']['media'] == []
                assert any(item['code'] == 'CREATIVE_REFERENCE_IMAGE_MISSING' for item in candidate['diagnostics'])
                actual = next(item for item in bound['cards'] if item['id'] == first)
                actual['input_bindings'].append({'id': binding_id, 'source': {'canvas_id': bound['id'],
                    'card_id': blank['id'], 'port_id': 'image', 'position': 0}, 'input_port': port,
                    'subject_name': blank['name'] if modality == 'video' else None})
                await save(bound, 'unavailable-actual-input')
                unavailable = await precheck(first)
                assert not unavailable['can_run'] and unavailable['preview_token'] is None, unavailable
                assert any(item['code'] == 'OUTPUT_MISSING' and 'run' in item['blocks'] for item in unavailable['diagnostics'])
                assert not any(item['code'] == 'CREATIVE_REFERENCE_IMAGE_MISSING' for item in unavailable['diagnostics'])
                # 提取元数据仍记载曾采用，但人工已经取消实际绑定。
                bound['storyboard']['shots'][0]['reference_uses'][0]['active'] = True
                actual['input_bindings'] = [item for item in actual['input_bindings'] if item['id'] != binding_id]
                await save(bound, 'removed-actual-reference')
                removed = await precheck(first)
                assert removed['can_run']
                assert any(item['code'] == 'CREATIVE_REFERENCE_IMAGE_MISSING' for item in removed['diagnostics'])


                model = next(item for item in changed['cards'] if item['id'] == first)
                if modality == 'video':
                    model['prompt']['segments'].append({'id': 'required-frame', 'kind': 'instruction', 'command': '首帧参考', 'references': []})
                    code = 'INSTRUCTION_REFERENCE_REQUIRED'
                else:
                    model['model_id'] = None
                    code = 'MODEL_REQUIRED'
                await save(changed, 'missing-hard-input')
                blocked = await precheck(first)
                assert not blocked['can_run'] and blocked['preview_token'] is None, blocked
                assert any(item['code'] == code and 'run' in item['blocks'] for item in blocked['diagnostics'])
                forbidden = await client.post(canvas + '/runs', json={**run_body, 'request_id': 'old-confirmation'})
                assert forbidden.status_code == 409, forbidden.text
                retained = (await client.get(canvas + '/runtime')).json()['data']
                assert retained['runs'][0]['nodes'][0]['basis'] == frozen
                assert len(retained['runs']) == 1
            finally:
                worker.text_pool.shutdown(wait=False)
