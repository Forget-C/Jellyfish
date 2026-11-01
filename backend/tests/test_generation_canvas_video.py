"""Video purpose compilation through the public canvas compiler."""
from app.schemas.generation_canvas import CanvasDocument, CanvasModelCapability, TextContentCard, GenerationCanvasEdge, PromptReference
from app.services.generation_canvas.compiler import compile_card


def document(segments):
    return CanvasDocument.model_validate({'id': 'c', 'project_id': 'p', 'name': 'Video', 'cards': [
        {'id': source, 'type': 'content.image', 'file_id': source} for source in ['a', 'b', 'unused']
    ] + [{'id': 'v', 'type': 'model.video', 'config': {'ratio': '16:9'}, 'prompt': {'segments': segments}}],
        'edges': [{'id': source, 'source_card': source, 'source_port': 'image', 'target_card': 'v', 'target_port': 'subject_image'} for source in ['unused', 'b', 'a']],
        'input_order': {'v': {'subject_image': ['unused', 'b', 'a']}}})


def ref(source, suffix=''):
    return {'kind': 'reference', 'id': source + suffix, 'source': {'canvas_id': 'c', 'card_id': source, 'port_id': 'image', 'position': 0}}


def instruction(command, sources, name=None, suffix=''):
    return {'kind': 'instruction', 'id': command + suffix, 'command': command, 'parameters': {'name': name} if name is not None else {}, 'references': [ref(source, command + suffix) for source in sources]}


def test_video_purposes_preserve_frame_order_and_do_not_require_body_references():
    from app.services.generation_canvas.compiler import video_media
    doc = document([instruction('首帧参考', ['a']), instruction('尾帧参考', ['b']), instruction('关键帧参考', ['a', 'b'])])
    compiled = compile_card(doc, 'v')
    media = video_media(doc, 'v', compiled)
    assert media.model_dump() == {'frames': {'first': {'file_id': 'a', 'media_kind': 'image', 'ordinal': 0},
        'last': {'file_id': 'b', 'media_kind': 'image', 'ordinal': 0}, 'keys': [
            {'file_id': 'a', 'media_kind': 'image', 'ordinal': 0}, {'file_id': 'b', 'media_kind': 'image', 'ordinal': 1}]}, 'subjects': []}
    assert compiled.can_run
    assert [item.file_id for item in compiled.media] == ['b', 'a']


def test_unique_named_subject_preserves_body_and_same_name_coalesces():
    from app.services.generation_canvas.compiler import video_media
    doc = document([{'id': 'before', 'kind': 'text', 'text': '让 '}, ref('a', 'body'),
        {'id': 'after', 'kind': 'text', 'text': ' 中的人物转身。'}, instruction('主体参考', ['a'], '张三'), instruction('主体参考', ['b'], '张三', 'again')])
    compiled = compile_card(doc, 'v')
    assert compiled.text == '让 @张三 中的人物转身。'
    assert [(item.name, [ref.file_id for ref in item.media]) for item in video_media(doc, 'v', compiled).subjects] == [('张三', ['a', 'b'])]


def test_implicit_and_multiple_group_material_keeps_actual_media_alias():
    from app.services.generation_canvas.compiler import video_media
    doc = document([ref('a', 'body'), ref('b', 'body'), instruction('主体参考', ['a'], '甲'), instruction('主体参考', ['a'], '乙', 'second')])
    compiled = compile_card(doc, 'v')
    assert compiled.text == '@media2@media1'
    assert [(item.name, [ref.file_id for ref in item.media]) for item in video_media(doc, 'v', compiled).subjects] == [('甲', ['a']), ('乙', ['a']), ('media1', ['b']), ('media2', ['a'])]


