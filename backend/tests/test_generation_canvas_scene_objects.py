"""场次对象引用经公开画布接口读取当前资源，而非固定准备阶段图片。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_scene_reference_tracks_selection_and_keeps_story_identity(canvas_client, canvas_file_store):
    from app.models.studio import Chapter, Character, CharacterImage, FileItem
    from app.models.directing import Sequence
    async with canvas_file_store['sessions'].begin() as db:
        db.add(Chapter(id='chapter', project_id='p', index=1, title='相遇'))
        await db.flush()
        db.add(Character(id='person', project_id='p', name='青年男子', style='真人都市'))
        db.add(Sequence(id='scene', chapter_id='chapter', position=0, title='相遇', source={'kind': 'chapter', 'reference': 'chapter', 'version': '1'},
            object_preparation={'revision': 1, 'objects': [{'id': 'zhang', 'kind': 'character', 'name': '张三', 'asset_id': 'person'}]}))
        db.add_all([FileItem(id='front', type='image', name='正面', storage_key='front'), FileItem(id='new', type='image', name='新图', storage_key='new')])
        await db.flush()
        db.add(CharacterImage(id=100, character_id='person', file_id='front', is_primary=True))
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '动态对象'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 'ref', 'type': 'reference.character', 'name': '张三', 'object_id': 'zhang',
        'scene_object_source': {'sequence_id': 'scene', 'object_id': 'zhang'}}]
    for source_id in ['missing', 'another-project-scene']:
        doc['cards'][0]['scene_object_source']['sequence_id'] = source_id
        rejected = await client.put(url, json={'request_id': source_id, 'expected_revision': 0, 'document': doc})
        assert rejected.status_code == 422
        assert rejected.json()['detail']['code'] == 'INVALID_SCENE_OBJECT_SOURCE'
    doc['cards'][0]['scene_object_source']['sequence_id'] = 'scene'
    saved = await client.put(url, json={'request_id': 'dynamic', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    async def image():
        response = await client.get(url + '/cards/ref/outputs')
        assert response.status_code == 200, response.text
        return response.json()['data']['outputs']
    outputs = await image()
    assert outputs[0]['file_id'] == 'front'
    assert outputs[0]['payload']['name'] == '张三'
    async with canvas_file_store['sessions'].begin() as db:
        slot = await db.get(CharacterImage, 100)
        slot.file_id = 'new'
    assert (await image())[0]['file_id'] == 'new'
    async with canvas_file_store['sessions'].begin() as db:
        scene = await db.get(Sequence, 'scene')
        scene.object_preparation = {'revision': 2, 'objects': [{'id': 'zhang', 'kind': 'character', 'name': '张三', 'asset_id': None}]}
    outputs = await image()
    assert not outputs[0]['available']
    assert outputs[1]['payload']['object_id'] == 'zhang'
    current = (await client.get(url)).json()['data']
    assert current['revision'] == saved.json()['data']['revision']
    assert current['document']['cards'][0]['scene_object_source']['object_id'] == 'zhang'


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['image', 'video'])
async def test_dynamic_image_run_freezes_actual_file_after_selection_is_cleared(runtime, image_storage, modality):
    import asyncio
    import base64
    import httpx
    from app.models.studio import Chapter, Character, CharacterImage, FileItem
    from app.models.directing import Sequence
    from app.task_worker import TaskWorker
    from tests.test_generation_canvas_images import image_card
    await image_card(runtime, 1)
    if modality == 'video':
        from app.models.llm import Model, Provider
        async with runtime.sessions.begin() as db:
            model = await db.get(Model, runtime.model_id)
            model.category, model.name, model.params = 'video', 'doubao-seedance', {}
            provider_config = await db.get(Provider, runtime.provider_id)
            provider_config.name = 'volcengine'
        runtime.document['cards'][0].update(id='video', type='model.video', config={'ratio': '16:9', 'seconds': 5})
    async with runtime.sessions.begin() as db:
        db.add(Chapter(id='chapter', project_id=runtime.project_id, index=1, title='相遇'))
        await db.flush()
        db.add(Character(id='person', project_id=runtime.project_id, name='青年男子', style='真人都市'))
        db.add(Sequence(id='scene', chapter_id='chapter', position=0, title='相遇', source={},
            object_preparation={'revision': 1, 'objects': [{'id': 'zhang', 'kind': 'character', 'asset_id': 'person'}]}))
        db.add(FileItem(id='front', type='image', name='正面', storage_key='reference/front', content_type='image/png'))
        await db.flush()
        db.add(CharacterImage(character_id='person', file_id='front', is_primary=True))
    image_storage['reference/front'] = (b'original-reference', 'image/png', {})
    model_card_id = 'image' if modality == 'image' else 'video'
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'ref', 'port_id': 'image', 'position': 0}
    runtime.document['cards'].append({'id': 'ref', 'type': 'reference.character', 'name': '张三',
        'scene_object_source': {'sequence_id': 'scene', 'object_id': 'zhang'}})
    runtime.document['cards'][0]['prompt'] = {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source}]} if modality == 'image' else {'segments': [{'id': 'first', 'kind': 'instruction', 'command': '首帧参考', 'references': [{'id': 'ref', 'kind': 'reference', 'source': source}]}]}
    port = 'image' if modality == 'image' else 'first_frame'
    runtime.document['edges'] = [{'id': 'ref-image', 'source_card': 'ref', 'source_port': 'image', 'target_card': model_card_id, 'target_port': port}]
    runtime.document['input_order'] = {model_card_id: {port: ['ref-image']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'dynamic-run', 'expected_revision': 2, 'document': runtime.document})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': model_card_id})).json()['data']
    assert preview['can_run'], preview
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'actual', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    async with runtime.sessions.begin() as db:
        scene = await db.get(Sequence, 'scene')
        scene.object_preparation = {'revision': 2, 'objects': [{'id': 'zhang', 'kind': 'character', 'asset_id': None}]}
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'result').decode()}]} if modality == 'image' else {'id': 'dynamic-video'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert base64.b64encode(b'original-reference') in calls[0].content
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = next(run for run in state['runs'] if run['id'] == accepted.json()['data']['run_id'])['nodes'][0]
    assert node['status'] == ('succeeded' if modality == 'image' else 'running'), node
    assert node['basis']['input']['media'][0]['file_id'] == 'front'
    assert not (await runtime.client.post(runtime.url + '/precheck', json={'card_id': model_card_id})).json()['data']['can_run']


from tests.test_generation_canvas_runs import runtime  # noqa: E402,F401
from tests.test_generation_canvas_images import image_storage  # noqa: E402,F401
