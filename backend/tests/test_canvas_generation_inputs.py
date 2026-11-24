"""普通后端通过公开协议核对已采用输入，无需助手会话或模型执行。"""

import pytest

from app.models.llm import Model, Provider
from app.models.studio import FileItem
from app.schemas.generation_canvas import CanvasPrecheckRequest
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.task_service import utcnow
from tests.canvas_urls import seed_scene_canvas
from tests.generation_canvas_reference_fixtures import reference_image_sources
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('scene', [False, True])
async def test_compile_video_with_inline_or_adopted_text_and_selected_subject(canvas_client, scene):
    async with canvas_client.canvas_sessions.begin() as db:
        db.add(Provider(id='vidu', provider_key='vidu', name='Vidu', base_url='https://video.test', api_key='fixture'))
        await db.flush()
        model = await db.get(Model, 'canvas-video')
        model.name, model.provider_id = 'viduq2-pro', 'vidu'

    creation = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '镜头'})
                if scene else await canvas_client.post('/canvases', json={'name': '镜头'}))
    canvas = creation.json()['data']
    canvas_id = canvas['id']
    path = f'/canvases/{canvas_id}'
    project = 'p' if scene else None
    params = {'project_id': project} if project else {}
    document = canvas['document']

    def output(card, port):
        return {'canvas_id': canvas_id, 'card_id': card, 'port_id': port, 'position': 0}

    file_ids = {}
    for face in ('selected', 'alternative'):
        uploaded = await canvas_client.post('/files/upload',
            data={'usage_kind': 'canvas_upload', 'source_ref': canvas_id, **params},
            files={'file': (f'{face}.png', b'image', 'image/png')})
        assert uploaded.status_code == 201, uploaded.text
        file_ids[face] = uploaded.json()['data']['id']
        document['cards'].append({'type': 'reference.character', 'id': face, 'name': face,
                                  'image_binding': {'file_id': file_ids[face]}})

    def link(source, port, target, input_port):
        edge = f'{source}-{target}-{input_port}'
        document['edges'].append({'id': edge, 'source_card': source, 'source_port': port,
                                  'target_card': target, 'target_port': input_port})
        document.setdefault('input_order', {}).setdefault(target, {}).setdefault(input_port, []).append(edge)

    document['cards'].append({'type': 'content.text', 'id': 'description', 'text': '晨光拉远'})
    for card_id, segment in (
        ('direct', {'kind': 'text', 'id': 'body', 'text': '雨夜推镜'}),
        ('referenced', {'kind': 'reference', 'id': 'body', 'source': output('description', 'text'),
                        'binding_id': 'body-text'}),
    ):
        bindings = [{'id': f'{card_id}-face', 'source': output('selected', 'image'),
                     'input_port': 'subject_image', 'subject_name': '小雪'}]
        if card_id == 'referenced':
            bindings.append({'id': 'body-text', 'source': output('description', 'text'),
                             'input_port': 'text', 'prompt_owned': True})
            link('description', 'text', card_id, 'text')
        document['cards'].append({'type': 'model.video', 'id': card_id, 'model_id': 'canvas-video',
                                  'config': {'ratio': '16:9', 'seconds': 5},
                                  'prompt': {'segments': [segment]}, 'input_bindings': bindings})
        link('selected', 'image', card_id, 'subject_image')
        link('alternative', 'image', card_id, 'subject_image')
    reference_image_sources(document)
    saved = await canvas_client.put(path, params=params, json={
        'expected_revision': canvas['revision'], 'request_id': 'fixture', 'document': document,
    })
    assert saved.status_code == 200, saved.text

    async with canvas_client.canvas_sessions.begin() as db:
        inputs = canvas_generation_inputs(db, project)
        for card_id, text in [('direct', '雨夜推镜'), ('referenced', '晨光拉远')]:
            compiled = await inputs.compile_input(canvas_id, card_id)
            assert compiled.can_run, compiled.diagnostics
            assert compiled.text.count(text) == 1
            assert compiled.video_media is not None
            assert [(subject.name, [media.file_id for media in subject.media])
                    for subject in compiled.video_media.subjects] == [('小雪', [file_ids['selected']])]
            precheck = await inputs.precheck(canvas_id, CanvasPrecheckRequest(card_id=card_id))
            assert precheck.preview_token and precheck.input.text == compiled.text, precheck.diagnostics

    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-video')
        model.name, model.provider_id = 'sora-2', 'canvas-provider'
    async with canvas_client.canvas_sessions() as db:
        blocked = await canvas_generation_inputs(db, project).compile_input(canvas_id, 'direct')
        assert not blocked.can_run
        unsupported = next(item for item in blocked.diagnostics if item.code == 'UNSUPPORTED_INPUT')
        assert unsupported.target['path'] == ['input_bindings', 'direct-face']

    snapshot = await canvas_client.get(path + '/runtime', params=params)
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()['data']['runs'] == []


@pytest.mark.asyncio
async def test_text_and_image_inputs_report_unavailable_media_without_submission(canvas_client):
    canvas = (await canvas_client.post('/canvases', json={'name': '模型输入'})).json()['data']
    canvas_id = canvas['id']
    path = f'/canvases/{canvas_id}'
    uploaded = await canvas_client.post('/files/upload',
        data={'usage_kind': 'canvas_upload', 'source_ref': canvas_id},
        files={'file': ('frame.png', b'image', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    source = {'canvas_id': canvas_id, 'card_id': 'picture', 'port_id': 'image', 'position': 0}
    prompt = {'segments': [{'kind': 'text', 'id': 'body', 'text': '请保留晨光氛围'}]}
    document = canvas['document']
    document.update(cards=[
        {'type': 'content.image', 'id': 'picture', 'file_id': file_id},
        {'type': 'model.text', 'id': 'text', 'model_id': 'canvas-text', 'prompt': prompt},
        {'type': 'model.image', 'id': 'image', 'model_id': 'canvas-image', 'prompt': prompt,
         'input_bindings': [{'id': 'use-picture', 'source': source, 'input_port': 'image'}]},
    ], edges=[
        {'id': 'edge', 'source_card': 'picture', 'source_port': 'image', 'target_card': 'image', 'target_port': 'image'},
    ], input_order={'image': {'image': ['edge']}})
    saved = await canvas_client.put(path, json={
        'expected_revision': canvas['revision'], 'request_id': 'fixture', 'document': document,
    })
    assert saved.status_code == 200, saved.text

    async with canvas_client.canvas_sessions() as db:
        inputs = canvas_generation_inputs(db, None)
        text = await inputs.compile_input(canvas_id, 'text')
        assert text.can_run and text.text == '请保留晨光氛围' and not text.media
        image = await inputs.compile_input(canvas_id, 'image')
        assert image.can_run and image.text.startswith('请保留晨光氛围')
        assert [item.file_id for item in image.media] == [file_id]

    # 外部素材库撤回文件后，已保存的采用关系仍需给出明确诊断。
    async with canvas_client.canvas_sessions.begin() as db:
        (await db.get(FileItem, file_id)).delete_requested_at = utcnow()
    async with canvas_client.canvas_sessions() as db:
        image = await canvas_generation_inputs(db, None).compile_input(canvas_id, 'image')
        assert not image.can_run and not image.media
        missing = next(item for item in image.diagnostics if item.code == 'OUTPUT_MISSING')
        assert missing.target['path'] == ['input_bindings', 'use-picture']

    assert (await canvas_client.get(path + '/runtime')).json()['data']['runs'] == []