def test_implicit_subject_alias_avoids_later_explicit_name_without_merging_media():
    doc = document([ref('a', 'body'), instruction('主体参考', ['b'], 'media1')])
    doc.input_order['v']['subject_image'] = ['a', 'b', 'unused']
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['subject_image'],
        ratios=['16:9'], max_images_per_subject=1, max_subjects=2)
    compiled = compile_card(doc, 'v', capability=cap)
    assert compiled.can_run, compiled.diagnostics
    assert compiled.text == '@media2'
    assert [(group.name, [item.file_id for item in group.media]) for group in compiled.video_media.subjects] == [
        ('media1', ['b']), ('media2', ['a'])]


def test_multiple_implicit_aliases_avoid_casefolded_explicit_groups_and_keep_shared_media():
    doc = document([ref('a', 'body'), ref('b', 'body'), ref('unused', 'body'),
        instruction('主体参考', ['a'], 'Media2'), instruction('主体参考', ['a'], 'media3', 'second'),
        instruction('主体参考', ['unused'], 'mEdIa1', 'third'), instruction('主体参考', ['unused'], 'MEDIA1', 'same')])
    compiled = compile_card(doc, 'v')
    assert compiled.can_run, compiled.diagnostics
    assert compiled.text == '@media5@media4@mEdIa1'
    assert [(group.name, [item.file_id for item in group.media]) for group in compiled.video_media.subjects] == [
        ('Media2', ['a']), ('media3', ['a']), ('mEdIa1', ['unused']), ('media4', ['b']), ('media5', ['a'])]


def test_frame_subject_combination_and_group_limits_locate_stable_instruction():
    doc = document([instruction('首帧参考', ['a']), instruction('主体参考', ['b', 'a'], '张三')])
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['text', 'first_frame', 'subject_image'], ratios=['16:9'], max_images_per_subject=1)
    compiled = compile_card(doc, 'v', capability=cap)
    assert not compiled.can_run
    assert [item.model_dump() for item in compiled.diagnostics] == [
        {'code': code, 'message': message, 'severity': 'error',
         'target': {'card_id': 'v', 'segment_id': '主体参考', 'path': ['prompt', 'segments', '主体参考']}, 'blocks': ['run']}
        for code, message in [('UNSUPPORTED_REFERENCE_COMBINATION', '当前模型不支持主体与帧参考组合'),
                              ('SUBJECT_LIMIT_EXCEEDED', '主体参考数量超出模型限制')]]


import asyncio
import base64
import json
import httpx
import pytest
from tests.generation_canvas_reference_fixtures import reference_image_sources
from app.models.llm import Model, Provider
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


