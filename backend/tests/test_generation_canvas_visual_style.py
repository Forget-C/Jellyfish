"""独立风格通过画布 HTTP 输出和编译验证，不采用演示媒体。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_style_is_whole_design_and_connection_alone_does_not_adopt(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '风格'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document.update(cards=[{'id': 'style', 'type': 'direction.style', 'fields': {
        'direction': {'text': '手绘水彩', 'state': 'proposal'},
        'visual_features': {'text': '轮廓自然晕开', 'state': 'proposal'},
        'materials': {'text': '纸张颗粒', 'state': 'fact'},
        'colors': {'text': '低饱和青绿', 'state': 'proposal'},
        'notes': {'text': '保留手工笔触', 'state': 'fact'}}},
        {'id': 'model', 'type': 'model.text'}],
        edges=[{'id': 'e', 'source_card': 'style', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['e']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    output = (await client.get(url + '/cards/style/outputs')).json()['data']['outputs'][0]
    assert output['payload']['adoption'] == 'whole_card'
    assert output['payload']['fields']['materials']['text'] == '纸张颗粒'
    assert len((await client.get(url + '/cards/model/compile')).json()['data']['used']) == 1
    document['cards'][1]['input_bindings'] = [{'id': 'use', 'input_port': 'text', 'source': output['source']}]
    assert (await client.put(url, json={'request_id': 'adopt', 'expected_revision': 1, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    for phrase in ('手绘水彩', '轮廓自然晕开', '纸张颗粒', '低饱和青绿', '保留手工笔触'):
        assert phrase in compiled['text']
    assert compiled['media'] == []
    assert compiled['used'][0]['payload']['adoption'] == 'whole_card'


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
async def test_style_whole_output_reaches_real_worker_without_implicit_media(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from datetime import timedelta
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    async with runtime.sessions.begin() as db:
        model = await db.get(Model, runtime.model_id)
        if modality != 'text':
            model.name, model.category, model.params = ('image-model' if modality == 'image' else 'doubao-seedance'), modality, {}
        if modality == 'video':
            provider = await db.get(Provider, runtime.provider_id)
            provider.name = 'volcengine'
    source = {'canvas_id': runtime.canvas_id, 'card_id': 'photo', 'port_id': 'text', 'position': 0}
    doc = runtime.document
    doc.update(cards=[{'id': 'photo', 'type': 'direction.style', 'fields': {'direction': {'state': 'proposal', 'text': '手绘水彩'}, 'materials': {'state': 'fact', 'text': '纸张颗粒'}}},
        {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {'target_ratio': '16:9', 'resolution_profile': 'standard', 'count': 1} if modality == 'image' else {}, 'input_bindings': [{'id': 'use', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'photo', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}], input_order={'consumer': {'text': ['e']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'photo', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run-photo', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200, accepted.text
    received = []
    class TextProvider:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='摄影分析完成')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', TextProvider)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            received.append(body['prompt'] if modality == 'image' else body['content'][0]['text'])
            return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]} if modality == 'image' else {'id': 'photo-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'photography-video', headers={'Content-Type': 'video/mp4'})
        return httpx.Response(200, json={'status': 'succeeded', 'content': {'video_url': 'https://media.test/video.mp4'}})
    clock = [utcnow()]
    monkeypatch.setattr('app.task_worker.utcnow', lambda: clock[0])
    monkeypatch.setattr('app.services.task_service.utcnow', lambda: clock[0])
    async with httpx.AsyncClient(transport=httpx.MockTransport(provider_http)) as client:
        worker = TaskWorker(runtime.sessions, client=client)
        for _ in range(3):
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
            await asyncio.sleep(0)
            clock[0] += timedelta(seconds=10)
        worker.text_pool.shutdown(wait=False)
    assert received == [preview['input']['text']]
    assert '手绘水彩' in received[0] and '纸张颗粒' in received[0]
    assert preview['input']['media'] == []
    assert preview['input']['used'][0]['payload']['adoption'] == 'whole_card'
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'succeeded', state
    assert state['current_outputs']['consumer'][0]['basis_current']
    doc['cards'][0]['fields']['materials']['text'] = '保留颗粒并增加笔触'
    assert (await runtime.client.put(runtime.url, json={'request_id': 'whole-edit', 'expected_revision': 2, 'document': doc})).status_code == 200
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert not state['current_outputs']['consumer'][0]['basis_current']


@pytest.mark.asyncio
async def test_style_fixed_examples_are_not_transitive_media_inputs(canvas_client):
    client = canvas_client
    image = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('style.png', b'image', 'image/png')})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '风格示例'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    def source(card, port):
        return {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
    document.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': image['id']},
        {'id': 'style', 'type': 'direction.style', 'fields': {'direction': {'text': '胶片色彩', 'state': 'proposal'}}, 'examples': [{'id': 'example', 'source': source('image', 'image'), 'file_id': image['id'], 'purpose': 'positive'}]},
        {'id': 'model', 'type': 'model.image', 'input_bindings': [{'id': 'style', 'source': source('style', 'text'), 'input_port': 'text'}]}],
        edges=[{'id': 'image', 'source_card': 'image', 'source_port': 'image', 'target_card': 'style', 'target_port': 'image_example'}, {'id': 'style', 'source_card': 'style', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}], input_order={'style': {'image_example': ['image']}, 'model': {'text': ['style']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['media'] == [] and image['id'] not in str(compiled['used'])
    document['cards'][2]['input_bindings'][0]['photography_scope'] = ['field:direction']
    assert (await client.put(url, json={'request_id': 'partial', 'expected_revision': 1, 'document': document})).status_code == 422
    document['cards'][2]['input_bindings'][0].pop('photography_scope')
    document['cards'][1]['examples'][0]['file_id'] = 'not-a-project-file'
    response = await client.put(url, json={'request_id': 'legacy-example', 'expected_revision': 1, 'document': document})
    assert response.status_code == 200
    reopened = (await client.get(url)).json()['data']['document']
    assert not reopened['cards'][1]['examples'], 'old examples are removed instead of adopted'
