"""Design-carried images use real save, compile and worker boundaries."""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


def reference_field(source, text='人物参考：'):
    return {'state': 'proposal', 'document': {'segments': [{'id': 'text', 'kind': 'text', 'text': text}, {'id': 'ref', 'kind': 'reference', 'source': source}]}}


async def carried_document(client):
    file_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('image.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '携带图片'})).json()['data']
    source = {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': file_id},
        {'id': 'style', 'type': 'direction.style', 'fields': {'direction': reference_field(source)}},
        {'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': {'canvas_id': canvas['id'], 'card_id': 'style', 'port_id': 'text', 'position': 0}}]}],
        edges=[{'id': 'reference', 'source_card': 'image', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image_example'}, {'id': 'design', 'source_card': 'style', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'style': {'image_example': ['reference']}, 'model': {'text': ['design']}})
    return canvas_url(f"/canvases/p/{canvas['id']}"), doc, file_id


@pytest.mark.asyncio
async def test_image_model_receives_only_design_referenced_image_without_direct_edge(canvas_client):
    client = canvas_client
    url, doc, file_id = await carried_document(client)
    doc['cards'][-1]['prompt'] = {'segments': [{'id': 'supplement', 'kind': 'text', 'text': '低优先补充'}]}
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert [image['file_id'] for image in compiled['media']] == [file_id]
    assert compiled['media'][0]['design_sources'] == [{'source': {'canvas_id': doc['id'], 'card_id': 'style', 'port_id': 'text', 'position': 0}, 'field_id': 'direction'}]
    assert '人物参考：image 1' in compiled['text']
    assert compiled['text'].index('导演设计 · 主要依据') < compiled['text'].index('模型正文 · 补充说明') < compiled['text'].index('低优先补充')
    assert 'DESIGN_MEDIA_CARRY_NOT_READY' not in {issue['code'] for issue in compiled['diagnostics']}
    saved = (await client.get(url)).json()['data']['document']['edges']
    assert {(edge['source_card'], edge['target_card']) for edge in saved} == {('image', 'style'), ('style', 'model')}
    assert all(edge in saved for edge in doc['edges'])


@pytest.mark.asyncio
@pytest.mark.parametrize('performance', [False, True])
async def test_worker_freezes_carried_image_and_text_model_field_reference(runtime, image_storage, monkeypatch, performance):
    import asyncio
    import base64
    import json
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model
    from app.models.studio_prompts_files_timeline import FileItem
    from app.services.studio.file_usages import upsert_file_usage
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_runs import accept as accept_text
    class TextModel:
        def __init__(self, **_kwargs):
            pass
        async def astream(self, _messages):
            yield SimpleNamespace(content='实际原文 @图片99 /首帧参考')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', TextModel)
    await accept_text(runtime)
    worker = TaskWorker(runtime.sessions)
    await worker.tick()
    await asyncio.gather(*worker.jobs.values())
    worker.text_pool.shutdown(wait=False)
    async with runtime.sessions.begin() as db:
        db.add(Model(id='image-' + runtime.model_id, name='image-model', category='image', provider_id=runtime.provider_id))
        db.add(FileItem(id='reference', name='reference', type='image', storage_key='reference', content_type='image/png'))
        await db.flush()
        await upsert_file_usage(db, file_id='reference', project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
    image_storage['reference'] = (b'original-image', 'image/png', {})
    source = lambda card_id, port: {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': port, 'position': 0}
    doc = runtime.document
    doc['cards'] += [{'id': 'reference', 'type': 'content.image', 'file_id': 'reference'},
        {'id': 'style', 'type': 'direction.style', 'fields': {'direction': reference_field(source('reference', 'image')), 'notes': reference_field(source('m', 'text'), '原文：')}},
        {'id': 'image', 'type': 'model.image', 'model_id': 'image-' + runtime.model_id, 'config': {'count': 1},
         'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source('style', 'text')}]}]
    if performance:
        values = doc['cards'][2].pop('fields')
        doc['cards'][2].update(type='direction.environment', activity=values['direction'], reason=values['notes'])
    doc['edges'] = [{'id': 'ref', 'source_card': 'reference', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image_example'},
                    {'id': 'text', 'source_card': 'm', 'source_port': 'text', 'target_card': 'style', 'target_port': 'text'},
                    {'id': 'design', 'source_card': 'style', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}]
    doc['input_order'] = {'style': {'image_example': ['ref'], 'text': ['text']}, 'image': {'text': ['design']}}
    if performance:
        doc['edges'][0]['target_port'] = 'image'
        doc['input_order']['style']['image'] = doc['input_order']['style'].pop('image_example')
    saved = await runtime.client.put(runtime.url, json={'request_id': 'design', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
    assert preview['can_run'], preview
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'image', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    doc['cards'][0]['prompt']['segments'][0]['text'] = '运行后新原文'
    (doc['cards'][2] if performance else doc['cards'][2]['fields'])['empty_space' if performance else 'colors'] = {'state': 'proposal', 'text': '运行后新参数'}
    assert (await runtime.client.put(runtime.url, json={'request_id': 'later', 'expected_revision': 2, 'document': doc})).status_code == 200
    stale = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
    assert 'INPUT_STALE' in {issue['code'] for issue in stale['diagnostics']}
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert calls[0]['prompt'] == preview['input']['text']
    assert '实际原文 @图片99 /首帧参考' in calls[0]['prompt']
    assert 'image 1' in calls[0]['prompt'] and '运行后新参数' not in calls[0]['prompt']
    assert base64.b64decode(calls[0]['images'][0]['image_url'].split(',')[1]) == b'original-image'


from tests.test_generation_canvas_runs import runtime  # noqa: E402,F401
from tests.test_generation_canvas_images import image_storage  # noqa: E402,F401


@pytest.mark.asyncio
async def test_shared_source_dedup_and_design_local_tokens_follow_actual_positions(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    other_file = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('other.png', b'other', 'image/png')})).json()['data']['id']
    source = lambda card_id: {'canvas_id': doc['id'], 'card_id': card_id, 'port_id': 'image', 'position': 0}
    doc['cards'][1]['fields']['direction'] = reference_field(source('image'), '\\@图片1 字面量；甲：')
    doc['cards'].insert(2, {'id': 'other-image', 'type': 'content.image', 'file_id': other_file})
    doc['cards'].insert(3, {'id': 'other-style', 'type': 'direction.camera', 'fields': {'viewpoint': reference_field(source('other-image'), '乙：'), 'support': reference_field(source('image'), '共享：')}})
    doc['edges'] += [{'id': 'other-image', 'source_card': 'other-image', 'source_port': 'image', 'target_card': 'other-style', 'target_port': 'image'},
                     {'id': 'shared', 'source_card': 'image', 'source_port': 'image', 'target_card': 'other-style', 'target_port': 'image'},
                     {'id': 'other-design', 'source_card': 'other-style', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
                     {'id': 'direct', 'source_card': 'other-image', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'}]
    doc['input_order']['other-style'] = {'image': ['other-image', 'shared']}
    doc['input_order']['model']['text'].append('other-design')
    doc['input_order']['model']['image'] = ['direct']
    doc['cards'][-1]['input_bindings'] = [{'id': 'direct', 'input_port': 'image', 'source': source('other-image')}, *doc['cards'][-1]['input_bindings'],
        {'id': 'second', 'input_port': 'text', 'source': {**source('other-style'), 'port_id': 'text'}}]
    response = await client.put(url, json={'request_id': 'positions', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert [item['source']['card_id'] for item in compiled['media']] == ['other-image', 'image']
    assert '@图片1 字面量；甲：image 2' in compiled['text']
    assert '乙：image 1' in compiled['text'] and '共享：image 2' in compiled['text']
    assert [item['source']['card_id'] for item in compiled['media'][1]['design_sources']] == ['style', 'other-style']
    doc['cards'][1]['fields']['direction']['state'] = 'not_applicable'
    assert (await client.put(url, json={'request_id': 'inactive', 'expected_revision': 1, 'document': doc})).status_code == 200
    active = (await client.get(url + '/cards/model/compile')).json()['data']
    assert [item['source']['card_id'] for item in active['media']] == ['other-image', 'image']
    assert len(active['media'][1]['design_sources']) == 1
    doc['cards'][3]['fields']['support']['state'] = 'empty'
    assert (await client.put(url, json={'request_id': 'last', 'expected_revision': 2, 'document': doc})).status_code == 200
    last = (await client.get(url + '/cards/model/compile')).json()['data']
    assert [item['source']['card_id'] for item in last['media']] == ['other-image']


@pytest.mark.asyncio
async def test_unconnected_direct_reference_is_not_granted_by_carried_media(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    doc['cards'][-1]['prompt'] = {'segments': [{'id': 'forged', 'kind': 'reference', 'source': {'canvas_id': doc['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}]}
    response = await client.put(url, json={'request_id': 'forged', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'SOURCE_NOT_CONNECTED' in {item['code'] for item in compiled['diagnostics']}


@pytest.mark.asyncio
async def test_carried_distinct_identity_same_file_is_not_collapsed_and_limits_apply(canvas_client):
    from app.core.integrations.image_capabilities import ImageModelCapability, register_image_model_capability, clear_image_model_capability_overrides
    client = canvas_client
    url, doc, file_id = await carried_document(client)
    alias = {'canvas_id': doc['id'], 'card_id': 'alias', 'port_id': 'image', 'position': 0}
    doc['cards'].insert(1, {'id': 'alias', 'type': 'content.image', 'file_id': file_id})
    doc['cards'][2]['fields']['notes'] = reference_field(alias, '另一身份：')
    doc['cards'][-1]['model_id'] = 'canvas-image'
    doc['edges'].append({'id': 'alias', 'source_card': 'alias', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image'})
    doc['input_order']['style']['image'] = ['alias']
    assert (await client.put(url, json={'request_id': 'limits', 'expected_revision': 0, 'document': doc})).status_code == 200
    register_image_model_capability(provider='openai', model_prefix='canvas-image', capability=ImageModelCapability(max_reference_images=1, supports_duplicate_reference_images=False))
    try:
        compiled = (await client.get(url + '/cards/model/compile')).json()['data']
        assert len(compiled['media']) == 2
        assert {'REFERENCE_COUNT_EXCEEDED', 'DUPLICATE_MEDIA_UNSUPPORTED'} <= {item['code'] for item in compiled['diagnostics']}
    finally:
        clear_image_model_capability_overrides(provider='openai')


@pytest.mark.asyncio
async def test_carried_missing_and_unsupported_media_block_instead_of_disappearing(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    doc['cards'][0]['file_id'] = None
    assert (await client.put(url, json={'request_id': 'missing', 'expected_revision': 0, 'document': doc})).status_code == 200
    missing = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'OUTPUT_MISSING' in {item['code'] for item in missing['diagnostics']}
    video_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('video.mp4', b'video', 'video/mp4')})).json()['data']['id']
    doc['cards'][0] = {'id': 'video', 'type': 'content.video', 'file_id': video_id}
    source = {'canvas_id': doc['id'], 'card_id': 'video', 'port_id': 'video', 'position': 0}
    doc['cards'][1]['fields']['direction'] = reference_field(source)
    doc['edges'][0].update(source_card='video', source_port='video', target_port='video')
    doc['input_order']['style'] = {'video': ['reference']}
    assert (await client.put(url, json={'request_id': 'video', 'expected_revision': 1, 'document': doc})).status_code == 200
    video = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'UNSUPPORTED_DESIGN_MEDIA' in {item['code'] for item in video['diagnostics']}
    assert len(video['media']) == 1 and video['media'][0]['modality'] == 'video'


@pytest.mark.asyncio
async def test_model_image_result_is_frozen_and_staleness_ignores_unused_candidates(runtime, image_storage):
    import asyncio
    import base64
    import json
    import httpx
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_images import image_card, accept
    await image_card(runtime, count=1)
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        image = b'upstream-output' if len(calls) == 1 else b'consumer-output'
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(image).decode()}]})
    async def tick():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            worker = TaskWorker(runtime.sessions, client=client)
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            worker.text_pool.shutdown(wait=False)
    await accept(runtime)
    await tick()
    source = lambda card_id, port: {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': port, 'position': 0}
    doc = runtime.document
    doc['cards'] += [{'id': 'unused', 'type': 'content.text', 'text': '未引用的候选'},
        {'id': 'style', 'type': 'direction.style', 'fields': {'direction': reference_field(source('image', 'image'))}},
        {'id': 'consumer', 'type': 'model.image', 'model_id': runtime.model_id, 'config': {'count': 1},
         'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source('style', 'text')}]}]
    doc['edges'] = [{'id': 'ref', 'source_card': 'image', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image'},
                    {'id': 'unused', 'source_card': 'unused', 'source_port': 'text', 'target_card': 'style', 'target_port': 'text'},
                    {'id': 'design', 'source_card': 'style', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}]
    doc['input_order'] = {'style': {'image': ['ref'], 'text': ['unused']}, 'consumer': {'text': ['design']}}
    async def save(revision):
        response = await runtime.client.put(runtime.url, json={'request_id': 'save-' + str(revision), 'expected_revision': revision, 'document': doc})
        assert response.status_code == 200, response.text
    await save(2)
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert preview['input']['media'][0]['result_set_id']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'consumer', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    await tick()
    assert len(calls) == 2
    assert base64.b64decode(calls[1]['images'][0]['image_url'].split(',')[1]) == b'upstream-output'
    assert calls[1]['prompt'] == preview['input']['text']
    doc['cards'][1]['text'] = '修改未引用候选'
    await save(3)
    current = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert current['current_outputs']['consumer'][0]['basis_current']
    doc['cards'][0]['prompt']['segments'][0]['text'] = '上游依据变化'
    await save(4)
    stale = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert not stale['current_outputs']['consumer'][0]['basis_current']
    invalid = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert 'INPUT_STALE' in {item['code'] for item in invalid['diagnostics']}


@pytest.mark.asyncio
async def test_composition_target_carries_whole_movement_and_its_selected_images(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    original = doc['cards'][1]['fields']['direction']
    doc['cards'][1] = {'id': 'movement', 'type': 'direction.movement', 'fields': {'movement_path': original},
        'phases': [{'id': 'end', 'name': '落幅', 'frame': {'state': 'proposal', 'text': '窗边'}}]}
    doc['cards'].insert(2, {'id': 'composition', 'type': 'direction.composition', 'fields': {'composition': {'state': 'fact', 'text': '仅构图'}},
        'frame_target': {'card_id': 'movement', 'state_id': 'phase:end'}})
    doc['cards'][-1]['input_bindings'][0]['source']['card_id'] = 'composition'
    doc['edges'][0]['target_card'] = 'movement'
    doc['edges'][1]['source_card'] = 'composition'
    doc['input_order']['movement'] = doc['input_order'].pop('style')
    response = await client.put(url, json={'request_id': 'target-only', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert len(compiled['media']) == 1
    assert {'composition', 'movement'} <= {item['source']['card_id'] for item in compiled['used']}