async def setup_video(runtime, provider='volcengine', segments=None, can_run=True, named=False):
    from app.api.v1.routes.studio.files import router
    runtime.app.include_router(router, prefix='/files')
    files = []
    for name, content, mime in [('a.png', b'first-image', 'image/png'), ('b.png', b'last-image', 'image/png'), ('ref.mp4', b'video-with-audio', 'video/mp4')]:
        result = await runtime.client.post('/files/upload', files={'file': (name, content, mime)}, data={'project_id': runtime.project_id, 'usage_kind': 'canvas_upload', 'source_ref': runtime.canvas_id})
        assert result.status_code == 201, result.text
        files.append(result.json()['data']['id'])
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        model.category, model.name, model.params = 'video', 'viduq2-pro' if provider == 'vidu' else 'doubao-seedance', {}
        selected = await db.get(Provider, runtime.provider_id)
        selected.name = provider
    doc = runtime.document
    doc['cards'] = [{'id': source, 'type': 'content.' + kind, 'file_id': file} for source, kind, file in zip(['a', 'b', 'clip'], ['image', 'image', 'video'], files)] + [
        {'id': 'v', 'type': 'model.video', 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5, 'seed': 7}, 'prompt': {'segments': segments or [instruction('首帧参考', ['a']), instruction('尾帧参考', ['b']), instruction('关键帧参考', ['b', 'a'])]}}]
    # Rebind helper identities to the actual canvas, never use display indices.
    for segment in doc['cards'][-1]['prompt']['segments']:
        for reference in ([segment] if segment['kind'] == 'reference' else segment.get('references', [])):
            reference['source']['canvas_id'] = runtime.canvas_id
    doc['edges'] = [{'id': source, 'source_card': source, 'source_port': kind, 'target_card': 'v', 'target_port': port} for source, kind, port in [('a', 'image', 'first_frame'), ('b', 'image', 'key_frame'), ('clip', 'video', 'subject_video')]]
    if provider == 'vidu':
        doc['edges'] = [{'id': source, 'source_card': source, 'source_port': kind, 'target_card': 'v', 'target_port': port} for source, kind, port in [('a', 'image', 'subject_image'), ('b', 'image', 'subject_image'), ('clip', 'video', 'subject_video')]]
        doc['input_order'] = {'v': {'subject_image': ['b', 'a'], 'subject_video': ['clip']}}
    else:
        doc['edges'] = doc['edges'][:2]
        doc['input_order'] = {'v': {'first_frame': ['a'], 'key_frame': ['b']}}
    if named:
        doc['cards'][0] = {'id': 'a', 'type': 'reference.character', 'name': '小雪正面', 'object_id': 'alice', 'image_binding': {'file_id': files[0]}}
        doc['cards'][1] = {'id': 'b', 'type': 'reference.character', 'name': '小雪侧面', 'object_id': 'alice', 'angle': '侧面', 'image_binding': {'file_id': files[1]}}
    reference_image_sources(doc)
    response = await runtime.client.put(runtime.url, json={'request_id': 'video', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200, response.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert preview['can_run'] is can_run, preview
    if not can_run:
        return preview
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'video-run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    return accepted.json()['data'], preview


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['sqlite', 'mysql'], indirect=True)
@pytest.mark.parametrize('named', [False, True])
async def test_actual_worker_video_frame_fields_and_every_poll_keep_frozen_route(runtime, image_storage, monkeypatch, named):
    accepted, preview = await setup_video(runtime, named=named)
    assert preview['input']['video_media']['frames']['keys'][0]['file_id'] != preview['input']['video_media']['frames']['first']['file_id']
    if named:
        changed = (await runtime.client.get(runtime.url)).json()['data']['document']
        changed['cards'][0]['name'] = '新名字'
        changed['cards'][1]['angle'] = '背面'
        saved = await runtime.client.put(runtime.url, json={'request_id': 'edit-after-acceptance', 'expected_revision': 2, 'document': changed})
        assert saved.status_code == 200, saved.text

    calls = []
    video_bytes = b'complete-video-original-audio-track'
    def provider(request):
        calls.append(request)
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'remote-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=video_bytes, headers={'Content-Type': 'video/mp4'})
        polls = sum(call.method == 'GET' and call.url.host == 'frozen.test' for call in calls)
        return httpx.Response(200, json={'status': 'running'} if polls == 1 else {'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    from datetime import timedelta
    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        await asyncio.sleep(0)
        async with runtime.sessions.begin() as db:
            selected = await db.get(Provider, runtime.provider_id)
            selected.name, selected.base_url, selected.api_key = 'openai', 'https://changed.test', 'changed'
            model = await db.get(Model, runtime.model_id)
            model.name = 'changed'
        clock[0] += timedelta(seconds=1)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        await asyncio.sleep(0)
        clock[0] += timedelta(seconds=10)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 4
    assert [str(call.url) for call in calls[:3]] == ['https://frozen.test/v1/contents/generations/tasks', 'https://frozen.test/v1/contents/generations/tasks/remote-video', 'https://frozen.test/v1/contents/generations/tasks/remote-video']
    assert [call.headers['authorization'] for call in calls[:3]] == ['Bearer private-secret'] * 3
    body = json.loads(calls[0].content)
    if named:
        assert body['content'].pop(0) == {'type': 'text', 'text': '人物·小雪正面 = 首帧（正面）\n人物·小雪正面 = 关键帧 2（正面）\n人物·小雪侧面 = 尾帧（侧面）\n人物·小雪侧面 = 关键帧 1（侧面）'}
    assert body == {'model': 'doubao-seedance', 'ratio': '16:9', 'duration': 5, 'seed': 7, 'content': [
        {'type': 'image_url', 'role': role, 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(value).decode()}} for role, value in [('first_frame', b'first-image'), ('last_frame', b'last-image'), ('key_frame', b'last-image'), ('key_frame', b'first-image')]]}
    assert image_storage['generated/' + accepted['task_ids'][0] + '/0'][0] == video_bytes
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded' and node['result_set_id'] and not node['current_output_updated']
    saved = await runtime.client.get(runtime.url + f"/runs/{accepted['run_id']}/nodes/{node['id']}/outputs/0/content")
    assert saved.status_code == 200, saved.text
    assert saved.json()['data']['type'] == 'content.video'


@pytest.mark.asyncio
@pytest.mark.parametrize(('mode', 'expected_prompt', 'names'), [
    ('implicit', '让 @media1 中的人物转身，保留 [media:1]。', ['media1']),
    ('collision', '让 @media3 中的人物转身，保留 [media:1]。', ['MeDiA2', 'media3']),
    ('unique', '让 @张三 中的人物转身，保留 [media:1]。', ['张三']),
    ('multiple', '让 @media2 中的人物转身，保留 [media:1]。', ['张三', '李四', 'media2']),
])
async def test_actual_vidu_subject_names_and_literal_surroundings(runtime, image_storage, mode, expected_prompt, names):
    segments = [{'kind': 'text', 'id': 'before', 'text': '让 '}, ref('a', 'body'), {'kind': 'text', 'id': 'after', 'text': ' 中的人物转身，保留 [media:1]。'}]
    if mode in ('unique', 'multiple'):
        segments += [instruction('主体参考', ['a'], '张三'), instruction('主体参考', ['b'], '张三', 'same')]
    if mode == 'collision':
        segments += [instruction('主体参考', ['b'], 'MeDiA2')]
    if mode == 'multiple':
        segments += [instruction('主体参考', ['a'], '李四', 'other')]
    accepted, preview = await setup_video(runtime, 'vidu', segments)
    assert preview['input']['text'] == expected_prompt
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'task_id': 'vidu-task'})
    from app.task_worker import TaskWorker
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert len(calls) == 1
    assert str(calls[0].url) == 'https://frozen.test/v1/ent/v2/reference2video'
    body = json.loads(calls[0].content)
    assert body['prompt'] == expected_prompt
    assert [subject['name'] for subject in body['subjects']] == names
    if mode == 'collision':
        assert [subject['images'] for subject in body['subjects']] == [
            ['data:image/png;base64,' + base64.b64encode(value).decode()] for value in (b'last-image', b'first-image')]
        assert [group['name'] for group in preview['input']['video_media']['subjects']] == names
    if mode == 'unique':
        assert body['subjects'][0]['images'] == ['data:image/png;base64,' + base64.b64encode(value).decode() for value in (b'first-image', b'last-image')]
    assert body['model'] == 'viduq2-pro' and body['duration'] == 5 and body['seed'] == 7 and body['aspect_ratio'] == '16:9'
    # A real accepted task remains in the common canvas stream until its provider completes.
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'running'
    assert state['runs'][0]['id'] == accepted['run_id']


