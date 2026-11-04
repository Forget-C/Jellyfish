"""Performance cards exercised through saved canvas HTTP boundaries."""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_complete_performance_output_keeps_states_and_only_direct_identity(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '表演'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    def source(card, port, **extra):
        return {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc.update(cards=[
        {'id': 'ref', 'type': 'reference.character', 'objects': [{'object_id': 'alice', 'name': '小雪', 'category': 'character'}]},
        {'id': 'act', 'type': 'direction.performance', 'objective': {'text': '拿回钥匙', 'state': 'proposal', 'purpose': 'background'},
         'physical_action': {'text': '伸手', 'state': 'fact', 'purpose': 'design'}, 'voice': {'state': 'absent'},
         'gaze': {'text': '旧内容不可生效', 'state': 'not_applicable'},
         'input_bindings': [{'id': 'person', 'source': source('ref', 'object', object_id='alice'), 'input_port': 'participant'}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'act', 'source': source('act', 'text'), 'input_port': 'text'}]}],
        edges=[{'id': 'a', 'source_card': 'ref', 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'},
               {'id': 'b', 'source_card': 'act', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'act': {'participant': ['a']}, 'model': {'text': ['b']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/act/outputs')).json()['data']['outputs']
    assert len(output) == 1
    payload = output[0]['payload']
    assert payload['kind'] == 'design' and payload['adoption'] == 'whole_card'
    assert payload['objects'][0]['object_id'] == 'alice'
    assert payload['fields']['objective']['state'] == 'proposal'
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '拿回钥匙' in compiled['text'] and '提议' in compiled['text']
    assert '小雪' in compiled['text'] and '明确没有' in compiled['text']
    assert '旧内容不可生效' not in compiled['text'] and not compiled['media']
    reopened = (await client.get(url)).json()['data']['document']['cards'][1]
    assert reopened['gaze']['text'] == '旧内容不可生效'


@pytest.mark.asyncio
@pytest.mark.parametrize('objects,selected,port,code', [
    ([('a', 'character'), ('b', 'character')], ['a', 'b'], 'participant', 'PARTICIPANT_COUNT_EXCEEDED'),
    ([('a', 'place')], ['a'], 'participant', 'INVALID_DESIGN_CATEGORY'),
    ([('a', 'character')], [None], 'participant', 'INVALID_DESIGN_BINDING'),
    ([('a', 'character')], ['missing'], 'effect_object', 'INVALID_DESIGN_BINDING'),
])
async def test_design_relations_require_specific_eligible_direct_objects(canvas_client, objects, selected, port, code):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '选择对象'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': ident, 'type': 'reference.' + category, 'object_id': ident, 'name': ident} for ident, category in objects] +
                     [{'id': 'act', 'type': 'direction.performance', 'input_bindings': [{'id': str(index), 'input_port': port,
                      'source': {'canvas_id': canvas['id'], 'card_id': ident if ident in dict(objects) else objects[0][0], 'port_id': 'object', 'position': 0, 'object_id': ident}} for index, ident in enumerate(selected)]}],
               edges=[{'id': ident, 'source_card': ident, 'source_port': 'object', 'target_card': 'act', 'target_port': port} for ident, _ in objects], input_order={'act': {port: [ident for ident, _ in objects]}})
    response = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == code


@pytest.mark.asyncio
async def test_examples_are_protected_direct_media_and_never_enter_design_output(canvas_client):
    client = canvas_client
    file = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('demo.mp4', b'video', 'video/mp4')})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '示例'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'v', 'port_id': 'video', 'position': 0}
    doc.update(cards=[{'id': 'v', 'type': 'content.video', 'file_id': file['id']},
        {'id': 'rule', 'type': 'direction.performance_rule', 'applicability': {'state': 'proposal', 'text': '动作克制', 'purpose': 'constraint'},
         'examples': [{'id': 'ex', 'source': source, 'file_id': file['id'], 'start_ms': 100, 'end_ms': 900, 'purpose': 'negative', 'field_id': 'applicability'}]}],
        edges=[{'id': 'e', 'source_card': 'v', 'source_port': 'video', 'target_card': 'rule', 'target_port': 'video_example'}], input_order={'rule': {'video_example': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    assert (await client.get(url)).json()['data']['document']['cards'][1]['examples'][0]['field_id'] == 'applicability'
    outputs = (await client.get(url + '/cards/rule/outputs')).json()['data']['outputs']
    assert file['id'] not in str(outputs) and '900' not in str(outputs)
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    response = await client.put(url, json={'request_id': 'delete', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'REFERENCE_IN_USE'


@pytest.mark.asyncio
async def test_incomplete_performance_can_be_analyzed_but_visual_action_needs_its_subject(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '独立设计'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'act', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'act', 'type': 'direction.performance', 'physical_action': {'text': '伸手', 'state': 'proposal'}},
                     {'id': 'text', 'type': 'model.text', 'input_bindings': [{'id': 'a', 'source': source, 'input_port': 'text'}]},
                     {'id': 'video', 'type': 'model.video', 'input_bindings': [{'id': 'a', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': key, 'source_card': 'act', 'source_port': 'text', 'target_card': key, 'target_port': 'text'} for key in ('text', 'video')],
        input_order={key: {'text': [key]} for key in ('text', 'video')})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    text = (await client.get(url + '/cards/text/compile')).json()['data']
    video = (await client.get(url + '/cards/video/compile')).json()['data']
    assert 'DESIGN_SUBJECT_REQUIRED' not in [row['code'] for row in text['diagnostics']]
    assert 'DESIGN_SUBJECT_REQUIRED' in [row['code'] for row in video['diagnostics']]


@pytest.mark.asyncio
async def test_example_keeps_fixed_file_when_source_content_changes(canvas_client):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': (f'{index}.png', b'image', 'image/png')})).json()['data']['id'] for index in range(2)]
    canvas = (await client.post('/canvases/p', json={'name': '固定示例'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': files[0]}, {'id': 'rule', 'type': 'direction.performance_rule',
        'examples': [{'id': 'e', 'file_id': files[0], 'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}}]}],
        edges=[{'id': 'e', 'source_card': 'image', 'source_port': 'image', 'target_card': 'rule', 'target_port': 'image_example'}], input_order={'rule': {'image_example': ['e']}})
    assert (await client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][0]['file_id'] = files[1]
    replaced = await client.put(url, json={'request_id': 'replace', 'expected_revision': 1, 'document': doc})
    assert replaced.status_code == 200, replaced.text
    reopened = (await client.get(url)).json()['data']['document']['cards'][1]
    assert reopened['examples'][0]['file_id'] == files[0]

    doc['name'] = '继续编辑'
    again = await client.put(url, json={'request_id': 'again', 'expected_revision': 2, 'document': doc})
    assert again.status_code == 200, again.text
    release = f'/files/{files[0]}/upload-retention?project_id=p'
    assert (await client.delete(release)).status_code == 409
    doc['cards'][1]['examples'] = []
    assert (await client.put(url, json={'request_id': 'clear-example', 'expected_revision': 3, 'document': doc})).status_code == 200
    assert (await client.delete(release)).status_code == 200
    assert (await client.delete(f'/files/{files[0]}')).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('state,phrase,visible', [('empty', '', False), ('not_applicable', '', False), ('absent', '明确没有', True), ('undecided', '待确定', True), ('proposal', '提议', True), ('fact', '事实', True)])
async def test_situation_retains_explicit_field_meaning_without_text_correction(canvas_client, state, phrase, visible):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '情境状态'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 's', 'type': 'direction.situation', 'situation': {'state': state, 'text': '特写和全景同时存在', 'purpose': 'background', 'source_locator': '原文1'},
                    'scope': {'description': '窗边', 'condition': '下雨时', 'phase': 'video'}, 'source_locator': '导演备注'}]
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200
    outputs = (await client.get(url + '/cards/s/outputs')).json()['data']['outputs']
    assert bool(outputs) is visible
    if visible:
        text = outputs[0]['text']
        assert phrase in text and '背景 / 当前处境' in text and '特写和全景同时存在' in text
        assert '窗边' in text and '下雨时' in text and '导演备注' in text and '原文1' in text


@pytest.mark.asyncio
async def test_design_rejects_field_adoption_and_preserves_all_performance_fields(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '完整字段'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    fields = ['objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment', 'physical_action', 'gaze', 'breath', 'weight', 'hands', 'voice', 'delivery', 'reaction_order', 'exit_state', 'avoid']
    doc['cards'] = [{'id': 'act', 'type': 'direction.performance', **{field: {'text': field, 'state': 'proposal'} for field in fields}}, {'id': 'model', 'type': 'model.text'}]
    doc.update(edges=[{'id': 'partial', 'source_card': 'act', 'source_port': 'gaze', 'target_card': 'model', 'target_port': 'text'}], input_order={'model': {'text': ['partial']}})
    invalid = await client.put(url, json={'request_id': 'partial', 'expected_revision': 0, 'document': doc})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'INVALID_ENDPOINT'
    doc.update(edges=[], input_order={})
    assert (await client.put(url, json={'request_id': 'full', 'expected_revision': 0, 'document': doc})).status_code == 200
    saved = (await client.get(url)).json()['data']['document']['cards'][0]
    output = (await client.get(url + '/cards/act/outputs')).json()['data']['outputs'][0]
    for field in fields:
        assert saved[field]['text'] == field
        assert output['payload']['fields'][field]['text'] == field


@pytest.mark.asyncio
async def test_design_example_and_object_relations_share_cycle_protection(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '无环'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'act', 'type': 'direction.performance'}, {'id': 'image', 'type': 'model.image'}],
        edges=[{'id': 'a', 'source_card': 'act', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'},
               {'id': 'b', 'source_card': 'image', 'source_port': 'image', 'target_card': 'act', 'target_port': 'image_example'}],
        input_order={'image': {'text': ['a']}, 'act': {'image_example': ['b']}})
    result = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert result.status_code == 422 and result.json()['detail']['code'] == 'GRAPH_CYCLE'


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'video'])
async def test_actual_worker_receives_whole_design_with_explicit_ancestor_description(runtime, image_storage, monkeypatch, modality):
    import asyncio
    import json
    from types import SimpleNamespace
    import httpx
    from app.models.llm import Model, Provider
    from app.task_worker import TaskWorker
    from app.services.task_service import utcnow
    from datetime import timedelta
    async with runtime.sessions.begin() as db:
        if modality == 'video':
            model = await db.get(Model, runtime.model_id)
            model.name, model.category, model.params = 'doubao-seedance', 'video', {}
            provider = await db.get(Provider, runtime.provider_id)
            provider.name = 'volcengine'
    source = lambda card, port, **extra: {'canvas_id': runtime.canvas_id, 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc = runtime.document
    doc.update(cards=[{'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪', 'text': '秘密外貌描述'},
                     {'id': 'act', 'type': 'direction.performance', 'physical_action': {'state': 'proposal', 'text': '伸手'}, 'gaze': {'state': 'fact', 'text': '看向门口'},
                      'input_bindings': [{'id': 'p', 'source': source('person', 'object', object_id='alice'), 'input_port': 'participant'}]},
                     {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {},
                      'input_bindings': [{'id': 'whole', 'source': source('act', 'text'), 'input_port': 'text'}]}],
               edges=[{'id': 'p', 'source_card': 'person', 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'}, {'id': 'd', 'source_card': 'act', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
               input_order={'act': {'participant': ['p']}, 'consumer': {'text': ['d']}})
    saved = await runtime.client.put(runtime.url, json={'request_id': 'direction', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'consumer'})).json()['data']
    assert preview['can_run'], preview
    assert not preview['input']['media'] and '秘密外貌描述' in preview['input']['text']
    accepted = await runtime.client.post(runtime.url + '/runs', json={'request_id': 'run', 'preview_token': preview['preview_token']})
    assert accepted.status_code == 200
    received = []
    class ProviderText:
        def __init__(self, **kwargs):
            pass
        async def astream(self, messages):
            received.append(messages[0].content)
            yield SimpleNamespace(content='完整表演分析')
    monkeypatch.setattr('app.task_worker.ChatOpenAI', ProviderText)
    def provider_http(request):
        if request.method == 'POST':
            body = json.loads(request.content)
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
    assert '伸手' in received[0] and '看向门口' in received[0] and '小雪' in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']


@pytest.mark.asyncio
@pytest.mark.parametrize('port,start,end', [('image', 0, 10), ('video', 10, 10), ('video', 20, 10), ('video', -1, 10), ('video', None, 10)])
async def test_example_rejects_invalid_or_nonvideo_intervals(canvas_client, port, start, end):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '无效区间'})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'rule', 'type': 'direction.performance_rule', 'examples': [{'id': 'example', 'file_id': 'file',
        'source': {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': port, 'position': 0}, 'start_ms': start, 'end_ms': end}]}]
    result = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert result.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('source_type', ['content.object', 'reference.costume'])
@pytest.mark.parametrize('target_type', ['direction.situation', 'direction.performance'])
async def test_costume_object_can_participate_without_description_or_image(canvas_client, source_type, target_type):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '服装参与'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    source = {'id': 'costume', 'type': source_type}
    if source_type == 'content.object':
        source.update(object_id='coat', name='蓝衣', category='costume', text='不应沿关系读取的正文')
    else:
        source['objects'] = [{'object_id': 'coat', 'name': '蓝衣', 'category': 'costume'}]
    field = 'situation' if target_type == 'direction.situation' else 'physical_action'
    doc.update(cards=[source, {'id': 'design', 'type': target_type, field: {'state': 'proposal', 'text': '在风中摆动'},
        'input_bindings': [{'id': 'subject', 'input_port': 'participant', 'source': {'canvas_id': canvas['id'], 'card_id': 'costume', 'port_id': 'object', 'position': 0, 'object_id': 'coat'}}]}],
        edges=[{'id': 'subject', 'source_card': 'costume', 'source_port': 'object', 'target_card': 'design', 'target_port': 'participant'}], input_order={'design': {'participant': ['subject']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    output = (await client.get(url + '/cards/design/outputs')).json()['data']['outputs'][0]
    assert output['payload']['participant_id'] == 'coat'
    assert output['payload']['objects'] == [{'kind': 'object_reference', 'object_id': 'coat', 'name': '蓝衣', 'category': 'costume'}]
    assert '不应沿关系读取的正文' not in output['text'] and output['file_id'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('card_type,field_id', [('direction.performance', 'physical_action'), ('direction.anchor', 'position')])
async def test_example_field_location_is_saved_and_rejects_other_card_fields(canvas_client, card_type, field_id):
    client = canvas_client
    file_id = (await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': ('example.png', b'image', 'image/png')})).json()['data']['id']
    canvas = (await client.post('/canvases/p', json={'name': '字段定位'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': file_id}, {'id': 'design', 'type': card_type, 'examples': [{'id': 'ex', 'source': {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}, 'file_id': file_id, 'field_id': field_id, 'purpose': 'negative'}]}],
        edges=[{'id': 'edge', 'source_card': 'image', 'source_port': 'image', 'target_card': 'design', 'target_port': 'image_example'}], input_order={'design': {'image_example': ['edge']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    example = (await client.get(url)).json()['data']['document']['cards'][1]['examples'][0]
    assert example['field_id'] == field_id and example['purpose'] == 'negative'
    doc['cards'][1]['examples'][0]['field_id'] = 'standard'
    invalid = await client.put(url, json={'request_id': 'invalid', 'expected_revision': 1, 'document': doc})
    assert invalid.status_code == 422 and invalid.json()['detail']['code'] == 'INVALID_EXAMPLE_FIELD'
