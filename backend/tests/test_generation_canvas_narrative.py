"""叙事设计通过公开 HTTP 保存并发布完整本卡设计。"""
from tests.canvas_urls import canvas_url, seed_scene_canvas
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,identity,fields', [
    ('narrative', None, {'viewpoint': '小雪视点', 'information_change': '秘密揭露', 'relationship_change': '信任破裂', 'turning_point': '决定离开', 'open_questions': '去往何处'}),
    ('beat', 'beat_id', {'objective': '拿到钥匙', 'obstacle': '门被锁住', 'expected_change': '获得主动', 'audience_must_see': '握住钥匙'}),
    ('event', 'event_id', {'action_change': '钟声响起'}),
    ('shot', 'shot_id', {'narrative_role': '揭示选择', 'visible_result': '拿起钥匙', 'estimated_duration': '约五秒'}),
])
async def test_independent_narrative_cards_keep_complete_fields_and_stable_identity(canvas_client, kind, identity, fields):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '叙事'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    card = {'id': 'design', 'type': 'direction.' + kind, 'name': '决定', **{key: {'state': 'undecided', 'text': value} for key, value in fields.items()}}
    if identity:
        card[identity] = 'stable'
    doc = canvas['document']
    doc['cards'] = [card]
    saved = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    output = (await canvas_client.get(url + '/cards/design/outputs')).json()['data']['outputs']
    assert output[0]['payload']['adoption'] == 'whole_card'
    for key, value in fields.items():
        assert output[0]['payload']['fields'][key]['text'] == value
        assert output[0]['payload']['fields'][key]['state'] == 'undecided'
    if identity:
        assert output[1]['payload'] == {'kind': 'narrative_reference', 'category': kind, 'reference_id': 'stable', 'name': '决定'}
    assert (await canvas_client.get(url)).json()['data']['document']['cards'][0]['name'] == '决定'

