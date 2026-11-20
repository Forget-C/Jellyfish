"""场次对象引用经公开画布接口读取当前资源，而非固定准备阶段图片。"""
from tests.canvas_prompt_fixtures import bind_document_prompts
from tests.canvas_urls import canvas_url, seed_scene_canvas
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
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '动态对象'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
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
    assert next(item for item in outputs if item['source']['port_id'] == 'object')['payload']['object_id'] == 'zhang'
    current = (await client.get(url)).json()['data']
    assert current['revision'] == saved.json()['data']['revision']
    assert current['document']['cards'][0]['scene_object_source']['object_id'] == 'zhang'


@pytest.mark.asyncio
@pytest.mark.parametrize('position', [0, 2])
@pytest.mark.parametrize('modality', ['image', 'video'])
async def test_dynamic_image_run_freezes_actual_file_after_selection_is_cleared(runtime, image_storage, modality, position):
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
        db.add(CharacterImage(character_id='person', file_id='front', is_primary=True, view_angle='LEFT', is_view_default=True))
    image_storage['reference/front'] = (b'original-reference', 'image/png', {})
    model_card_id = 'image' if modality == 'image' else 'video'
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'ref', 'port_id': 'image', 'position': position}
    runtime.document['cards'].append({'id': 'ref', 'type': 'reference.character', 'name': '张三',
        'scene_object_source': {'sequence_id': 'scene', 'object_id': 'zhang'}})
    runtime.document['cards'][0]['prompt'] = {'segments': [{'id': 'ref', 'kind': 'reference', 'source': source}]} if modality == 'image' else {'segments': [{'id': 'first', 'kind': 'instruction', 'command': '首帧参考', 'references': [{'id': 'ref', 'kind': 'reference', 'source': source}]}]}
    port = 'image' if modality == 'image' else 'first_frame'
    runtime.document['edges'] = [{'id': 'ref-image', 'source_card': 'ref', 'source_port': 'image', 'target_card': model_card_id, 'target_port': port}]
    runtime.document['input_order'] = {model_card_id: {port: ['ref-image']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'dynamic-run', 'expected_revision': 2, 'document': bind_document_prompts(runtime.document)})
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


@pytest.mark.asyncio
async def test_scene_reference_publishes_stable_angle_positions(canvas_client, canvas_file_store):
    from app.models.studio import Chapter, Character, CharacterImage, FileItem
    from app.models.directing import Sequence
    async with canvas_file_store['sessions'].begin() as db:
        db.add(Chapter(id='angles-chapter', project_id='p', index=1, title='视角'))
        await db.flush()
        db.add(Character(id='angles-person', project_id='p', name='青年男子', style='真人都市'))
        db.add(Sequence(id='angles-scene', chapter_id='angles-chapter', position=0, title='视角', source={},
            object_preparation={'revision': 1, 'objects': [{'id': 'zhang', 'kind': 'character', 'name': '张三', 'asset_id': 'angles-person'}]}))
        db.add_all([FileItem(id=name, type='image', name=name, storage_key=name) for name in ['main', 'front', 'left']])
        await db.flush()
        db.add_all([CharacterImage(character_id='angles-person', file_id='main', view_angle='BACK', is_primary=True),
                    CharacterImage(character_id='angles-person', file_id='front', view_angle='FRONT', is_view_default=True),
                    CharacterImage(character_id='angles-person', file_id='left', view_angle='LEFT', is_view_default=True)])
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '多角度'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    document = canvas['document']
    document['cards'] = [{'id': 'ref', 'type': 'reference.character', 'name': '张三',
        'scene_object_source': {'sequence_id': 'angles-scene', 'object_id': 'zhang'}}]
    saved = await canvas_client.put(url, json={'request_id': 'angles', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    outputs = (await canvas_client.get(url + '/cards/ref/outputs')).json()['data']['outputs']
    images = {item['source']['position']: item for item in outputs if item['modality'] == 'image'}
    assert len(images) == 8
    assert [images[i]['file_id'] for i in [0, 1, 2]] == ['main', 'front', 'left']
    assert images[2]['payload']['angle'] == '左侧'
    assert images[0]['payload']['objects'][0]['object_id'] == images[2]['payload']['objects'][0]['object_id'] == 'zhang'
    assert not images[3]['available']
    assert images[3]['file_id'] is None


@pytest.mark.asyncio
async def test_multiple_dynamic_views_keep_one_story_object_and_missing_view_blocks(runtime):
    from app.models.studio import Chapter, Character, CharacterImage, FileItem
    from app.models.directing import Sequence
    from tests.test_generation_canvas_images import image_card
    await image_card(runtime, 1)
    async with runtime.sessions.begin() as db:
        db.add(Chapter(id='chapter', project_id=runtime.project_id, index=1, title='相遇'))
        await db.flush()
        db.add(Character(id='person', project_id=runtime.project_id, name='资源-左侧', style='真人都市'))
        db.add(Sequence(id='scene', chapter_id='chapter', position=0, title='相遇', source={},
            object_preparation={'revision': 1, 'objects': [{'id': 'zhang', 'kind': 'character', 'asset_id': 'person'}]}))
        db.add_all([FileItem(id=name, type='image', name=name, storage_key=name) for name in ['main', 'left']])
        await db.flush()
        db.add_all([CharacterImage(id=101, character_id='person', file_id='main', is_primary=True),
                    CharacterImage(id=102, character_id='person', file_id='left', view_angle='LEFT', is_view_default=True)])
    document = runtime.document
    document['cards'].append({'id': 'ref', 'type': 'reference.character', 'name': '张三',
        'scene_object_source': {'sequence_id': 'scene', 'object_id': 'zhang'}})
    document['cards'][0]['prompt'] = {'segments': [{'id': f'r{pos}', 'kind': 'reference', 'source': {
        'canvas_id': runtime.canvas_id, 'card_id': 'ref', 'port_id': 'image', 'position': pos}} for pos in [0, 2]]}
    document['edges'] = [{'id': 'ref-image', 'source_card': 'ref', 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'}]
    document['input_order'] = {'image': {'image': ['ref-image']}}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'multiple', 'expected_revision': 2, 'document': bind_document_prompts(document)})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/image/compile')).json()['data']
    assert compiled['can_run'], compiled
    assert [item['file_id'] for item in compiled['media']] == ['main', 'left']
    assert {item['object_id'] for item in compiled['mapping'] if 'object_id' in item} == {'zhang'}
    from app.core.integrations.image_capabilities import ImageModelCapability, register_image_model_capability, clear_image_model_capability_overrides
    register_image_model_capability(provider='openai', model_prefix='image-model', capability=ImageModelCapability(max_reference_images=1))
    try:
        limited = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'image'})).json()['data']
        assert not limited['can_run']
        assert 'REFERENCE_COUNT_EXCEEDED' in {item['code'] for item in limited['diagnostics']}
        assert len(limited['input']['media']) == 2
    finally:
        clear_image_model_capability_overrides(provider='openai')
    async with runtime.sessions.begin() as db:
        slot = await db.get(CharacterImage, 102)
        slot.is_view_default = False
    missing = (await runtime.client.get(runtime.url + '/cards/image/compile')).json()['data']
    assert not missing['can_run']
