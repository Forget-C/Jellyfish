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


def test_frame_subject_combination_and_group_limits_locate_stable_instruction():
    doc = document([instruction('首帧参考', ['a']), instruction('主体参考', ['b', 'a'], '张三')])
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['text', 'first_frame', 'subject_image'], ratios=['16:9'], max_images_per_subject=1)
    compiled = compile_card(doc, 'v', capability=cap)
    assert not compiled.can_run
    assert {(item.code, item.target['segment_id']) for item in compiled.diagnostics} >= {('UNSUPPORTED_REFERENCE_COMBINATION', '主体参考'), ('SUBJECT_LIMIT_EXCEEDED', '主体参考')}


import asyncio
import base64
import json
import httpx
import pytest
from app.models.llm import Model, Provider
from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


async def setup_video(runtime, provider='volcengine', segments=None, can_run=True):
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
async def test_actual_worker_video_frame_fields_and_every_poll_keep_frozen_route(runtime, image_storage, monkeypatch):
    accepted, preview = await setup_video(runtime)
    assert preview['input']['video_media']['frames']['keys'][0]['file_id'] != preview['input']['video_media']['frames']['first']['file_id']
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
    ('unique', '让 @张三 中的人物转身，保留 [media:1]。', ['张三']),
    ('multiple', '让 @media2 中的人物转身，保留 [media:1]。', ['张三', '李四', 'media2']),
])
async def test_actual_vidu_subject_names_and_literal_surroundings(runtime, image_storage, mode, expected_prompt, names):
    segments = [{'kind': 'text', 'id': 'before', 'text': '让 '}, ref('a', 'body'), {'kind': 'text', 'id': 'after', 'text': ' 中的人物转身，保留 [media:1]。'}]
    if mode != 'implicit':
        segments += [instruction('主体参考', ['a'], '张三'), instruction('主体参考', ['b'], '张三', 'same')]
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
    assert reopened['cards'][-1]['prompt']['segments'] == runtime.document['cards'][-1]['prompt']['segments']


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
