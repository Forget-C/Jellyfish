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
async def test_acceptance_relations_publish_identity_without_copying_standard_into_design(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '验收关系'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'criterion', 'port_id': 'criterion', 'position': 0, 'object_id': 'hand'}
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '手部可见', 'standard': {'state': 'fact', 'text': '秘密验收标准：五指全部可见'}}] + [
        {'id': kind, 'type': 'direction.' + kind, **({'shot_id': 's', 'name': '反应'} if kind == 'shot' else {}),
         'input_bindings': [{'id': 'criterion', 'input_port': 'acceptance_basis', 'source': source}]} for kind in ['shot', 'performance', 'camera']],
        edges=[{'id': kind, 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': kind, 'target_port': 'acceptance_basis'} for kind in ['shot', 'performance', 'camera']],
        input_order={kind: {'acceptance_basis': [kind]} for kind in ['shot', 'performance', 'camera']})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    for kind in ['shot', 'performance', 'camera']:
        output = (await client.get(url + f'/cards/{kind}/outputs')).json()['data']['outputs'][0]
        assert '手部可见' in output['text'] and '秘密验收标准' not in output['text']
        assert output['payload']['acceptance_basis'] == [{'kind': 'criterion_reference', 'criterion_id': 'hand', 'name': '手部可见'}]
    # Reopening retains the linked requirement identity.
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
        doc['edges'] = [{'id': 'back', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'text'}]
        doc['input_order'] = {'shot': {'text': ['back']}}
    if case == 'cycle':
        doc['edges'] = [{'id': 'forward', 'source_card': 'criterion', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}, {'id': 'back', 'source_card': 'model', 'source_port': 'image', 'target_card': 'criterion', 'target_port': 'image_example'}]
        doc['input_order'] = {'criterion': {'image_example': ['back']}, 'model': {'text': ['forward']}}
    if case == 'bad_binding':
        doc['cards'][0]['input_bindings'] = [{'id': 'bad', 'input_port': 'acceptance_basis', 'source': {'canvas_id': canvas['id'], 'card_id': 'shot', 'port_id': 'shot', 'position': 0, 'object_id': 'shot'}}]
    response = await canvas_client.put(url, json={'request_id': 'bad', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == code, response.text
    assert response.json()['detail']['target']


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
@pytest.mark.parametrize('legacy_conflict', [False, 'text', 'object', 'direction.creative_control', 'direction.guidance', 'direction.fact', 'direction.performance_rule'])
async def test_actual_worker_automatically_uses_linked_acceptance_without_extra_connection(runtime, image_storage, monkeypatch, modality, legacy_conflict):
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
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '手部验收', 'standard': {'state': 'fact', 'text': '提交时标准：手与钥匙清晰可见', 'authorship': 'model', 'source_locator': '原文提取定位'}},
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
    assert '手部验收' in initial['text'] and '提交时标准' in initial['text']
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '提交时标准' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    if legacy_conflict:
        from copy import deepcopy
        from sqlalchemy import select
        from app.models.generation_canvas import CanvasRunNode
        async with runtime.sessions.begin() as db:
            node = await db.scalar(select(CanvasRunNode))
            private = deepcopy(node.execution_snapshot)
            if legacy_conflict == 'object':
                private['document']['cards'][0]['input_bindings'] = [{'id': 'old-object', 'input_port': 'effect_object', 'source': source('control', 'text')}]
            elif isinstance(legacy_conflict, str) and legacy_conflict.startswith('direction.'):
                private['document']['cards'].append({'id': 'old-requirement', 'type': legacy_conflict, 'input_bindings': [{'id': 'old-object', 'input_port': 'effect_object', 'source': source('control', 'text')}]})
            else:
                private['document']['edges'].append({'id': 'old-text', 'source_card': 'criterion', 'source_port': 'text', 'target_card': 'shot', 'target_port': 'text'})
                private['document']['input_order']['shot']['text'] = ['old-text']
            node.execution_snapshot = private
    doc['cards'][0]['standard'].update(text='新标准：钥匙必须位于画面中央', authorship='user')
    changed = await runtime.client.put(runtime.url, json={'request_id': 'after-admission', 'expected_revision': 2, 'document': doc})
    assert changed.status_code == 200, changed.text
    current = (await runtime.client.get(runtime.url + '/cards/consumer/compile')).json()['data']
    assert '新标准' in current['text'] and '提交时标准' not in current['text']
    assert '原文提取定位' not in current['text']
    assert '原文提取定位' in preview['input']['text']
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
    if legacy_conflict:
        assert received == []
        state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
        assert state['runs'][0]['nodes'][0]['status'] == 'failed'
        assert state['runs'][0]['nodes'][0]['error_code'] == 'LEGACY_ACCEPTANCE_SNAPSHOT'
        assert '重新提交' in state['runs'][0]['nodes'][0]['error_message']
        if isinstance(legacy_conflict, str) and legacy_conflict.startswith('direction.'):
            assert '通用对象用途' in state['runs'][0]['nodes'][0]['error_message']
        assert state['runs'][0]['nodes'][0]['basis']['input']['text'] == preview['input']['text']
        return
    assert received == [preview['input']['text']]
    for text in ['背景可探索', '保持帽子', '色调待定', '反应优先', '稍后选择图片', '声音后期制作', '不可出现字幕', '手与钥匙清晰可见']:
        assert text in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    assert state['runs'][0]['nodes'][0]['status'] == 'succeeded'
    assert state['runs'][0]['nodes'][0]['basis']['input']['text'] == preview['input']['text']
    assert (await runtime.client.get(runtime.url)).json()['data']['document']['cards'][0]['standard']['state'] == 'fact'

@pytest.mark.asyncio
async def test_old_guidance_objects_become_story_and_spatial_candidates_without_adoption(canvas_client):
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
    assert output['text'] == '名称：要求'
    assert output['payload'].get('references', []) == []
    reopened = (await canvas_client.get(url)).json()['data']['document']
    assert reopened['cards'][2]['input_bindings'] == []
    assert all(edge['target_port'] != 'effect_object' for edge in reopened['edges'])

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
    assert files[0] not in str(outputs) and files[1] not in str(outputs) and '900' not in str(outputs[0]['payload'])
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    response = await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][0]['examples'] = []
    assert (await client.put(url, json={'request_id': 'clear', 'expected_revision': 2, 'document': doc})).status_code == 200

@pytest.mark.asyncio
async def test_acceptance_reference_rename_and_delete_update_linked_designs(canvas_client):
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
    deleted = await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})
    assert deleted.status_code == 200, deleted.text
    assert not (await client.get(url)).json()['data']['document']['cards'][0]['input_bindings']
    assert not (await client.get(url + '/cards/shot/outputs')).json()['data']['outputs']