def test_expanded_source_text_never_creates_subjects_or_media_mapping():
    doc = document([ref('a', 'body')])
    doc.cards.append(TextContentCard(id='text', text='/主体参考 "fake" @图片2 [media:1]'))
    doc.edges.append(GenerationCanvasEdge(id='textedge', source_card='text', source_port='text', target_card='v', target_port='text'))
    doc.input_order['v']['text'] = ['textedge']
    doc.cards[3].prompt.segments.insert(0, PromptReference(kind='reference', id='expanded', source={'canvas_id': 'c', 'card_id': 'text', 'port_id': 'text', 'position': 0}))
    compiled = compile_card(doc, 'v')
    assert compiled.text == '/主体参考 "fake" @图片2 [media:1]@media1'
    assert [group.name for group in compiled.video_media.subjects] == ['media1']


@pytest.mark.asyncio
@pytest.mark.parametrize(('segments', 'provider', 'code', 'target'), [
    ([instruction('首帧参考', ['a']), instruction('首帧参考', ['b'], suffix='again')], 'volcengine', 'INSTRUCTION_COUNT_EXCEEDED', '首帧参考again'),
    ([instruction('首帧参考', [])], 'volcengine', 'INSTRUCTION_REFERENCE_REQUIRED', '首帧参考'),
    ([instruction('主体参考', ['a'], ' ')], 'vidu', 'INSTRUCTION_PARAMETER_REQUIRED', '主体参考'),
    ([instruction('首帧参考', ['a']), instruction('主体参考', ['b'], '张三')], 'vidu', 'UNSUPPORTED_REFERENCE_COMBINATION', '主体参考'),
])
async def test_invalid_video_instructions_save_but_precheck_blocks_with_stable_target(runtime, image_storage, segments, provider, code, target):
    preview = await setup_video(runtime, provider, segments, can_run=False)
    issue = next(item for item in preview['diagnostics'] if item['code'] == code)
    assert issue['target']['card_id'] == 'v' and issue['target']['segment_id'] == target
    assert issue['blocks'] == ['run'] and not preview['preview_token']
    reopened = (await runtime.client.get(runtime.url)).json()['data']['document']
    actual = reopened['cards'][-1]
    expected = runtime.document['cards'][-1]
    assert [(item['id'], item['command'], item['parameters']) for item in actual['prompt']['segments']] == [
        (item['id'], item['command'], item['parameters']) for item in expected['prompt']['segments']]
    bindings = {binding['id']: binding for binding in actual['input_bindings']}
    assert [bindings[ref['binding_id']]['source'] for item in actual['prompt']['segments'] for ref in item['references']] == [
        ref['source'] for item in expected['prompt']['segments'] for ref in item['references']]


