"""Carried video purposes persist through the public canvas boundary."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_carried_images import carried_document


@pytest.mark.asyncio
@pytest.mark.parametrize('performance', [False, True])
async def test_video_requires_explicit_purpose_and_reuses_source_across_purposes(canvas_client, performance):
    client = canvas_client
    url, doc, file_id = await carried_document(client)
    if performance:
        values = doc['cards'][1].pop('fields')
        doc['cards'][1].update(type='direction.environment', activity=values['direction'])
    model = doc['cards'][-1]
    model.update(type='model.video', config={'ratio': '16:9'})
    async def save(revision):
        response = await client.put(url, json={'request_id': str(revision), 'expected_revision': revision, 'document': doc})
        assert response.status_code == 200, response.text
        return (await client.get(url + '/cards/model/compile')).json()['data']
    first = await save(0)
    assert 'DESIGN_MEDIA_PURPOSE_REQUIRED' in {item['code'] for item in first['diagnostics']}
    source = {'canvas_id': doc['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    model['design_media_uses'] = [{'id': 'first', 'source': source, 'input_port': 'first_frame'},
        {'id': 'subject', 'source': source, 'input_port': 'subject_image', 'subject_name': '张三'}]
    compiled = await save(1)
    assert len(compiled['media']) == 1
    assert compiled['video_media']['frames']['first']['file_id'] == file_id
    assert compiled['video_media']['subjects'][0]['name'] == '张三'
    assert compiled['video_media']['subjects'][0]['media'][0]['file_id'] == file_id
    assert 'DESIGN_MEDIA_CARRY_NOT_READY' not in {item['code'] for item in compiled['diagnostics']}
    assert (await client.get(url)).json()['data']['document']['edges'] == doc['edges']
    (doc['cards'][1]['activity'] if performance else doc['cards'][1]['fields']['direction'])['state'] = 'empty'
    inactive = await save(2)
    assert inactive['media'] == [] and inactive['video_media']['subjects'] == []
    assert inactive['video_media']['frames']['first'] is None


@pytest.mark.asyncio
async def test_carried_video_media_reports_unsupported_type_and_precise_configuration(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    model = doc['cards'][-1]
    source = {'canvas_id': doc['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    model.update(type='model.video', config={'ratio': '16:9'}, design_media_uses=[
        {'id': 'wrong', 'source': source, 'input_port': 'subject_video', 'subject_name': '张三'},
        {'id': 'unnamed', 'source': source, 'input_port': 'subject_image'}])
    assert (await client.put(url, json={'request_id': 'bad', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    issues = {item['code']: item for item in compiled['diagnostics']}
    assert issues['INPUT_BINDING_TYPE']['target']['path'] == ['design_media_uses', 'wrong']
    assert issues['SUBJECT_NAME_REQUIRED']['target']['path'] == ['design_media_uses', 'unnamed']
    assert compiled['video_media']['subjects'] == [], 'wrong type must not silently become an image subject'


from tests.test_generation_canvas_runs import runtime  # noqa: E402,F401
from tests.test_generation_canvas_images import image_storage  # noqa: E402,F401


@pytest.mark.asyncio
async def test_worker_freezes_carried_subject_image_video_and_groups(runtime, image_storage):
    import asyncio
    import base64
    import json
    import httpx
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_video import setup_video, instruction
    from tests.test_generation_canvas_carried_images import reference_field
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '')], can_run=False)
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    source = lambda card, port: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0}
    design = {'id': 'style', 'type': 'direction.style', 'fields': {
        'direction': reference_field(source('a', 'image')),
        'notes': reference_field(source('clip', 'video'), '动作：')}}
    model = doc['cards'][-1]
    model.update(prompt={'segments': [{'id': 'body', 'kind': 'text', 'text': '补充镜头'}]},
        input_bindings=[{'id': 'design', 'source': source('style', 'text'), 'input_port': 'text'}],
        design_media_uses=[{'id': 'portrait', 'source': source('a', 'image'), 'input_port': 'subject_image', 'subject_name': '张三'},
            {'id': 'motion', 'source': source('clip', 'video'), 'input_port': 'subject_video', 'subject_name': '张三'}])
    doc['cards'].insert(-1, design)
    doc['edges'] = [{'id': 'image', 'source_card': 'a', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image'},
        {'id': 'clip', 'source_card': 'clip', 'source_port': 'video', 'target_card': 'style', 'target_port': 'video'},
        {'id': 'design', 'source_card': 'style', 'source_port': 'text', 'target_card': 'v', 'target_port': 'text'}]
    doc['input_order'] = {'style': {'image': ['image'], 'video': ['clip']}, 'v': {'text': ['design']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'carry', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert preview['can_run'], preview
    assert [(group['name'], [item['media_kind'] for item in group['media']]) for group in preview['input']['video_media']['subjects']] == [('张三', ['image', 'video'])]
    model['design_media_uses'][0]['subject_name'] = '李四'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'change', 'expected_revision': 3, 'document': doc})).status_code == 200
    stale = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'stale', 'preview_token': preview['preview_token']})
    assert stale.status_code == 409
    model['design_media_uses'][0]['subject_name'] = '张三'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'restore', 'expected_revision': 4, 'document': doc})).status_code == 200
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'carry-run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    model['design_media_uses'][0]['subject_name'] = '运行后名字'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'later', 'expected_revision': 5, 'document': doc})).status_code == 200
    calls = []
    def provider(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={'task_id': 'carried-video'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert calls[0]['subjects'][0]['name'] == '张三'
    assert calls[0]['subjects'][0]['images'] == ['data:image/png;base64,' + base64.b64encode(b'first-image').decode()]
    assert calls[0]['subjects'][0]['videos'] == ['data:video/mp4;base64,' + base64.b64encode(b'video-with-audio').decode()]
    assert calls[0]['prompt'] == preview['input']['text']


@pytest.mark.asyncio
async def test_carried_audio_is_explicitly_unsupported_not_silently_dropped(canvas_client):
    client = canvas_client
    url, doc, _ = await carried_document(client)
    file_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('sound.wav', b'audio', 'audio/wav')})).json()['data']['id']
    doc['cards'][0].update(type='content.audio', file_id=file_id)
    doc['cards'][1]['fields']['direction']['document']['segments'][1]['source']['port_id'] = 'audio'
    doc['cards'][-1].update(type='model.video', config={'ratio': '16:9'})
    doc['edges'][0].update(source_port='audio', target_port='audio')
    doc['input_order']['style'] = {'audio': ['reference']}
    response = await client.put(url, json={'request_id': 'audio', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert len(compiled['media']) == 1
    assert 'UNSUPPORTED_DESIGN_MEDIA' in {issue['code'] for issue in compiled['diagnostics']}


@pytest.mark.asyncio
async def test_direct_and_carried_video_purposes_share_identity_and_apply_merged_limits(canvas_client):
    from tests.test_generation_canvas_carried_images import reference_field
    client = canvas_client
    url, doc, file_id = await carried_document(client)
    source = lambda card: {'canvas_id': doc['id'], 'card_id': card, 'port_id': 'image', 'position': 0}
    doc['cards'].insert(1, {'id': 'other', 'type': 'content.image', 'file_id': file_id})
    doc['cards'][2]['fields']['notes'] = reference_field(source('other'))
    doc['edges'] += [{'id': 'other', 'source_card': 'other', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image'},
        {'id': 'direct', 'source_card': 'image', 'source_port': 'image', 'target_card': 'model', 'target_port': 'first_frame'}]
    doc['input_order']['style']['image'] = ['other']
    doc['input_order']['model']['first_frame'] = ['direct']
    model = doc['cards'][-1]
    model.update(type='model.video', model_id='canvas-video', config={'ratio': '16:9'},
        design_media_uses=[{'id': 'same', 'source': source('image'), 'input_port': 'first_frame'},
            {'id': 'conflict', 'source': source('other'), 'input_port': 'first_frame'},
            {'id': 'unsupported', 'source': source('other'), 'input_port': 'key_frame'}])
    model['input_bindings'].insert(0, {'id': 'direct', 'source': source('image'), 'input_port': 'first_frame'})
    response = await client.put(url, json={'request_id': 'merged', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    preview = (await client.post(url + '/precheck', json={'card_id': 'model'})).json()['data']
    assert not preview['can_run']
    assert len(preview['input']['media']) == 2, 'two identities survive even when backed by one file'
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    issues = {item['code']: item for item in compiled['diagnostics']}
    assert issues['FRAME_COUNT_EXCEEDED']['target']['path'] == ['design_media_uses', 'conflict']
    assert 'UNSUPPORTED_INPUT' in issues, preview
    assert issues['UNSUPPORTED_INPUT']['target']['path'] == ['design_media_uses', 'unsupported']
    model['design_media_uses'] = model['design_media_uses'][:1]
    doc['cards'][2]['fields']['notes']['state'] = 'empty'
    assert (await client.put(url, json={'request_id': 'reuse', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['can_run'], compiled
    assert len(compiled['media']) == 1
    assert compiled['video_media']['frames']['first']['file_id'] == file_id


@pytest.mark.asyncio
async def test_carried_keyframe_order_rebuilds_field_reference_positions(canvas_client):
    from tests.test_generation_canvas_carried_images import reference_field
    client = canvas_client
    url, doc, file_id = await carried_document(client)
    source = lambda card: {'canvas_id': doc['id'], 'card_id': card, 'port_id': 'image', 'position': 0}
    doc['cards'].insert(1, {'id': 'other', 'type': 'content.image', 'file_id': file_id})
    doc['cards'][2]['fields']['notes'] = reference_field(source('other'), '结尾：')
    doc['edges'].append({'id': 'other', 'source_card': 'other', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image'})
    doc['input_order']['style']['image'] = ['other']
    doc['cards'][-1].update(type='model.video', design_media_uses=[
        {'id': 'ending', 'source': source('other'), 'input_port': 'key_frame'},
        {'id': 'opening', 'source': source('image'), 'input_port': 'key_frame'}])
    assert (await client.put(url, json={'request_id': 'ordered', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '人物参考：关键帧 2' in compiled['text'] and '结尾：关键帧 1' in compiled['text']
