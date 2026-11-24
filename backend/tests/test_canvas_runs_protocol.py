"""普通后端调用方使用双画布的编辑、生成输入、运行和回执协议。"""

import asyncio
import json
from datetime import timedelta

import httpx
import pytest

from app.models.llm import Model, Provider
from app.schemas.generation_canvas import (
    CanvasPrecheckRequest, CanvasRunSubmit, GenerationCanvasEdge, ImageContentCard, NamedImageReferenceCard,
    TextContentCard, VideoModelCard,
)
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
from app.services.generation_canvas.lifecycle import canvas_lifecycle
from app.services.task_service import utcnow
from app.task_worker import TaskWorker
from tests.canvas_urls import seed_scene_canvas
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('project_id', [None, 'p'])
async def test_run_one_edited_shot_and_recover_original_receipt(canvas_client, image_storage, monkeypatch, project_id):
    from app.services.generation_canvas.runs import canvas_runs

    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-video')
        provider = await db.get(Provider, model.provider_id)
        provider.provider_key, provider.api_key = 'vidu', 'fixture'
        model.name = 'viduq2-pro'

    created = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '双镜头'})
               if project_id else await canvas_client.post('/canvases', json={'name': '双镜头'}))
    canvas_id = created.json()['data']['id']
    uploaded = await canvas_client.post('/files/upload',
        data={'usage_kind': 'canvas_upload', 'source_ref': canvas_id, **({'project_id': project_id} if project_id else {})},
        files={'file': ('subject.png', b'subject-image', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    source = {'canvas_id': canvas_id, 'card_id': 'description', 'port_id': 'text', 'position': 0}
    subject_source = {'canvas_id': canvas_id, 'card_id': 'character', 'port_id': 'image', 'position': 0}
    character = NamedImageReferenceCard.model_validate({
        'id': 'character', 'type': 'reference.character', 'name': '小雪', 'image_binding': {'file_id': file_id, 'source': {
            'canvas_id': canvas_id, 'card_id': 'character-image', 'port_id': 'image', 'position': 0,
        }},
    })
    direct = VideoModelCard.model_validate({
        'id': 'direct', 'model_id': 'canvas-video', 'config': {'ratio': '16:9', 'seconds': 5},
        'prompt': {'segments': [{'id': 'body', 'kind': 'text', 'text': '雨夜推镜'}]},
    })
    referenced = VideoModelCard.model_validate({
        'id': 'referenced', 'model_id': 'canvas-video', 'config': {'ratio': '16:9', 'seconds': 5},
        'prompt': {'segments': [{'kind': 'reference', 'id': 'body', 'source': source, 'binding_id': 'body-binding'}]},
        'input_bindings': [
            {'id': 'body-binding', 'source': source, 'input_port': 'text', 'prompt_owned': True},
            {'id': 'character-binding', 'source': subject_source, 'input_port': 'subject_image', 'subject_name': '小雪'},
        ],
    })
    async with canvas_client.canvas_sessions.begin() as db:
        edits = canvas_edits(db, project_id)
        proposal = await edits.preview(canvas_id, [
            CanvasEditGroup(id='first-shot', cards=[direct]),
            CanvasEditGroup(id='second-shot',
                cards=[TextContentCard(id='description', text='晨光拉远'), character,
                       ImageContentCard(id='character-image', file_id=file_id), referenced],
                edges=[
                    GenerationCanvasEdge(id='description-link', source_card='description', source_port='text',
                                         target_card='referenced', target_port='text'),
                    GenerationCanvasEdge(id='image-link', source_card='character-image', source_port='image',
                                         target_card='character', target_port='image_source'),
                    GenerationCanvasEdge(id='subject-link', source_card='character', source_port='image',
                                         target_card='referenced', target_port='subject_image'),
                ]),
        ])
        receipt = await edits.submit(proposal, request_id='edit-two-shots')
        assert [group.state for group in receipt.groups] == ['applied', 'applied']
        repeat = await edits.submit(proposal, request_id='repeat-edit')
        assert [group.state for group in repeat.groups] == ['no_change', 'no_change']
        stored = (await canvas_lifecycle(db, project_id).read(canvas_id)).document
        assert [(c.id, len(c.input_bindings)) for c in stored.cards if isinstance(c, VideoModelCard)] == [
            ('direct', 0), ('referenced', 2)]
        inputs = canvas_generation_inputs(db, project_id)
        assert (await inputs.compile_input(canvas_id, 'direct')).text.count('雨夜推镜') == 1
        preview = await inputs.precheck(canvas_id, CanvasPrecheckRequest(card_id='referenced'))
        assert preview.preview_token and preview.input.text.count('晨光拉远') == 1
        [subject] = preview.input.video_media.subjects
        assert subject.name == '小雪' and [media.file_id for media in subject.media] == [file_id]
        command = CanvasRunSubmit(request_id='run-second-shot', preview_token=preview.preview_token)
        runtime = canvas_runs(db, project_id)
        cursor = (await runtime.snapshot(canvas_id)).cursor
        assert await runtime.read_receipt(canvas_id, command.request_id) is None
        await runtime.submit(canvas_id, command)

    # 模拟提交已提交事务、调用方未收到响应，以已知请求标识读取原受理结果。
    async with canvas_client.canvas_sessions.begin() as db:
        runtime = canvas_runs(db, project_id)
        accepted = await runtime.read_receipt(canvas_id, command.request_id)
        assert accepted and len(accepted.task_ids) == 1
        assert await runtime.submit(canvas_id, command) == accepted
        task = await runtime.read_task_run(canvas_id, accepted.task_ids[0])
        assert task.id == accepted.run_id and task.nodes[0].card_id == 'referenced'
        assert task.nodes[0].status == 'queued'
        events = await runtime.read_events(canvas_id, cursor)
        assert any(event.run_id == accepted.run_id for event in events)

    submissions = []

    def provider_reply(request):
        if request.method == 'POST':
            submissions.append(json.loads(request.content))
            return httpx.Response(200, json={'task_id': 'remote-task'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'video', headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'state': 'success', 'creations': [{'url': 'https://media.test/run.mp4'}]})

    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider_reply)) as client:
        worker = TaskWorker(canvas_client.canvas_sessions, client=client)
        try:
            for _ in range(2):
                await worker.tick()
                await asyncio.gather(*worker.jobs.values())
                await asyncio.sleep(0)
                clock[0] += timedelta(seconds=30)
        finally:
            worker.text_pool.shutdown(wait=False)

    assert len(submissions) == 1 and submissions[0]['prompt'].count('晨光拉远') == 1
    assert submissions[0]['subjects'] == [{'name': '小雪', 'images': ['data:image/png;base64,c3ViamVjdC1pbWFnZQ==']}]
    assert image_storage['generated/' + accepted.task_ids[0] + '/0'][0] == b'video'
    async with canvas_client.canvas_sessions.begin() as db:
        runtime = canvas_runs(db, project_id)
        assert await runtime.read_receipt(canvas_id, command.request_id) == accepted
        finished = await runtime.read_task_run(canvas_id, accepted.task_ids[0])
        node = finished.nodes[0]
        assert finished.lifecycle == 'finished' and node.status == 'succeeded', node
        output = await runtime.prepare_output_content(canvas_id, finished.id, node.id, 0)
        assert output.type == 'content.video' and output.file_id
        assert [run.id for run in (await runtime.snapshot(canvas_id)).runs] == [accepted.run_id]