@pytest.mark.asyncio
async def test_acceptance_cancel_removes_unique_connection(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '连线即关联'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '手部'},
                      {'id': 'shot', 'type': 'direction.shot', 'name': '镜头', 'input_bindings': [{'id': 'chosen', 'input_port': 'acceptance_basis', 'source': {'canvas_id': canvas['id'], 'card_id': 'criterion', 'port_id': 'criterion', 'position': 0, 'object_id': 'hand'}}]}],
        edges=[{'id': 'acceptance', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'}],
        input_order={'shot': {'acceptance_basis': ['acceptance']}})
    assert (await client.put(url, json={'request_id': 'connect', 'expected_revision': 0, 'document': doc})).status_code == 200
    saved = (await client.get(url)).json()['data']['document']
    assert saved['cards'][1]['input_bindings'][0]['source']['object_id'] == 'hand'
    # The acceptance relation is the sole use of this connection.
    saved['cards'][1]['input_bindings'] = []
    assert (await client.put(url, json={'request_id': 'edit', 'expected_revision': 1, 'document': saved})).status_code == 200
    reopened = (await client.get(url)).json()['data']['document']
    assert not reopened['edges']
    assert not reopened['cards'][1]['input_bindings']
    reopened.update(edges=[], input_order={})
    assert (await client.put(url, json={'request_id': 'disconnect', 'expected_revision': 2, 'document': reopened})).status_code == 200
    assert not (await client.get(url)).json()['data']['document']['cards'][1]['input_bindings']


@pytest.mark.asyncio
async def test_acceptance_is_deduplicated_across_designs_and_direct_adoption(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '共享要求'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = lambda card, port: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'required', 'type': 'direction.criterion', 'criterion_id': 'required', 'name': '共享要求', 'standard': {'state': 'fact', 'text': '只出现一次的标准'}},
        {'id': 'unused', 'type': 'direction.criterion', 'criterion_id': 'unused', 'name': '未采用设计的要求', 'standard': {'state': 'fact', 'text': '不应进入模型'}},
        *[{'id': kind, 'type': 'direction.shot', 'name': kind, 'input_bindings': [{'id': 'selected', 'input_port': 'acceptance_basis', 'source': {**source('unused' if kind == 'unselected' else 'required', 'criterion'), 'object_id': 'unused' if kind == 'unselected' else 'required'}}]} for kind in ['first', 'second', 'unselected']],
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': kind, 'source': source(kind, 'text'), 'input_port': 'text'} for kind in ['first', 'second']]}],
        edges=[{'id': kind, 'source_card': 'unused' if kind == 'unselected' else 'required', 'source_port': 'criterion', 'target_card': kind, 'target_port': 'acceptance_basis'} for kind in ['first', 'second', 'unselected']]
        + [{'id': 'model-' + kind, 'source_card': kind, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for kind in ['first', 'second']],
        input_order={**{kind: {'acceptance_basis': [kind]} for kind in ['first', 'second', 'unselected']}, 'model': {'text': ['model-first', 'model-second']}})
    saved = await client.put(url, json={'request_id': 'connect', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    initial = (await client.get(url + '/cards/model/compile')).json()['data']
    assert initial['text'].count('只出现一次的标准') == 1
    assert '不应进入模型' not in initial['text']
    assert {item['source']['card_id'] for item in initial['used']} == {'first', 'second', 'required'}
    doc['cards'][-1]['prompt'] = {'segments': [{'id': 'explicit', 'kind': 'reference', 'binding_id': 'direct'}]}
    doc['cards'][-1]['input_bindings'].append({'id': 'direct', 'source': source('required', 'text'), 'input_port': 'text'})
    doc['edges'].append({'id': 'direct', 'source_card': 'required', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'})
    doc['input_order']['model']['text'].append('direct')
    assert (await client.put(url, json={'request_id': 'direct', 'expected_revision': 1, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['text'].count('只出现一次的标准') == 1
    # Direct model adoption still protects deletion of the requirement card.
    doc['cards'] = [card for card in doc['cards'] if card['id'] != 'required']
    doc['edges'] = [edge for edge in doc['edges'] if edge['source_card'] != 'required']
    doc['input_order']['first']['acceptance_basis'] = []
    doc['input_order']['second']['acceptance_basis'] = []
    doc['input_order']['model']['text'].remove('direct')
    denied = await client.put(url, json={'request_id': 'delete', 'expected_revision': 2, 'document': doc})
    assert denied.status_code == 422 and denied.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['image', 'video', 'text'])
async def test_linked_acceptance_carries_effective_standard_media_and_checks_capability(canvas_client, modality):
    client = canvas_client
    file_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('reference.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await client.post('/canvases/p', json={'name': '验收素材'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = lambda card, port: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
    doc = canvas['document']
    standard = {'state': 'fact', 'document': {'segments': [{'id': 'image', 'kind': 'reference', 'source': source('image', 'image')}]}}
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': file_id},
        {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '图文标准', 'standard': standard},
        {'id': 'shot', 'type': 'direction.shot', 'name': '镜头', 'input_bindings': [{'id': 'chosen', 'input_port': 'acceptance_basis', 'source': {**source('criterion', 'criterion'), 'object_id': 'hand'}}]},
        {'id': 'model', 'type': 'model.' + modality, 'input_bindings': [{'id': 'shot', 'input_port': 'text', 'source': source('shot', 'text')}]}],
        edges=[{'id': 'media', 'source_card': 'image', 'source_port': 'image', 'target_card': 'criterion', 'target_port': 'image'},
            {'id': 'acceptance', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'},
            {'id': 'model', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'criterion': {'image': ['media']}, 'shot': {'acceptance_basis': ['acceptance']}, 'model': {'text': ['model']}})
    saved = await client.put(url, json={'request_id': 'media', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    if modality == 'text':
        assert any(issue['code'] == 'DESIGN_MEDIA_CARRY_NOT_READY' for issue in compiled['diagnostics'])
    else:
        assert [item['file_id'] for item in compiled['media']] == [file_id]
        assert compiled['media'][0]['design_sources'][0]['source']['card_id'] == 'criterion'
        if modality == 'image':
            assert 'image 1' in compiled['text']
        else:
            assert any(issue['code'] == 'DESIGN_MEDIA_PURPOSE_REQUIRED' for issue in compiled['diagnostics'])
    standard['state'] = 'not_applicable'
    assert (await client.put(url, json={'request_id': 'inactive', 'expected_revision': 1, 'document': doc})).status_code == 200
    inactive = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not inactive['media']
    assert not any(issue['code'] in ('DESIGN_MEDIA_CARRY_NOT_READY', 'DESIGN_MEDIA_PURPOSE_REQUIRED') for issue in inactive['diagnostics'])


@pytest.mark.asyncio
async def test_old_acceptance_candidates_are_cleaned_without_adopting_them(canvas_client, canvas_file_store):
    from app.models.generation_canvas import GenerationCanvas
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '旧候选'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'hand', 'name': '未采用标准'}, {'id': 'shot', 'type': 'direction.shot', 'name': '镜头'}],
        edges=[{'id': 'old', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'}],
        input_order={'shot': {'acceptance_basis': ['old']}})
    # Prepare a historical document which the former API allowed; verify only via HTTP.
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    reopened = (await client.get(url)).json()['data']
    assert reopened['revision'] == 1
    assert not reopened['document']['edges']
    assert not reopened['document']['cards'][1].get('input_bindings')
    assert not reopened['document']['input_order']['shot']['acceptance_basis']

@pytest.mark.asyncio
async def test_independent_design_connection_adopts_and_disconnects(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '独立设计'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'design', 'type': 'direction.guidance', 'priority': {'state': 'fact', 'text': '只出现一次的动作设计'}},
                      {'id': 'model', 'type': 'model.text'}],
               edges=[{'id': 'design-edge', 'source_card': 'design', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
               input_order={'model': {'text': ['design-edge']}})
    saved = await canvas_client.put(url, json={'request_id': 'connect', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    current = (await canvas_client.get(url)).json()['data']['document']
    assert len(current['cards'][1]['input_bindings']) == 1
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['text'].count('只出现一次的动作设计') == 1
    current['edges'] = []
    current['input_order'] = {}
    saved = await canvas_client.put(url, json={'request_id': 'disconnect', 'expected_revision': 1, 'document': current})
    assert saved.status_code == 200, saved.text
    assert not (await canvas_client.get(url)).json()['data']['document']['cards'][1]['input_bindings']

@pytest.mark.asyncio
@pytest.mark.parametrize('source_type', ['direction.guidance', 'content.text'])
async def test_whole_design_dependencies_follow_diamond_and_render_common_ancestor_once(canvas_client, source_type):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '菱形依赖'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    identity = lambda name: {'canvas_id': canvas['id'], 'card_id': name, 'port_id': 'text', 'position': 0}
    field = lambda name: {'state': 'fact', 'document': {'segments': [{'id': 'ref-' + name, 'kind': 'reference', 'source': identity(name)}]}}
    doc.update(cards=[({'id': 'a', 'type': source_type, 'text': '祖先内容唯一标记'} if source_type == 'content.text' else {'id': 'a', 'type': source_type, 'priority': {'state': 'fact', 'text': '祖先内容唯一标记'}}),
        {'id': 'b', 'type': 'direction.guidance', 'priority': field('a')},
        {'id': 'd', 'type': 'direction.guidance', 'priority': field('a')},
        {'id': 'model', 'type': 'model.text'}], edges=[
        {'id': 'ab', 'source_card': 'a', 'source_port': 'text', 'target_card': 'b', 'target_port': 'text'},
        {'id': 'ad', 'source_card': 'a', 'source_port': 'text', 'target_card': 'd', 'target_port': 'text'},
        {'id': 'bm', 'source_card': 'b', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'},
        {'id': 'dm', 'source_card': 'd', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'b': {'text': ['ab']}, 'd': {'text': ['ad']}, 'model': {'text': ['bm', 'dm']}})
    saved = await canvas_client.put(url, json={'request_id': 'diamond', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert compiled['text'].count('祖先内容唯一标记') == 1, compiled
    assert {item['source']['card_id'] for item in compiled['used']} == {'a', 'b', 'd'}
    assert not [issue for issue in compiled['diagnostics'] if issue['code'] != 'MODEL_REQUIRED'], compiled

@pytest.mark.asyncio
async def test_unavailable_asset_identity_in_design_dependency_blocks_compile(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '资产依赖'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'actor', 'port_id': 'object', 'position': 0, 'object_id': 'actor'}
    doc = canvas['document']
    doc.update(cards=[{'id': 'actor', 'type': 'reference.character', 'name': '甲', 'object_id': 'actor'},
        {'id': 'camera', 'type': 'direction.camera', 'fields': {'viewpoint': {'state': 'fact', 'text': '低角度'}},
         'input_bindings': [{'id': 'actor-use', 'input_port': 'effect_object', 'source': source}]},
        {'id': 'model', 'type': 'model.text'}],
        edges=[{'id': 'actor-use', 'source_card': 'actor', 'source_port': 'object', 'target_card': 'camera', 'target_port': 'effect_object'},
            {'id': 'camera-use', 'source_card': 'camera', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'camera': {'effect_object': ['actor-use']}, 'model': {'text': ['camera-use']}})
    assert (await canvas_client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['name'] = ''
    saved = await canvas_client.put(url, json={'request_id': 'incomplete', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    compiled = (await canvas_client.get(url + '/cards/model/compile')).json()['data']
    assert not compiled['can_run']
    assert 'OUTPUT_MISSING' in {issue['code'] for issue in compiled['diagnostics']}

@pytest.mark.asyncio
async def test_acceptance_connection_directly_adopts_and_disconnects(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '直接验收'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'rule', 'name': '可见', 'standard': {'text': '手部可见', 'authorship': 'user'}},
                      {'id': 'shot', 'type': 'direction.shot', 'name': '动作'}],
        edges=[{'id': 'source', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'shot', 'target_port': 'acceptance_basis'}],
        input_order={'shot': {'acceptance_basis': ['source']}})
    saved = await canvas_client.put(url, json={'request_id': 'connect', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    current = (await canvas_client.get(url)).json()['data']['document']
    assert len(current['edges']) == 1
    assert current['cards'][1]['input_bindings'][0]['input_port'] == 'acceptance_basis'
    current['edges'] = []
    current['input_order'] = {}
    saved = await canvas_client.put(url, json={'request_id': 'disconnect', 'expected_revision': 1, 'document': current})
    assert saved.status_code == 200, saved.text
    assert not (await canvas_client.get(url)).json()['data']['document']['cards'][1]['input_bindings']


@pytest.mark.asyncio
async def test_design_field_authorship_roundtrip_preserves_extraction_and_simplifies_user_output(canvas_client):
    """来源类别决定展示与输出标签；未标记历史字段仍保持原语义。"""
    canvas = (await canvas_client.post('/canvases/p', json={'name': '字段来源'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'design', 'type': 'direction.guidance',
        'priority': {'text': '先呈现反应', 'state': 'fact', 'purpose': 'design', 'authorship': 'user'},
        'reference_requirements': {'text': '保留原文参考', 'state': 'proposal', 'purpose': 'background', 'source_locator': '第三章第2段', 'authorship': 'model'},
        'prohibitions': {'text': '历史禁止项', 'state': 'fact', 'purpose': 'constraint'}}]
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    reopened = (await canvas_client.get(url)).json()['data']['document']['cards'][0]
    assert reopened['priority']['authorship'] == 'user'
    assert reopened['reference_requirements']['authorship'] == 'model'
    assert 'authorship' not in reopened['prohibitions']
    output = (await canvas_client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]['text']
    assert '编译优先级：先呈现反应' in output
    assert '设计 / 编译优先级 [事实]' not in output
    assert '背景 / 参考绑定要求 [提议]：保留原文参考（来源：第三章第2段）' in output
    assert '约束 / 禁止项 [事实]：历史禁止项' in output


@pytest.mark.asyncio
async def test_user_design_values_normalize_stale_metadata_and_invalid_authorship_is_rejected(canvas_client):
    """用户设定不能因旧状态停用，清空内容恢复未填写。"""
    canvas = (await canvas_client.post('/canvases/p', json={'name': '用户设定'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'design', 'type': 'direction.guidance',
        'priority': {'text': '必须先呈现反应', 'authorship': 'user', 'state': 'not_applicable', 'purpose': 'background', 'source_locator': '旧来源'},
        'prohibitions': {'text': '', 'authorship': 'user', 'state': 'absent', 'source_locator': '旧来源'}}]
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    card = (await canvas_client.get(url)).json()['data']['document']['cards'][0]
    assert card['priority']['state'] == 'fact'
    assert card['priority']['purpose'] == 'design'
    assert card['priority']['source_locator'] == ''
    assert card['prohibitions']['state'] == 'empty'
    assert card['prohibitions']['source_locator'] == ''
    document['cards'][0]['priority']['authorship'] = 'inferred'
    response = await canvas_client.put(url, json={'request_id': 'invalid', 'expected_revision': 1, 'document': document})
    assert response.status_code == 422
    document['cards'][0]['priority'].update(authorship='model', metadata_fields=['text'])
    response = await canvas_client.put(url, json={'request_id': 'invalid-metadata', 'expected_revision': 1, 'document': document})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_extracted_field_preserves_missing_metadata_across_reopen(canvas_client):
    """提取未提供的元信息不因契约默认值被伪装为已提取。"""
    canvas = (await canvas_client.post('/canvases/p', json={'name': '缺失元信息'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'design', 'type': 'direction.guidance',
        'priority': {'authorship': 'model'},
        'reference_requirements': {'authorship': 'model', 'state': 'absent'}}]
    saved = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    reopened = (await canvas_client.get(url)).json()['data']
    card = reopened['document']['cards'][0]
    assert card['priority']['metadata_fields'] == []
    assert card['reference_requirements']['metadata_fields'] == ['state']
    again = await canvas_client.put(url, json={'request_id': 'again', 'expected_revision': 1, 'document': reopened['document']})
    assert again.status_code == 200, again.text
    card = (await canvas_client.get(url)).json()['data']['document']['cards'][0]
    assert card['priority']['metadata_fields'] == []
    assert card['reference_requirements']['metadata_fields'] == ['state']


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,key,label,nested', [
    ('style', 'direction', '风格方向', True),
    ('camera', 'viewpoint', '观察视点', True),
    ('lighting', 'light_sources', '光源', True),
    ('focus', 'depth_focus', '景深与焦点', True),
    ('composition', 'composition', '构图重心', True),
    ('movement', 'movement_path', '运动路径', True),
    ('performance', 'physical_action', '身体动作', False),
    ('shot', 'visible_result', '可见结果', False),
    ('anchor', 'position', '位置', False),
    ('sound', 'source_description', '声源说明', False),
    ('continuity', 'following_constraints', '后续约束', False),
])
async def test_all_design_outputs_distinguish_user_settings_from_extracted_metadata(canvas_client, kind, key, label, nested):
    """各类设计发布统一保留提取说明，用户设定只发布字段名与正文。"""
    canvas = (await canvas_client.post('/canvases/p', json={'name': '设计输出'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    cards = []
    for authorship in ('user', 'model'):
        value = {'text': '完整设计正文', 'authorship': authorship, 'state': 'proposal', 'purpose': 'background', 'source_locator': '原文定位'}
        cards.append({'id': authorship, 'type': 'direction.' + kind, **({'fields': {key: value}} if nested else {key: value})})
    document['cards'] = cards
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    user = (await canvas_client.get(url + '/cards/user/outputs')).json()['data']['outputs'][0]['text']
    extracted = (await canvas_client.get(url + '/cards/model/outputs')).json()['data']['outputs'][0]['text']
    assert label + '：完整设计正文' in user
    assert '[事实]' not in user and '原文定位' not in user
    assert f'背景 / {label} [提议]：完整设计正文（来源：原文定位）' in extracted

@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['fact', 'not_applicable'])
async def test_old_acceptance_field_references_are_removed_without_adopting(canvas_client, canvas_file_store, state):
    from app.models.generation_canvas import GenerationCanvas
    canvas = (await canvas_client.post('/canvases/p', json={'name': '清理旧引用'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'rule', 'name': '可见'},
        {'id': 'shot', 'type': 'direction.shot', 'visible_result': {'state': state, 'purpose': 'background', 'source_locator': '旧定位', 'document': {'segments': [{'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': 'criterion', 'port_id': 'text', 'position': 0}}]}}}],
        edges=[{'id': 'old', 'source_card': 'criterion', 'source_port': 'text', 'target_card': 'shot', 'target_port': 'text'}], input_order={'shot': {'text': ['old']}})
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    listed = (await canvas_client.get('/canvases/p')).json()['data'][0]
    assert not listed['document']['edges']
    reopened = (await canvas_client.get(url)).json()['data']
    assert reopened['revision'] == listed['revision'] == 1
    field = reopened['document']['cards'][1]['visible_result']
    assert field['document']['segments'] == []
    assert field['state'] == 'empty' and field['source_locator'] == '' and field['purpose'] == 'design'
    assert not reopened['document']['cards'][1].get('input_bindings')

@pytest.mark.asyncio
@pytest.mark.parametrize('bad', ['edge', 'segment', 'source', 'text', 'order'])
async def test_acceptance_cleanup_preserves_invalid_input_validation(canvas_client, bad):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '异常结构'})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'criterion', 'type': 'direction.criterion', 'name': '可见'}]
    if bad == 'edge':
        doc['edges'] = [None]
    elif bad == 'order':
        doc['input_order'] = {'criterion': {'text': [[]]}}
    elif bad == 'segment':
        doc['cards'][0]['standard'] = {'document': {'segments': [None]}}
    else:
        ref = {'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': [] if bad == 'source' else 'criterion', 'port_id': 'text', 'position': 0}}
        doc['cards'][0]['standard'] = {'document': {'segments': [ref, {'id': 'text', 'kind': 'text', 'text': 7}]}}

    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'invalid', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,field', [('criterion', 'standard'), ('creative_control', 'keep'), ('guidance', 'prohibitions'), ('fact', 'fact'), ('performance_rule', 'applicability')])
async def test_requirements_retire_generic_objects_without_losing_field_candidates(canvas_client, kind, field):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '标准引用'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'prop', 'port_id': 'text', 'position': 0}
    doc = canvas['document']
    doc.update(cards=[{'id': 'prop', 'type': 'content.prop', 'object_id': 'key', 'name': '钥匙', 'text': '完整钥匙说明'},
        {'id': 'criterion', 'type': 'direction.' + kind, **({'criterion_id': 'visible', 'name': '钥匙可见'} if kind == 'criterion' else {'name': '钥匙可见'} if kind in ('creative_control', 'guidance') else {}),
         field: {'state': 'fact', 'text': '钥匙清晰可见'},
         'input_bindings': [{'id': 'old', 'input_port': 'effect_object', 'source': {**source, 'port_id': 'object', 'object_id': 'key'}}]}],
        edges=[{'id': 'old', 'source_card': 'prop', 'source_port': 'object', 'target_card': 'criterion', 'target_port': 'effect_object'}],
        input_order={'criterion': {'effect_object': ['old']}})
    saved = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    reopened = (await canvas_client.get(url)).json()['data']
    criterion = reopened['document']['cards'][1]
    assert criterion['input_bindings'] == []
    assert criterion[field]['text'] == '钥匙清晰可见'
    assert reopened['document']['edges'] == [{'id': 'old', 'source_card': 'prop', 'source_port': 'text', 'target_card': 'criterion', 'target_port': 'text'}]
    assert reopened['document']['input_order']['criterion']['text'] == ['old']
    outputs = (await canvas_client.get(url + '/cards/criterion/outputs')).json()['data']['outputs']
    assert '完整钥匙说明' not in outputs[0]['text']
    assert '作用对象' not in outputs[0]['text']
    criterion[field] = {'state': 'fact', 'text': '@引用必须可见', 'document': {'segments': [
        {'id': 'reference', 'kind': 'reference', 'source': source}, {'id': 'text', 'kind': 'text', 'text': '必须可见'}]}}
    response = await canvas_client.put(url, json={'request_id': 'reference', 'expected_revision': reopened['revision'], 'document': reopened['document']})
    assert response.status_code == 200, response.text
    outputs = (await canvas_client.get(url + '/cards/criterion/outputs')).json()['data']['outputs']
    assert '完整钥匙说明' in outputs[0]['text']

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,field', [('criterion', 'standard'), ('creative_control', 'keep'), ('guidance', 'prohibitions'), ('fact', 'fact'), ('performance_rule', 'applicability')])
async def test_old_requirement_object_cleanup_is_idempotent_and_preserves_other_uses(canvas_client, canvas_file_store, kind, field):
    from app.models.generation_canvas import GenerationCanvas
    canvas = (await canvas_client.post('/canvases/p', json={'name': '旧对象关系'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'prop', 'port_id': 'object', 'position': 0, 'object_id': 'key'}
    edge = lambda ident, target, source_port, target_port: {'id': ident, 'source_card': 'prop', 'source_port': source_port, 'target_card': target, 'target_port': target_port}
    doc = canvas['document']
    doc.update(cards=[{'id': 'prop', 'type': 'content.prop', 'object_id': 'key', 'name': '钥匙', 'text': '参考正文'},
        {'id': 'criterion', 'type': 'direction.' + kind, **({'name': '清晰可见', 'criterion_id': 'visible'} if kind == 'criterion' else {'name': '清晰可见'} if kind in ('creative_control', 'guidance') else {}), field: {'text': '钥匙可见', 'authorship': 'user'}, 'input_bindings': [{'id': 'old', 'input_port': 'effect_object', 'source': source}]},
        {'id': 'guidance', 'type': 'direction.focus', 'input_bindings': [{'id': 'keep', 'input_port': 'attention_object', 'source': source}]}],
        edges=[edge('old', 'criterion', 'object', 'effect_object'), edge('existing', 'criterion', 'text', 'text'), edge('keep', 'guidance', 'object', 'attention_object')],
        input_order={'criterion': {'effect_object': ['old'], 'text': ['existing']}, 'guidance': {'attention_object': ['keep']}})
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    first = (await canvas_client.get(url)).json()['data']
    second = (await canvas_client.get(url)).json()['data']
    assert first == second
    assert first['revision'] == 1
    assert first['document']['cards'][1]['input_bindings'] == []
    assert first['document']['cards'][1][field]['text'] == '钥匙可见'
    assert first['document']['cards'][1][field]['authorship'] == 'user'
    assert first['document']['cards'][2]['input_bindings'][0]['source'] == source
    assert first['document']['cards'][2]['input_bindings'][0]['input_port'] == 'attention_object'
    assert [row['id'] for row in first['document']['edges']] == ['existing', 'keep']
    assert first['document']['input_order'] == {'criterion': {'text': ['existing']}, 'guidance': {'attention_object': ['keep']}}
    stale = await canvas_client.put(url, json={'request_id': 'stale', 'expected_revision': 0, 'document': doc})
    assert stale.status_code == 409
    catalog = (await canvas_client.get(url + '/catalog')).json()['data']['cards']
    assert 'effect_object' not in [port['id'] for card in catalog if card['type'] == 'direction.criterion' for port in card['inputs']]
    assert 'effect_object' not in [port['id'] for card in catalog if card['type'] == 'direction.' + kind for port in card['inputs']]
    assert 'attention_object' in [port['id'] for card in catalog if card['type'] == 'direction.focus' for port in card['inputs']]
