"""创作控制和验收要求通过公开画布 HTTP 验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,fields', [
    ('creative_control', {'freedom': '允许探索', 'allowed_range': '背景可自由发挥', 'keep': '保持帽子', 'undecided': '色调未定'}),
    ('guidance', {'priority': '先呈现反应', 'reference_requirements': '使用已知参考', 'sound_strategy': '声音后期制作', 'prohibitions': '不可出现字幕'}),
    ('criterion', {'standard': '手掌与钥匙清晰可见'}),
])
async def test_guidance_cards_save_reopen_and_publish_whole_design(canvas_client, kind, fields):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '要求'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    card = {'id': 'design', 'type': 'direction.' + kind, 'name': '可见动作', **{key: {'state': 'proposal', 'text': value} for key, value in fields.items()}}
    if kind == 'criterion':
        card['criterion_id'] = 'visible-hand'
    doc = canvas['document']
    doc['cards'] = [card]
    saved = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    payload = (await canvas_client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]['payload']
    assert payload['adoption'] == 'whole_card'
    for key, value in fields.items():
        assert payload['fields'][key]['text'] == value
        assert payload['fields'][key]['state'] == 'proposal'
    assert (await canvas_client.get(url)).json()['data']['document']['cards'][0]['name'] == '可见动作'

@pytest.mark.asyncio
async def test_acceptance_identity_references_are_selected_at_receivers_without_forwarding_standard(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '验收关系'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'criterion', 'port_id': 'criterion', 'position': 0, 'object_id': 'hand'}
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '手部可见', 'standard': {'state': 'fact', 'text': '秘密验收标准：五指全部可见'}}] + [
        {'id': kind, 'type': 'direction.' + kind, **({'shot_id': 's', 'name': '反应'} if kind == 'shot' else {}),
         'input_bindings': [{'id': 'criterion', 'input_port': 'acceptance_basis', 'source': source}]} for kind in ['shot', 'performance', 'photography']],
        edges=[{'id': kind, 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': kind, 'target_port': 'acceptance_basis'} for kind in ['shot', 'performance', 'photography']],
        input_order={kind: {'acceptance_basis': [kind]} for kind in ['shot', 'performance', 'photography']})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    for kind in ['shot', 'performance', 'photography']:
        output = (await client.get(url + f'/cards/{kind}/outputs')).json()['data']['outputs'][0]
        assert '手部可见' in output['text'] and '秘密验收标准' not in output['text']
        assert output['payload']['acceptance_basis'] == [{'kind': 'criterion_reference', 'criterion_id': 'hand', 'name': '手部可见'}]
    # Reopening retains actual choices; a new candidate is not a use.
    assert (await client.get(url)).json()['data']['document']['cards'][1]['input_bindings'][0]['source']['object_id'] == 'hand'
    doc['cards'][0]['criterion_id'] = 'other'
    response = await client.put(url, json={'request_id': 'identity', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'IMMUTABLE_CRITERION_IDENTITY'

@pytest.mark.asyncio
@pytest.mark.parametrize('case,code', [('duplicate', 'DUPLICATE_CRITERION_IDENTITY'), ('name', 'DUPLICATE_CRITERION_NAME'), ('reverse', 'INCOMPATIBLE_PORT'), ('cycle', 'GRAPH_CYCLE'), ('bad_binding', 'INVALID_REQUIREMENT_BINDING')])
async def test_requirements_reject_invalid_structure_not_free_text(canvas_client, case, code):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '约束'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '可见', 'standard': {'state': 'proposal', 'text': '任意矛盾文本均不纠错'}},
                      {'id': 'shot', 'type': 'direction.shot', 'shot_id': 'shot', 'name': '反应'}, {'id': 'model', 'type': 'model.image'}], edges=[], input_order={})
    if case in ('duplicate', 'name'):
        doc['cards'].append({'id': 'other', 'type': 'direction.criterion', 'criterion_id': 'hand' if case == 'duplicate' else 'other', 'name': '另一要求' if case == 'duplicate' else '可见'})
    if case == 'reverse':
        doc['edges'] = [{'id': 'back', 'source_card': 'shot', 'source_port': 'shot', 'target_card': 'criterion', 'target_port': 'effect_object'}]
        doc['input_order'] = {'criterion': {'effect_object': ['back']}}
    if case == 'cycle':
        doc['edges'] = [{'id': 'forward', 'source_card': 'criterion', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}, {'id': 'back', 'source_card': 'model', 'source_port': 'image', 'target_card': 'criterion', 'target_port': 'image_example'}]
        doc['input_order'] = {'criterion': {'image_example': ['back']}, 'model': {'text': ['forward']}}
    if case == 'bad_binding':
        doc['cards'][0]['input_bindings'] = [{'id': 'bad', 'input_port': 'effect_object', 'source': {'canvas_id': canvas['id'], 'card_id': 'shot', 'port_id': 'shot', 'position': 0, 'object_id': 'shot'}}]
    response = await canvas_client.put(url, json={'request_id': 'bad', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == code, response.text
    assert response.json()['detail']['target']


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
async def test_actual_worker_uses_direct_requirements_and_not_referenced_standard(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    from datetime import timedelta
    async with runtime.sessions.begin() as db:
        if modality == 'image':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'image-model', 'image', {}
        if modality == 'video':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'doubao-seedance', 'video', {}
            provider = await db.get(Provider, runtime.provider_id)
            provider.name = 'volcengine'
    source = lambda card, port, **extra: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = runtime.document
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '手部验收', 'standard': {'state': 'fact', 'text': '直接采用标准：手与钥匙清晰可见'}},
        {'id': 'guidance', 'type': 'direction.guidance', 'priority': {'state': 'proposal', 'text': '反应优先'}, 'reference_requirements': {'state': 'undecided', 'text': '稍后选择图片'}, 'sound_strategy': {'state': 'proposal', 'text': '声音后期制作'}, 'prohibitions': {'state': 'fact', 'purpose': 'constraint', 'text': '不可出现字幕'}},
        {'id': 'control', 'type': 'direction.creative_control', 'freedom': {'state': 'proposal', 'text': '背景可探索'}, 'keep': {'state': 'fact', 'purpose': 'constraint', 'text': '保持帽子'}, 'undecided': {'state': 'undecided', 'text': '色调待定'}},
        {'id': 'shot', 'type': 'direction.shot', 'name': '反应', 'input_bindings': [{'id': 'criterion', 'input_port': 'acceptance_basis', 'source': source('criterion', 'criterion', object_id='hand')}]},
        {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {},
         'input_bindings': [{'id': name, 'source': source(name, 'text'), 'input_port': 'text'} for name in ['control', 'guidance', 'shot']]}],
        edges=[{'id': 'criterion', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'}] + [{'id': name, 'source_card': name, 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'} for name in ['control', 'guidance', 'shot']],
        input_order={'shot': {'acceptance_basis': ['criterion']}, 'consumer': {'text': ['control', 'guidance', 'shot']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direction', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    initial = (await runtime.client.get(runtime.url + '/cards/consumer/compile')).json()['data']
    assert '手部验收' in initial['text'] and '直接采用标准' not in initial['text']
    doc['cards'][-1]['input_bindings'].append({'id': 'criterion', 'input_port': 'text', 'source': source('criterion', 'text')})
    doc['edges'].append({'id': 'standard', 'source_card': 'criterion', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'})
    doc['input_order']['consumer']['text'].append('standard')
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direct', 'expected_revision': 2, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '直接采用标准' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    received = []
    class ProviderText:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='要求分析')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ProviderText)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            if modality == 'image':
                received.append(body['prompt'])
                return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
            received.append(body['content'][0]['text'])
            return httpx.Response(200, json={'id': 'guidance-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'guidance-video', headers={'Content-Type': 'video/mp4'})
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
    for text in ['背景可探索', '保持帽子', '色调待定', '反应优先', '稍后选择图片', '声音后期制作', '不可出现字幕', '手与钥匙清晰可见']:
        assert text in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'succeeded'
    assert (await runtime.client.get(runtime.url)).json()['data']['document']['cards'][0]['standard']['state'] == 'fact'

@pytest.mark.asyncio
async def test_guidance_effects_accept_declared_story_and_spatial_identity_only(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '作用范围'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = lambda card, port: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0, 'object_id': card}
    doc.update(cards=[{'id': 'event', 'type': 'direction.event', 'event_id': 'event', 'name': '钟响', 'action_change': {'state': 'fact', 'text': '不可跨级的事件正文'}},
        {'id': 'anchor', 'type': 'direction.anchor', 'anchor_id': 'anchor', 'name': '门口', 'position': {'state': 'fact', 'text': '不可跨级的几何正文'}},
        {'id': 'guidance', 'type': 'direction.guidance', 'name': '要求', 'input_bindings': [{'id': 'event', 'input_port': 'effect_object', 'source': source('event', 'event')}, {'id': 'anchor', 'input_port': 'effect_object', 'source': source('anchor', 'anchor')}]},
        {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'c', 'name': '判断', 'input_bindings': [{'id': 'anchor', 'input_port': 'effect_object', 'source': source('anchor', 'anchor')}]}],
        edges=[{'id': 'event', 'source_card': 'event', 'source_port': 'event', 'target_card': 'guidance', 'target_port': 'effect_object'}, {'id': 'anchor', 'source_card': 'anchor', 'source_port': 'anchor', 'target_card': 'guidance', 'target_port': 'effect_object'}, {'id': 'criterion', 'source_card': 'anchor', 'source_port': 'anchor', 'target_card': 'criterion', 'target_port': 'effect_object'}],
        input_order={'guidance': {'effect_object': ['event', 'anchor']}, 'criterion': {'effect_object': ['criterion']}})
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    output = (await canvas_client.get(url + '/cards/guidance/outputs')).json()['data']['outputs'][0]
    assert '钟响' in output['text'] and '门口' in output['text'] and '不可跨级' not in output['text']
    assert len(output['payload']['references']) == 2

@pytest.mark.asyncio
async def test_acceptance_examples_stay_fixed_and_require_cleanup_before_source_delete(canvas_client):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': (name, b'video', 'video/mp4')})).json()['data']['id'] for name in ['before.mp4', 'after.mp4']]
    canvas = (await client.post('/canvases/p', json={'name': '正反例'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'video', 'port_id': 'video', 'position': 0}
    doc.update(cards=[{'id': 'video', 'type': 'content.video', 'file_id': files[0]},
        {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '动作', 'standard': {'state': 'proposal', 'text': '动作克制'},
         'examples': [{'id': 'ex', 'source': source, 'file_id': files[0], 'purpose': 'negative', 'start_ms': 100, 'end_ms': 900}]}],
        edges=[{'id': 'e', 'source_card': 'video', 'source_port': 'video', 'target_card': 'criterion', 'target_port': 'video_example'}], input_order={'criterion': {'video_example': ['e']}})
    response = await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    doc['cards'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'rerun', 'expected_revision': 1, 'document': doc})).status_code == 200
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][1]['examples'][0]['file_id'] == files[0]
    outputs = (await client.get(url + '/cards/criterion/outputs')).json()['data']['outputs']
    assert files[0] not in str(outputs) and files[1] not in str(outputs) and '900' not in str(outputs)
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    response = await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][0]['examples'] = []
    assert (await client.put(url, json={'request_id': 'clear', 'expected_revision': 2, 'document': doc})).status_code == 200

@pytest.mark.asyncio
async def test_acceptance_reference_rename_cancel_and_delete_are_explicit(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '要求生命周期'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'criterion', 'port_id': 'criterion', 'position': 0, 'object_id': 'c'}
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'c', 'name': '初始'}, {'id': 'shot', 'type': 'direction.shot', 'input_bindings': [{'id': 'c', 'source': source, 'input_port': 'acceptance_basis'}]}],
        edges=[{'id': 'e', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'}], input_order={'shot': {'acceptance_basis': ['e']}})
    assert (await client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['name'] = '更新名称'
    assert (await client.put(url, json={'request_id': 'rename', 'expected_revision': 1, 'document': doc})).status_code == 200
    payload = (await client.get(url + '/cards/shot/outputs')).json()['data']['outputs'][0]['payload']
    assert payload['acceptance_basis'][0]['name'] == '更新名称' and payload['acceptance_basis'][0]['criterion_id'] == 'c'
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    rejected = await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})
    assert rejected.status_code == 422 and rejected.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][0]['input_bindings'] = []
    assert (await client.put(url, json={'request_id': 'cancel', 'expected_revision': 2, 'document': doc})).status_code == 200
    assert not (await client.get(url + '/cards/shot/outputs')).json()['data']['outputs']
