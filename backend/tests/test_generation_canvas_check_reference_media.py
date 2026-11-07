"""P03 observes adopted reference media through public canvas and worker boundaries."""
import asyncio
import base64
import json
import struct
import zlib

import httpx
import pytest

from app.models.llm import Model, Provider
from app.models.studio import FileItem
from app.services.studio.file_usages import upsert_file_usage
from app.task_worker import TaskWorker
from tests.test_generation_canvas_carried_images import reference_field
from tests.test_generation_canvas_checks import connect_check, save_canvas
from tests.test_generation_canvas_images import image_storage  # noqa: F401
from tests.test_generation_canvas_runs import runtime  # noqa: F401


def solid_png(rgb):
    """A real 64×64 RGB PNG gives the fixture a known visible feature."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = (b'\0' + bytes(rgb) * 64) * 64
    header = struct.pack('>IIBBBBB', 64, 64, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


async def prepare(runtime, image_storage):
    red, green = solid_png((255, 0, 0)), solid_png((0, 255, 0))
    async with runtime.sessions.begin() as db:
        db.add(Provider(id='visual-provider', name='aliyun_bailian', api_key='visual-secret',
                        base_url='https://vision.test/compatible-mode/v1'))
        await db.flush()
        db.add(Model(id='visual-model', name='qwen3-vl-plus', provider_id='visual-provider', category='text'))
        for file_id, data in [('red', red), ('green', green)]:
            db.add(FileItem(id=file_id, name=f'{file_id}.png', type='image', storage_key=f'key-{file_id}',
                            content_type='image/png', size_bytes=len(data)))
            await db.flush()
            await upsert_file_usage(db, file_id=file_id, project_id=runtime.project_id, chapter_id=None, usage_kind='upload')
            image_storage[f'key-{file_id}'] = (data, 'image/png', {})
    document = runtime.document
    def source(card_id, port):
        return {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': port, 'position': 0}
    document.update(cards=[
        {'id': 'red', 'type': 'content.image', 'file_id': 'red'},
        {'id': 'green', 'type': 'content.image', 'file_id': 'green'},
        {'id': 'style', 'type': 'direction.style', 'fields': {'direction': reference_field(source('red', 'image'), '请核对参考的主要可见色为红色：')}},
        {'id': 'model', 'type': 'model.image',
         'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': source('style', 'text')},
                            {'id': 'unrelated', 'input_port': 'image', 'source': source('green', 'image')}]},
        {'id': 'check', 'type': 'review.check', 'check_model_id': 'visual-model', 'enabled_categories': ['P03']},
    ], edges=[
        {'id': 'field-image', 'source_card': 'red', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image_example'},
        {'id': 'adopt-design', 'source_card': 'style', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
        {'id': 'adopt-other', 'source_card': 'green', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'},
    ], input_order={'style': {'image_example': ['field-image']}, 'model': {'text': ['adopt-design'], 'image': ['adopt-other']}})
    connect_check(document)
    await save_canvas(runtime.client, runtime.url, document, 1)
    return red


async def preview(runtime):
    response = await runtime.client.get(f'{runtime.url}/checks/check')
    assert response.status_code == 200, response.text
    return response.json()['data']


async def run(runtime, current):
    basis = current['basis']
    response = await runtime.client.post(f'{runtime.url}/checks/check/runs', json={
        'expected_revision': basis['revision'], 'basis_hash': basis['basis_hash'],
    })
    assert response.status_code == 200, response.text
    return response.json()['data']


@pytest.mark.asyncio
async def test_p03_only_sends_relevant_adopted_image_and_records_observed_evidence(runtime, image_storage):
    red = await prepare(runtime, image_storage)
    current = await preview(runtime)
    assert {media['file_id'] for media in current['basis']['input']['media']} == {'red', 'green'}
    item, = [item for item in current['items'] if item['category'] == 'P03']
    assert item['availability'] == 'ready' and item['source']['card_id'] == 'style'
    accepted = await run(runtime, current)
    assert accepted['results'] == []
    execution, = accepted['executions']
    assert execution['item_id'] == item['id'] and execution['status'] == 'queued'

    def provider(request):
        assert request.url.host == 'vision.test' and request.url.path.endswith('/chat/completions')
        body = json.loads(request.content)
        assert body['model'] == 'qwen3-vl-plus'
        text, image = body['messages'][1]['content']
        assert '红色' in text['text'] and 'green' not in text['text']
        assert image['type'] == 'image_url'
        assert base64.b64decode(image['image_url']['url'].split(',')[1]) == red
        assert '文件名' in body['messages'][0]['content'] and '不同视角' in body['messages'][0]['content']
        return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
            'role': 'assistant', 'content': json.dumps({'outcome': 'conforming', 'message': '主要可见色符合要求',
                                                       'visible_evidence': '画面可见均匀红色区域'}),
        }}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    response = await runtime.client.get(f'{runtime.url}/checks/check/reports')
    assert response.status_code == 200, response.text
    assert 'visual-secret' not in response.text and 'data:image' not in response.text and 'key-red' not in response.text
    report, = response.json()['data']
    assert report['id'] == accepted['id']
    result, = report['results']
    assert result['outcome'] == 'conforming'
    assert result['observed_media'] == [{'modality': 'image', 'file_id': 'red', 'description': '画面可见均匀红色区域'}]


@pytest.mark.asyncio
@pytest.mark.parametrize('missing_object', [False, True])
async def test_p03_keeps_uncertain_and_unreadable_media_separate(runtime, image_storage, missing_object):
    await prepare(runtime, image_storage)
    current = await preview(runtime)
    accepted = await run(runtime, current)
    if missing_object:
        del image_storage['key-red']

    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
            'role': 'assistant', 'content': '{"outcome":"nonconforming","message":"所需区域不可见","visible_evidence":null}',
        }}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=False)
    report, = (await runtime.client.get(f'{runtime.url}/checks/check/reports')).json()['data']
    assert report['id'] == accepted['id']
    result, = report['results']
    assert result['outcome'] == 'indeterminate'
    assert report['executions'][0]['status'] == 'succeeded'
    if missing_object:
        assert calls == [] and result['observed_media'] == [] and '未观察' in result['message']
    else:
        assert len(calls) == 1 and result['observed_media'] == [{'modality': 'image', 'file_id': 'red', 'description': None}]


@pytest.mark.asyncio
async def test_p03_uses_explicit_object_mapping_and_text_reference_and_keeps_unsupported_item(runtime, image_storage):
    await prepare(runtime, image_storage)
    document = (await runtime.client.get(runtime.url)).json()['data']['document']
    def source(card_id, port, **extra):
        return {'canvas_id': runtime.canvas_id, 'card_id': card_id, 'port_id': port, 'position': 0, **extra}
    model = next(card for card in document['cards'] if card['id'] == 'model')
    document['cards'] = [card for card in document['cards'] if card['id'] != 'style'] + [
        {'id': 'person', 'type': 'content.character', 'object_id': 'person', 'name': '阿青', 'text': '身穿红色上衣'},
        {'id': 'portrait', 'type': 'reference.character', 'angle': '侧面', 'image_binding': {'file_id': 'red', 'source': source('red', 'image')},
         'name_binding': source('person', 'object', object_id='person')},
    ]
    check = next(card for card in document['cards'] if card['id'] == 'check')
    check['enabled_categories'] = ['P01', 'P03']
    check['check_model_id'] = runtime.model_id
    document['edges'] = [edge for edge in document['edges'] if edge['source_card'] != 'style' and edge['target_card'] != 'style'] + [
        {'id': 'portrait-file', 'source_card': 'red', 'source_port': 'image', 'target_card': 'portrait', 'target_port': 'image_source'},
        {'id': 'name', 'source_card': 'person', 'source_port': 'object', 'target_card': 'portrait', 'target_port': 'name'},
        {'id': 'describe', 'source_card': 'person', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
        {'id': 'adopt-portrait', 'source_card': 'portrait', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'},
    ]
    document['input_order'].pop('style')
    document['input_order'].update({'portrait': {'name': ['name'], 'image_source': ['portrait-file']}, 'model': {'text': ['describe'], 'image': ['adopt-other', 'adopt-portrait']}})
    model['input_bindings'] = [{'id': 'describe', 'input_port': 'text', 'source': source('person', 'text')},
        {'id': 'portrait-input', 'input_port': 'image', 'source': source('portrait', 'image')},
        {'id': 'unrelated', 'input_port': 'image', 'source': source('green', 'image')}]
    model['prompt'] = {'segments': [
        {'id': 'reference', 'kind': 'reference', 'binding_id': 'unrelated'},
        {'id': 'text', 'kind': 'text', 'text': '应以绿色为主。与前述参考无关。'},
    ]}
    await save_canvas(runtime.client, runtime.url, document, 2)
    current = await preview(runtime)
    items = [item for item in current['items'] if item['category'] == 'P03']
    assert {(item['source']['card_id'], item['requirement']) for item in items} == {
        ('person', '阿青（侧面）：身穿红色上衣'), ('model', '应以绿色为主'),
    }
    assert all(item['availability'] == 'unavailable' and '图片读取' in item['reason'] for item in items)

    check['check_model_id'] = 'visual-model'
    await save_canvas(runtime.client, runtime.url, document, 3)
    current = await preview(runtime)
    assert all(item['availability'] == 'ready' for item in current['items'] if item['category'] == 'P03')
    async with runtime.sessions.begin() as db:
        from sqlalchemy import delete
        from app.models.studio import FileUsage
        await db.execute(delete(FileUsage).where(FileUsage.file_id == 'green', FileUsage.project_id == runtime.project_id))
    current = await preview(runtime)
    missing = next(item for item in current['items'] if item['source']['card_id'] == 'model')
    assert missing['availability'] == 'unavailable' and '参考素材不可用' in missing['reason']
    report = await run(runtime, current)
    assert [item['id'] for item in report['items']] == [next(item['id'] for item in current['items'] if item['source']['card_id'] == 'person')]
    assert any(item['item_id'] == missing['id'] and item['status'] == 'unavailable' for item in report['omitted'])


@pytest.mark.asyncio
async def test_p03_recheck_uses_original_image_and_model_after_replacement_and_card_deletion(runtime, image_storage):
    red = await prepare(runtime, image_storage)
    client, url = runtime.client, runtime.url
    checks = f'{url}/checks/check'
    original = await run(runtime, await preview(runtime))
    calls = []

    def provider(request):
        body = json.loads(request.content)
        text, image = body['messages'][1]['content']
        context = json.loads(text['text'])
        calls.append(context)
        assert request.url.host == 'vision.test' and body['model'] == 'qwen3-vl-plus'
        assert base64.b64decode(image['image_url']['url'].split(',')[1]) == red
        if 'recheck' in context:
            assert '不能视作证据' in body['messages'][0]['content']
        return httpx.Response(200, json={'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {
            'role': 'assistant', 'content': json.dumps({
                'outcome': 'conforming', 'message': '重读后看到红色区域', 'visible_evidence': '红色区域',
            }),
        }}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as transport:
        worker = TaskWorker(runtime.sessions, client=transport)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            old, = (await client.get(f'{checks}/reports')).json()['data']
            item, = old['items']
            assert old['id'] == original['id'] and old['results'][0]['outcome'] == 'conforming'
            document = (await client.get(url)).json()['data']['document']
            document['cards'][0]['file_id'] = 'green'
            document['cards'] = [card for card in document['cards'] if card['id'] != 'check']
            document['edges'] = [edge for edge in document['edges'] if edge['target_card'] != 'check']
            document['input_order'].pop('check')
            await save_canvas(client, url, document, 2)

            body = {'item_id': item['id'], 'clarification': '请复看角落。不要改用当前图片。'}
            path = f"{checks}/reports/{old['id']}/recheck"
            other_project = path.replace(runtime.project_id, 'wrong-project', 1)
            assert (await client.post(other_project, json=body)).status_code == 404
            response = await client.post(path, json=body)
            assert response.status_code == 200, response.text
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            reviewed, retained = (await client.get(f'{url}/check-reports/archived')).json()['data']
            assert reviewed['basis'] == old['basis'] and retained == old
            assert reviewed['id'] != old['id'] and reviewed['recheck']['report_id'] == old['id']
            assert reviewed['results'][0]['observed_media'][0]['file_id'] == 'red'
            assert len(calls) == 2 and calls[-1]['recheck']['clarification'] == body['clarification']

            del image_storage['key-red']
            response = await client.post(path, json=body)
            assert response.status_code == 200, response.text
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            unavailable, _, retained = (await client.get(f'{url}/check-reports/archived')).json()['data']
            result, = unavailable['results']
            assert result['outcome'] == 'indeterminate' and not result['observed_media']
            assert '无法读取' in result['message']
            assert retained == old and len(calls) == 2
        finally:
            worker.text_pool.shutdown(wait=False)