@pytest.mark.asyncio
async def test_video_frame_rejects_video_reference_at_its_saved_instruction(runtime, image_storage):
    segment = instruction('首帧参考', ['clip'])
    segment['references'][0]['source']['port_id'] = 'video'
    preview = await setup_video(runtime, 'vidu', [segment], can_run=False)
    issue = next(item for item in preview['diagnostics'] if item['code'] == 'INSTRUCTION_REFERENCE_TYPE')
    assert issue['target'] == {'card_id': 'v', 'segment_id': '首帧参考', 'path': ['prompt', 'segments', '首帧参考', 'references', 'clip首帧参考']}


def test_seed_outside_standard_video_dto_range_blocks_before_acceptance():
    from app.services.generation_canvas.capabilities import parameter_diagnostics
    doc = document([])
    doc.cards[-1].config.seed = 4294967296
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['text'], ratios=['16:9'], supports_seed=True)
    issues = parameter_diagnostics(doc.cards[-1], cap)
    assert [(item['code'], item['target']['path']) for item in issues] == [('INVALID_PARAMETER', ['config', 'seed'])]


@pytest.mark.asyncio
async def test_saved_video_bindings_alone_are_actual_ordered_frame_inputs(runtime, image_storage):
    initial, _ = await setup_video(runtime)
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    sources = {binding['source']['card_id']: binding['source'] for binding in video['input_bindings']}
    video['prompt'] = {'segments': [{'kind': 'text', 'id': 'body', 'text': 'Keep original motion.'}]}
    video['input_bindings'] = [
        {'id': 'key-b', 'source': sources['b'], 'input_port': 'key_frame'},
        {'id': 'key-a', 'source': sources['a'], 'input_port': 'key_frame'},
        {'id': 'first-a', 'source': sources['a'], 'input_port': 'first_frame'},
    ]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'binding-frames', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert preview['can_run'], preview
    frames = preview['input']['video_media']['frames']
    assert frames['first']['file_id'] == doc['cards'][0]['file_id']
    assert [item['file_id'] for item in frames['keys']] == [doc['cards'][1]['file_id'], doc['cards'][0]['file_id']]
    await runtime.client.post(runtime.url + f"/runs/{initial['run_id']}/cancel")
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'canonical-run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    # Editing after acceptance must not change the actual provider request.
    video['input_bindings'] = []
    await runtime.client.put(runtime.url, json={'request_id': 'after-accept', 'expected_revision': 3, 'document': doc})
    requests = []
    def provider(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'id': 'canonical-video'})
    from app.task_worker import TaskWorker
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        await worker.tick()
        await asyncio.gather(*worker.jobs.values())
        worker.text_pool.shutdown(wait=False)
    assert [item.get('role') for item in requests[0]['content']] == [None, 'first_frame', 'key_frame', 'key_frame']
    assert requests[0]['content'][0] == {'type': 'text', 'text': 'Keep original motion.'}
    assert [item['image_url']['url'] for item in requests[0]['content'][1:]] == [
        'data:image/png;base64,' + base64.b64encode(value).decode() for value in (b'first-image', b'last-image', b'first-image')]