@pytest.mark.asyncio
async def test_story_references_keep_distinct_uses_without_expanding_text(canvas_client):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '关系'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    def source(card, port):
        return {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0, 'object_id': card}
    doc = canvas['document']
    doc.update(cards=[{'id': 'event', 'type': 'direction.event', 'event_id': 'event', 'name': '钟响', 'action_change': {'state': 'fact', 'text': '祖先事件正文'}},
        {'id': 'beat', 'type': 'direction.beat', 'beat_id': 'beat', 'name': '觉醒', 'objective': {'state': 'proposal', 'text': '祖先节拍正文'}},
        {'id': 'performance', 'type': 'direction.performance', 'physical_action': {'state': 'proposal', 'text': '抬头'}, 'input_bindings': [{'id': 'b', 'input_port': 'beat', 'source': source('beat', 'beat')}, {'id': 'e', 'input_port': 'received_event', 'source': source('event', 'event')}]},
        {'id': 'blocking', 'type': 'direction.blocking', 'blocking_id': 'blocking', 'name': '转身', 'path': {'state': 'proposal', 'text': '祖先调度正文'}, 'input_bindings': [{'id': 'e', 'input_port': 'change_event', 'source': source('event', 'event')}]},
        {'id': 'activity', 'type': 'direction.activity', 'task': {'state': 'proposal', 'text': '整理衣袖'}, 'input_bindings': [{'id': 'e', 'input_port': 'trigger_event', 'source': source('event', 'event')}]},
        {'id': 'shot', 'type': 'direction.shot', 'shot_id': 'shot', 'name': '反应', 'visible_result': {'state': 'proposal', 'text': '看向门口'}, 'input_bindings': [{'id': 'b', 'input_port': 'covered_beat', 'source': source('beat', 'beat')}, {'id': 'e', 'input_port': 'related_event', 'source': source('event', 'event')}, {'id': 's', 'input_port': 'blocking_basis', 'source': source('blocking', 'blocking')}]}], edges=[], input_order={})
    for card in doc['cards']:
        for binding in card.get('input_bindings', []):
            ident = card['id'] + binding['id']
            doc['edges'].append({'id': ident, 'source_card': binding['source']['card_id'], 'source_port': binding['source']['port_id'], 'target_card': card['id'], 'target_port': binding['input_port']})
            doc['input_order'].setdefault(card['id'], {}).setdefault(binding['input_port'], []).append(ident)
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    for card, labels in [('performance', ['所属节拍', '接收事件']), ('blocking', ['变化事件']), ('activity', ['触发事件']), ('shot', ['覆盖节拍', '关联事件', '调度依据'])]:
        outputs = (await client.get(url + f'/cards/{card}/outputs')).json()['data']['outputs']
        text = outputs[0]['text']
        assert all(label in text for label in labels)
        assert '祖先事件正文' not in text and '祖先节拍正文' not in text
        if card == 'shot':
            assert '祖先调度正文' not in text
    # A still referenced source cannot be deleted; invalidation must not silently reuse old content.
    doc['cards'] = doc['cards'][1:]
    doc['edges'] = [edge for edge in doc['edges'] if edge['source_card'] != 'event']
    for ports in doc['input_order'].values():
        for port, order in ports.items():
            ports[port] = [ident for ident in order if any(edge['id'] == ident for edge in doc['edges'])]
    response = await client.put(url, json={'request_id': 'delete', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'

@pytest.mark.asyncio
@pytest.mark.parametrize('case,code', [('identity', 'IMMUTABLE_NARRATIVE_IDENTITY'), ('duplicate', 'DUPLICATE_NARRATIVE_IDENTITY'), ('name', 'DUPLICATE_NARRATIVE_NAME'), ('invalid', 'INVALID_NARRATIVE_CATEGORY'), ('beat_count', 'BEAT_COUNT_EXCEEDED'), ('cycle', 'GRAPH_CYCLE')])
async def test_story_identity_and_relation_errors_are_located(canvas_client, case, code):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '约束'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    doc = canvas['document']
    doc['cards'] = [{'id': 'beat', 'type': 'direction.beat', 'beat_id': 'one', 'name': '开始'}]
    assert (await canvas_client.put(url, json={'request_id': 'first', 'expected_revision': 0, 'document': doc})).status_code == 200
    if case == 'identity':
        doc['cards'][0]['beat_id'] = 'changed'
    elif case in ('duplicate', 'name'):
        doc['cards'].append({'id': 'other', 'type': 'direction.beat', 'beat_id': 'one' if case == 'duplicate' else 'two', 'name': '另一节拍' if case == 'duplicate' else '开始'})
    elif case == 'invalid':
        doc['cards'] += [{'id': 'place', 'type': 'content.place', 'object_id': 'place', 'name': '大厅'}, {'id': 'shot', 'type': 'direction.shot', 'input_bindings': [{'id': 'invalid', 'input_port': 'participant', 'source': {'canvas_id': canvas['id'], 'card_id': 'place', 'port_id': 'object', 'object_id': 'place', 'position': 0}}]}]
        doc.update(edges=[{'id': 'p', 'source_card': 'place', 'source_port': 'object', 'target_card': 'shot', 'target_port': 'participant'}], input_order={'shot': {'participant': ['p']}})
    elif case == 'beat_count':
        doc['cards'] += [{'id': 'two', 'type': 'direction.beat', 'beat_id': 'two', 'name': '随后'}, {'id': 'performance', 'type': 'direction.performance', 'input_bindings': [{'id': name, 'input_port': 'beat', 'source': {'canvas_id': canvas['id'], 'card_id': name, 'port_id': 'beat', 'object_id': ident, 'position': 0}} for name, ident in [('beat', 'one'), ('two', 'two')]]}]
        doc.update(edges=[{'id': name, 'source_card': name, 'source_port': 'beat', 'target_card': 'performance', 'target_port': 'beat'} for name in ['beat', 'two']], input_order={'performance': {'beat': ['beat', 'two']}})
    else:
        doc['cards'] += [{'id': 'shot', 'type': 'direction.shot'}, {'id': 'model', 'type': 'model.image'}]
        doc.update(edges=[{'id': 'out', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}, {'id': 'back', 'source_card': 'model', 'source_port': 'image', 'target_card': 'shot', 'target_port': 'image'}], input_order={'shot': {'image': ['back']}, 'model': {'text': ['out']}})
    response = await canvas_client.put(url, json={'request_id': 'second', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == code, response.text


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401

@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'image', 'video'])
async def test_actual_worker_receives_complete_shot_design_with_explicit_ancestors(runtime, image_storage, monkeypatch, modality):
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
            provider.provider_key = 'volcengine'
    source = lambda card, port, **extra: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = runtime.document
    doc.update(cards=[{'id': 'person', 'type': 'direction.event', 'event_id': 'alice', 'name': '钟响', 'action_change': {'state': 'fact', 'text': '秘密事件正文'}},
                     {'id': 'act', 'type': 'direction.shot', 'shot_id': 'reaction', 'name': '反应镜头', 'narrative_role': {'state': 'proposal', 'text': '伸手'}, 'visible_result': {'state': 'fact', 'text': '看向门口'},
                      'input_bindings': [{'id': 'p', 'source': source('person', 'event', object_id='alice'), 'input_port': 'related_event'}]},
                     {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {},
                      'input_bindings': [{'id': 'whole', 'source': source('act', 'text'), 'input_port': 'text'}]}],
               edges=[{'id': 'p', 'source_card': 'person', 'source_port': 'event', 'target_card': 'act', 'target_port': 'related_event'}, {'id': 'd', 'source_card': 'act', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
               input_order={'act': {'related_event': ['p']}, 'consumer': {'text': ['d']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direction', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '秘密事件正文' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    received = []
    class ProviderText:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='完整空间分析')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ProviderText)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
            if modality == 'image':
                received.append(body['prompt'])
                return httpx.Response(200, json={'data': [{'b64_json': 'eA=='}]})
            received.append(body['content'][0]['text'])
            return httpx.Response(200, json={'id': 'performance-video'})
        if request.url.host == 'media.test':
            return httpx.Response(200, content=b'whole-performance-video', headers={'Content-Type': 'video/mp4'})
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
    assert '伸手' in received[0] and '看向门口' in received[0] and '钟响' in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']


    reopened = (await runtime.client.get(runtime.url)).json()['data']['document']
    assert reopened['cards'][1]['visible_result']['state'] == 'fact'

@pytest.mark.asyncio
async def test_renaming_copying_and_invalidating_story_sources_preserves_identity(canvas_client):
    client = canvas_client
    canvas = (await seed_scene_canvas(client, '/canvases/p', json={'name': '身份生命周期'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'event', 'port_id': 'event', 'object_id': 'bell', 'position': 0}
    doc.update(cards=[{'id': 'event', 'type': 'direction.event', 'event_id': 'bell', 'name': '钟响', 'action_change': {'state': 'proposal', 'text': '清脆钟声'}},
        {'id': 'shot', 'type': 'direction.shot', 'shot_id': 'shot', 'name': '反应', 'input_bindings': [{'id': 'event', 'input_port': 'related_event', 'source': source}]}],
        edges=[{'id': 'edge', 'source_card': 'event', 'source_port': 'event', 'target_card': 'shot', 'target_port': 'related_event'}], input_order={'shot': {'related_event': ['edge']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['name'] = '远处钟响'
    doc['cards'].append({**doc['cards'][0], 'id': 'copy', 'event_id': 'other-bell', 'name': '另一个钟声'})
    response = await client.put(url, json={'request_id': 'rename-copy', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200, response.text
    output = (await client.get(url + '/cards/shot/outputs')).json()['data']['outputs'][0]
    assert '远处钟响' in output['text'] and '清脆钟声' not in output['text']
    assert output['payload']['narrative_relations'][0]['reference']['reference_id'] == 'bell'
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['cards'][0]['event_id'] == 'bell' and reopened['cards'][2]['event_id'] == 'other-bell'
    doc['cards'][0]['name'] = ''
    response = await client.put(url, json={'request_id': 'invalidate', 'expected_revision': 2, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'INVALID_NARRATIVE_BINDING'
    assert response.json()['detail']['target']['path'] == ['input_bindings', 'event']

@pytest.mark.asyncio
async def test_camera_can_select_one_shot_without_reading_its_design(canvas_client):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '摄影所属镜头'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    source = {'canvas_id': canvas['id'], 'card_id': 'shot', 'port_id': 'shot', 'position': 0, 'object_id': 'reaction'}
    doc = canvas['document']
    doc.update(cards=[{'id': 'shot', 'type': 'direction.shot', 'shot_id': 'reaction', 'name': '反应镜头', 'visible_result': {'state': 'proposal', 'text': '不跨级传递的镜头全文'}},
        {'id': 'photo', 'type': 'direction.camera', 'fields': {'viewpoint': {'state': 'proposal', 'text': '人物居右'}}, 'input_bindings': [{'id': 'shot', 'input_port': 'shot', 'source': source}]}],
        edges=[{'id': 'edge', 'source_card': 'shot', 'source_port': 'shot', 'target_card': 'photo', 'target_port': 'shot'}], input_order={'photo': {'shot': ['edge']}})
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    output = (await canvas_client.get(url + '/cards/photo/outputs')).json()['data']['outputs'][0]
    assert output['payload']['references'][0] == {'kind': 'narrative_reference', 'category': 'shot', 'reference_id': 'reaction', 'name': '反应镜头'}
    assert '所属镜头：反应镜头' in output['text'] and '不跨级' not in output['text']
    doc['cards'].insert(1, {'id': 'other', 'type': 'direction.shot', 'shot_id': 'other', 'name': '另一个镜头'})
    doc['cards'][2]['input_bindings'].append({'id': 'other', 'input_port': 'shot', 'source': {**source, 'card_id': 'other', 'object_id': 'other'}})
    doc['edges'].append({'id': 'other', 'source_card': 'other', 'source_port': 'shot', 'target_card': 'photo', 'target_port': 'shot'})
    doc['input_order']['photo']['shot'].append('other')
    response = await canvas_client.put(url, json={'request_id': 'two', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'SHOT_COUNT_EXCEEDED'

@pytest.mark.asyncio
async def test_image_target_uses_shot_visible_result_and_keeps_whole_design(canvas_client):
    canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '镜头画面目标'})).json()['data']
    url = canvas_url(f"/canvases/p/{canvas['id']}")
    doc = canvas['document']
    doc.update(cards=[{'id': 'shot', 'type': 'direction.shot', 'name': '决定', 'visible_result': {'state': 'proposal', 'text': '握住钥匙'}, 'estimated_duration': {'state': 'undecided', 'text': '约五秒'}},
        {'id': 'image', 'type': 'model.image', 'input_bindings': [{'id': 'design', 'input_port': 'text', 'source': {'canvas_id': canvas['id'], 'card_id': 'shot', 'port_id': 'text', 'position': 0}}], 'frame_targets': [{'binding_id': 'design', 'state_id': 'field:visible_result'}]}],
        edges=[{'id': 'design', 'source_card': 'shot', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}], input_order={'image': {'text': ['design']}})
    response = await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await canvas_client.get(url + '/cards/image/compile')).json()['data']
    assert not any(row['code'] == 'FRAME_TARGET_MISSING' for row in compiled['diagnostics'])
    assert '画面目标：可见结果' in compiled['text']
    assert compiled['used'][0]['payload']['frame_states'] == [{'id': 'field:visible_result', 'label': '可见结果'}]
    assert '握住钥匙' in compiled['text'] and '约五秒' in compiled['text']
    assert compiled['used'][0]['payload']['adoption'] == 'whole_card'