@pytest.mark.asyncio
async def test_subject_binding_requires_explicit_group_and_preserves_video_usage(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '演员')])
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    video['prompt'] = {'segments': []}
    video['input_bindings'] = [{'id': 'video-subject', 'source': {'canvas_id': runtime.canvas_id, 'card_id': 'clip', 'port_id': 'video', 'position': 0},
        'input_port': 'subject_video', 'subject_name': '演员'}]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'binding-subject', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert preview['can_run'], preview
    assert preview['input']['video_media']['subjects'] == [{'name': '演员', 'media': [{'file_id': doc['cards'][2]['file_id'], 'media_kind': 'video', 'ordinal': 0}]}]
    video['input_bindings'][0]['subject_name'] = ''
    saved = await runtime.client.put(runtime.url, json={'request_id': 'missing-group', 'expected_revision': 3, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert not preview['can_run']
    assert any(item['code'] == 'SUBJECT_NAME_REQUIRED' and item['target']['path'] == ['input_bindings', 'video-subject'] for item in preview['diagnostics'])


@pytest.mark.asyncio
async def test_duplicate_frame_bindings_and_subject_limits_locate_bindings(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '演员')])
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    video['prompt'] = {'segments': []}
    image = {'canvas_id': runtime.canvas_id, 'card_id': 'a', 'port_id': 'image', 'position': 0}
    video['input_bindings'] = [{'id': 'first', 'source': image, 'input_port': 'first_frame'},
        {'id': 'duplicate', 'source': image, 'input_port': 'first_frame'},
        {'id': 'subject', 'source': image, 'input_port': 'subject_image', 'subject_name': '演员'}]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'duplicate-bindings', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert not preview['can_run']
    assert preview['diagnostics'] == [
        {'code': code, 'message': message, 'severity': 'error',
         'target': {'card_id': 'v', 'segment_id': binding, 'path': ['input_bindings', binding]}, 'blocks': ['run']}
        for code, message, binding in [('FRAME_COUNT_EXCEEDED', '首尾帧各至多一项', 'duplicate'),
                                       ('UNSUPPORTED_REFERENCE_COMBINATION', '当前模型不支持主体与帧参考组合', 'subject')]]


@pytest.mark.asyncio
async def test_subject_usage_is_saved_on_binding_and_binding_name_is_authoritative(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '演员')])
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    assert video['input_bindings'][0]['subject_name'] == '演员'
    video['input_bindings'][0]['subject_name'] = '替身'
    saved = await runtime.client.put(runtime.url, json={'request_id': 'group-binding', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert [subject['name'] for subject in compiled['video_media']['subjects']] == ['替身']
    video['prompt']['segments'][0]['parameters']['name'] = ''
    saved = await runtime.client.put(runtime.url, json={'request_id': 'legacy-empty-name', 'expected_revision': 3, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert compiled['can_run'], 'canonical group remains valid without a second name in prompt parameters'
    video['input_bindings'][0]['subject_name'] = ''
    saved = await runtime.client.put(runtime.url, json={'request_id': 'clear-group-binding', 'expected_revision': 4, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert not compiled['can_run'], 'legacy instruction name cannot replace a cleared canonical group'


@pytest.mark.asyncio
async def test_video_binding_cannot_implicitly_convert_clip_to_frame(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '演员')])
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    video['prompt'] = {'segments': []}
    video['input_bindings'] = [{'id': 'clip-as-frame', 'source': {'canvas_id': runtime.canvas_id, 'card_id': 'clip', 'port_id': 'video', 'position': 0}, 'input_port': 'first_frame'}]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'no-conversion', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'v'})).json()['data']
    assert not preview['can_run']
    assert any(item['code'] == 'INPUT_BINDING_TYPE' and item['target']['path'] == ['input_bindings', 'clip-as-frame'] for item in preview['diagnostics'])


@pytest.mark.asyncio
async def test_body_reference_to_adopted_frame_does_not_change_its_video_purpose(runtime, image_storage):
    await setup_video(runtime)
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    first = next(binding for binding in video['input_bindings'] if binding['input_port'] == 'first_frame')
    video['input_bindings'] = [first]
    video['prompt'] = {'segments': [{'id': 'frame-in-body', 'kind': 'reference', 'binding_id': first['id']}]}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'body-frame', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert compiled['can_run'], compiled
    assert compiled['video_media']['subjects'] == []
    assert compiled['video_media']['frames']['first']['file_id'] == doc['cards'][0]['file_id']


@pytest.mark.asyncio
async def test_legacy_shared_subject_binding_preserves_multiple_explicit_groups(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a'], '甲')])
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = doc['cards'][-1]
    binding = video['input_bindings'][0]
    binding.pop('subject_name')
    # Old v2 coalesced the same source/purpose into one binding even across names.
    video['prompt']['segments'] += [{'id': 'second-group', 'kind': 'instruction', 'command': '主体参考', 'parameters': {'name': '乙'},
        'references': [{'id': 'second-ref', 'kind': 'reference', 'binding_id': binding['id']}]},
        {'id': 'body-ref', 'kind': 'reference', 'binding_id': binding['id']}]
    saved = await runtime.client.put(runtime.url, json={'request_id': 'legacy-shared-group', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert compiled['can_run'], compiled
    assert [group['name'] for group in compiled['video_media']['subjects']] == ['甲', '乙', 'media1']
    assert compiled['text'] == '@media1'


def test_repeated_key_frames_keep_each_binding_position():
    doc = document([instruction('关键帧参考', ['a', 'b'])])
    bindings = doc.cards[-1].input_bindings
    bindings.insert(1, bindings[0].model_copy(update={'id': 'repeat-a'}))
    compiled = compile_card(doc, 'v')
    assert [(item.file_id, item.ordinal) for item in compiled.video_media.frames.keys] == [('a', 0), ('a', 1), ('b', 2)]
    assert [item.file_id for item in compiled.media] == ['b', 'a']
    assert compiled.diagnostics == []


def test_missing_subject_output_keeps_candidate_token_and_full_diagnostic():
    doc = document([instruction('主体参考', ['b', 'a', 'unused'], '演员')])
    card = doc.cards[-1]
    missing = next(binding for binding in card.input_bindings if binding.source.card_id == 'a')
    missing.source.position = 1
    doc.input_order['v']['subject_image'] = ['unused', 'a', 'b']
    compiled = compile_card(doc, 'v')
    assert [(item.token, item.media_position) for item in compiled.mapping] == [('@图片1', 1), ('@图片4', 2)]
    assert [(item.file_id, item.ordinal) for item in compiled.video_media.subjects[0].media] == [('b', 0), ('unused', 1)]
    assert [item.model_dump() for item in compiled.diagnostics] == [
        {'code': 'OUTPUT_MISSING', 'message': '引用的来源位置暂无实际输出', 'severity': 'error',
         'target': {'card_id': 'v', 'segment_id': 'a主体参考', 'path': ['prompt', 'segments', '主体参考', 'references', 'a主体参考']}, 'blocks': ['run']}]
    assert not compiled.can_run


@pytest.mark.asyncio
async def test_mixed_subject_media_keeps_image_mapping_and_dto_ordinals(runtime, image_storage):
    await setup_video(runtime, 'vidu', [instruction('主体参考', ['a', 'b'], '演员')], named=True)
    doc = (await runtime.client.get(runtime.url)).json()['data']['document']
    video = next(card for card in doc['cards'] if card['id'] == 'v')
    old = {binding['source']['card_id']: binding for binding in video['input_bindings']}
    video['input_bindings'] = [old['a'], {'id': 'clip-subject', 'input_port': 'subject_video', 'subject_name': '演员',
        'source': {'canvas_id': runtime.canvas_id, 'card_id': 'clip', 'port_id': 'video', 'position': 0}}, old['b']]
    video['prompt'] = {'segments': [{'id': 'body', 'kind': 'reference', 'binding_id': old['b']['id']}]}
    saved = await runtime.client.put(runtime.url, json={'request_id': 'mixed-subject', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    files = {card['id']: card['image_binding']['file_id'] if 'image_binding' in card else card.get('file_id') for card in doc['cards']}
    assert [(item['file_id'], item['ordinal']) for item in compiled['video_media']['subjects'][0]['media']] == [
        (files['a'], 0), (files['clip'], 1), (files['b'], 2)]
    mappings = compiled['mapping']
    assert [(item['token'], item['media_position']) for item in mappings if 'token' in item] == [('@图片1', 1), ('@图片2', 2), ('@视频1', 3)]
    assert [(item['media_position'], item['purpose_position']) for item in mappings if 'object_id' in item] == [(1, 2), (2, 1)]
    assert compiled['text'] == '@演员\n人物·小雪侧面 = @演员 图片 2（侧面）\n人物·小雪正面 = @演员 图片 1（正面）'
    assert compiled['diagnostics'] == []

    video['input_bindings'][0]['input_port'] = 'subject_video'
    saved = await runtime.client.put(runtime.url, json={'request_id': 'wrong-purpose', 'expected_revision': 3, 'document': doc})
    assert saved.status_code == 200, saved.text
    invalid = (await runtime.client.get(runtime.url + '/cards/v/compile')).json()['data']
    assert [(item['input_port'], item['purpose_position']) for item in invalid['mapping'] if 'object_id' in item] == [('subject_image', 1), ('subject_video', 1)]
    assert invalid['diagnostics'] == [{'code': 'INPUT_BINDING_TYPE', 'message': '输入用途与来源类型不匹配，不提供隐式转换',
        'severity': 'error', 'target': {'card_id': 'v', 'segment_id': old['a']['id'], 'path': ['input_bindings', old['a']['id']]}, 'blocks': ['run']}]
    assert not invalid['can_run']


def test_automatic_subject_limit_keeps_body_fallback_diagnostic_order():
    doc = document([ref('a', 'body'), instruction('主体参考', ['a'], '甲'), instruction('主体参考', ['a'], '乙', 'second')])
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['subject_image'], ratios=['16:9'], max_subjects=0)
    compiled = compile_card(doc, 'v', capability=cap)
    assert compiled.text == '@media1'
    assert [item.model_dump() for item in compiled.diagnostics] == [
        {'code': 'SUBJECT_LIMIT_EXCEEDED', 'message': '主体参考数量超出模型限制', 'severity': 'error',
         'target': {'card_id': 'v', 'segment_id': segment, 'path': ['prompt', 'segments', segment]}, 'blocks': ['run']}
        for segment in ['主体参考', '主体参考second', 'abody']]
    assert not compiled.can_run
