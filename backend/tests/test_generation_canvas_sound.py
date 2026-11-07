"""对白和声音安排通过公开保存、输出、编译边界验证。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_dialogue_speaker_and_complete_sound_design(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '对白声音'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    source = lambda card, port, **extra: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0, **extra}
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'alice', 'name': '小雪', 'text': '祖先秘密'},
        {'id': 'dialogue', 'type': 'direction.dialogue', 'dialogue_id': 'line-1',
         'content': {'text': '请等一等', 'state': 'proposal', 'purpose': 'design'},
         'input_bindings': [{'id': 'speaker', 'source': source('person', 'object', object_id='alice'), 'input_port': 'speaker'}]},
        {'id': 'sound', 'type': 'direction.sound', 'environment': {'text': '雨声', 'state': 'fact', 'purpose': 'background'},
         'music': {'text': '不要音乐', 'state': 'absent', 'purpose': 'constraint'}},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [
            {'id': key, 'source': source(key, 'text'), 'input_port': 'text'} for key in ('dialogue', 'sound')]}],
        edges=[{'id': 'speaker', 'source_card': 'person', 'source_port': 'object', 'target_card': 'dialogue', 'target_port': 'speaker'},
            *[{'id': key, 'source_card': key, 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'} for key in ('dialogue', 'sound')]],
        input_order={'dialogue': {'speaker': ['speaker']}, 'model': {'text': ['dialogue', 'sound']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    payload = (await client.get(url + '/cards/dialogue/outputs')).json()['data']['outputs'][0]['payload']
    assert payload['dialogue_id'] == 'line-1' and 'version' not in payload
    assert payload['participant_id'] == 'alice' and payload['adoption'] == 'whole_card'
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert '请等一等' in compiled['text'] and '小雪' in compiled['text'] and '制作安排' not in compiled['text']
    assert '祖先秘密' in compiled['text'] and not compiled['media']
    assert (await client.get(url)).json()['data']['document']['cards'][1]['dialogue_id'] == 'line-1'


@pytest.mark.asyncio
async def test_performance_explicitly_adopts_dialogue_identity_without_reverse_dependency(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '对白依据'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    source = lambda card, port: {'canvas_id': canvas['id'], 'card_id': card, 'port_id': port, 'position': 0}
    doc.update(cards=[{'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'line-7', 'content': {'text': '等等', 'state': 'proposal'}},
        {'id': 'act', 'type': 'direction.performance', 'physical_action': {'text': '转头', 'state': 'proposal'},
         'input_bindings': [{'id': 'line', 'source': source('line', 'dialogue'), 'input_port': 'dialogue_basis'}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'act', 'source': source('act', 'text'), 'input_port': 'text'}]}],
        edges=[{'id': 'a', 'source_card': 'line', 'source_port': 'dialogue', 'target_card': 'act', 'target_port': 'dialogue_basis'},
               {'id': 'b', 'source_card': 'act', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'act': {'dialogue_basis': ['a']}, 'model': {'text': ['b']}})
    response = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 200, response.text
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert 'line-7' in compiled['text'] and '版本' not in compiled['text'] and '等等' in compiled['text']
    relation = (await client.get(url + '/cards/line/outputs')).json()['data']['outputs'][1]['payload']
    assert relation == {'kind': 'dialogue_reference', 'dialogue_id': 'line-7', 'speaker': None}
    assert 'content' not in (await client.get(url + '/cards/act/outputs')).json()['data']['outputs'][0]['payload']['dialogue_basis'][0]
    deleted = {**doc, 'cards': doc['cards'][1:], 'edges': doc['edges'][1:], 'input_order': {'model': {'text': ['b']}}}
    protected = await client.put(url, json={'request_id': 'delete-source', 'expected_revision': 1, 'document': deleted})
    assert protected.status_code == 422 and protected.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][1]['input_bindings'] = []
    assert (await client.put(url, json={'request_id': 'remove', 'expected_revision': 1, 'document': doc})).status_code == 200
    assert '等等' not in (await client.get(url + '/cards/model/compile')).json()['data']['text']


@pytest.mark.asyncio
async def test_image_uses_sound_design_as_visible_meaning_and_requires_explicit_speaker(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '声音画面含义'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'line', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'l', 'content': {'text': '喂', 'state': 'proposal'}},
        {'id': 'image', 'type': 'model.image', 'input_bindings': [{'id': 'line', 'source': source, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'line', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}], input_order={'image': {'text': ['e']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(url + '/cards/image/compile')).json()['data']
    assert '仅表达可见声源或说话状态' in compiled['text'] and '图片不包含声音' in compiled['text']
    assert 'DESIGN_SUBJECT_REQUIRED' in [row['code'] for row in compiled['diagnostics']]


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,card_type', [('audio', 'direction.sound'), ('audio', 'direction.dialogue'), ('video', 'direction.dialogue')])
async def test_fixed_reference_interval_and_file_retention_do_not_propagate(canvas_client, kind, card_type):
    client = canvas_client
    files = [(await client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'}, files={'file': (f'{i}.wav' if kind == 'audio' else f'{i}.mp4', b'media', 'audio/wav' if kind == 'audio' else 'video/mp4')})).json()['data']['id'] for i in range(2)]
    canvas = (await client.post('/canvases/p', json={'name': '声音参考'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc.update(cards=[{'id': 'audio', 'type': 'content.' + kind, 'file_id': files[0]},
        {'id': 'sound', 'type': card_type, **({'environment': {'text': '风声', 'state': 'undecided'}} if card_type == 'direction.sound' else {'dialogue_id': 'line', 'content': {'text': '对白', 'state': 'proposal'}}),
         'examples': [{'id': 'ex', 'source': {'canvas_id': canvas['id'], 'card_id': 'audio', 'port_id': kind, 'position': 0}, 'file_id': files[0], 'purpose': 'negative', 'start_ms': 100, 'end_ms': 900}]}],
        edges=[{'id': 'e', 'source_card': 'audio', 'source_port': kind, 'target_card': 'sound', 'target_port': kind + '_example'}], input_order={'sound': {kind + '_example': ['e']}})
    saved = await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    doc['cards'][0]['file_id'] = files[1]
    assert (await client.put(url, json={'request_id': 'replace', 'expected_revision': 1, 'document': doc})).status_code == 200
    output = (await client.get(url + '/cards/sound/outputs')).json()['data']['outputs']
    assert files[0] not in str(output) and '900' not in str(output)
    assert (await client.delete(f'/files/{files[0]}/upload-retention?project_id=p')).status_code == 409
    doc['cards'] = doc['cards'][1:]
    doc.update(edges=[], input_order={})
    protected = await client.put(url, json={'request_id': 'delete-source', 'expected_revision': 2, 'document': doc})
    assert protected.status_code == 422 and protected.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][0]['examples'] = []
    assert (await client.put(url, json={'request_id': 'release', 'expected_revision': 2, 'document': doc})).status_code == 200
    assert (await client.delete(f'/files/{files[0]}/upload-retention?project_id=p')).status_code == 200
    assert (await client.delete(f'/files/{files[0]}')).status_code == 200


from tests.test_generation_canvas_runs import runtime  # noqa: F401
from tests.test_generation_canvas_images import image_storage  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('modality', ['text', 'video'])
async def test_actual_worker_receives_whole_sound_design_without_audio_reference(runtime, image_storage, monkeypatch, modality):
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
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'object_id': 'alice', 'name': '小雪', 'text': '秘密外貌描述'},
                     {'id': 'act', 'type': 'direction.sound', 'source_description': {'state': 'proposal', 'text': '窗外风声', 'document': {'segments': [{'id': 'person', 'kind': 'reference', 'source': source('person', 'text')}, {'id': 'wind', 'kind': 'text', 'text': '窗外风声'}]}}, 'environment': {'state': 'fact', 'text': '细雨'},
                      'input_bindings': []},
                     {'id': 'consumer', 'type': 'model.' + modality, 'model_id': runtime.model_id, 'config': {'ratio': '16:9', 'seconds': 5} if modality == 'video' else {},
                      'input_bindings': [{'id': 'whole', 'source': source('act', 'text'), 'input_port': 'text'}]}],
               edges=[{'id': 'p', 'source_card': 'person', 'source_port': 'text', 'target_card': 'act', 'target_port': 'text'}, {'id': 'd', 'source_card': 'act', 'source_port': 'text', 'target_card': 'consumer', 'target_port': 'text'}],
               input_order={'act': {'text': ['p']}, 'consumer': {'text': ['d']}})
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
    assert '窗外风声' in received[0] and '细雨' in received[0] and '制作安排' not in received[0] and '小雪' in received[0]
    state = (await runtime.client.get(runtime.url + '/runtime')).json()['data']
    node = state['runs'][0]['nodes'][0]
    assert node['status'] == 'succeeded', node
    assert node['result_set_id'] and node['current_output_updated']




@pytest.mark.asyncio
async def test_empty_sound_is_not_published(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '制作安排'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = canvas['document']
    doc['cards'] = [{'id': 'sound', 'type': 'direction.sound'}]
    assert (await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    output = (await canvas_client.get(url + '/cards/sound/outputs')).json()['data']['outputs']
    assert output == []


@pytest.mark.asyncio
@pytest.mark.parametrize('category,ids,code', [('place', ['a'], 'INVALID_DESIGN_CATEGORY'), ('costume', ['a'], 'INVALID_DESIGN_CATEGORY'), ('character', ['a', 'b'], 'SPEAKER_COUNT_EXCEEDED'), ('prop', [None], 'INVALID_DESIGN_BINDING')])
async def test_speaker_requires_one_direct_eligible_identity(canvas_client, category, ids, code):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '说话对象资格'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': key, 'type': 'reference.' + category, 'object_id': key, 'name': key} for key in ('a', 'b')] +
        [{'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'l', 'input_bindings': [{'id': str(i), 'input_port': 'speaker', 'source': {'canvas_id': canvas['id'], 'card_id': key or 'a', 'port_id': 'object', 'position': 0, 'object_id': key}} for i, key in enumerate(ids)]}],
        edges=[{'id': key, 'source_card': key, 'source_port': 'object', 'target_card': 'line', 'target_port': 'speaker'} for key in ('a', 'b')], input_order={'line': {'speaker': ['a', 'b']}})
    result = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert result.status_code == 422 and result.json()['detail']['code'] == code, result.text


@pytest.mark.asyncio
async def test_saved_dialogue_identity_is_protected(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '对白身份'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc['cards'] = [{'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'stable'}]
    assert (await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    for patch, code in [({'dialogue_id': 'other'}, 'INVALID_DIALOGUE_IDENTITY')]:
        doc['cards'][0].update(patch)
        result = await canvas_client.put(url, json={'request_id': code, 'expected_revision': 1, 'document': doc})
        assert result.status_code == 422 and result.json()['detail']['code'] == code


@pytest.mark.asyncio
@pytest.mark.parametrize('start,end', [(100, 100), (100, 50), (None, 100), (-1, 100)])
async def test_audio_reference_rejects_invalid_intervals(canvas_client, start, end):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '区间校验'})).json()['data']
    doc = canvas['document']
    doc['cards'] = [{'id': 'sound', 'type': 'direction.sound', 'examples': [{'id': 'a', 'file_id': 'file', 'source': {'canvas_id': canvas['id'], 'card_id': 'audio', 'port_id': 'audio', 'position': 0}, 'start_ms': start, 'end_ms': end}]}]
    assert (await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 422


@pytest.mark.asyncio
async def test_explicitly_absent_dialogue_does_not_require_invented_speaker(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '没有对白'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc.update(cards=[{'id': 'line', 'type': 'direction.dialogue', 'dialogue_id': 'l', 'content': {'state': 'absent'}}, {'id': 'image', 'type': 'model.image', 'input_bindings': [{'id': 'line', 'source': {'canvas_id': canvas['id'], 'card_id': 'line', 'port_id': 'text', 'position': 0}, 'input_port': 'text'}]}],
        edges=[{'id': 'e', 'source_card': 'line', 'source_port': 'text', 'target_card': 'image', 'target_port': 'text'}], input_order={'image': {'text': ['e']}})
    assert (await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await canvas_client.get(url + '/cards/image/compile')).json()['data']
    assert 'DESIGN_SUBJECT_REQUIRED' not in [row['code'] for row in compiled['diagnostics']]
    assert '明确没有' in compiled['text']


@pytest.mark.asyncio
@pytest.mark.parametrize('state,visible,phrase', [('empty', False, ''), ('not_applicable', False, ''), ('absent', True, '明确没有'), ('undecided', True, '待确定'), ('proposal', True, '提议'), ('fact', True, '事实')])
async def test_sound_preserves_field_state_purpose_and_literal_text(canvas_client, state, visible, phrase):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '声音状态'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    doc['cards'] = [{'id': 'sound', 'type': 'direction.sound', 'music': {'text': '有音乐且没有音乐', 'state': state, 'purpose': 'constraint', 'source_locator': '原文4'}}]
    assert (await canvas_client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': doc})).status_code == 200
    output = (await canvas_client.get(url + '/cards/sound/outputs')).json()['data']['outputs']
    assert bool(output) == visible
    if visible:
        assert phrase in output[0]['text'] and '约束 / 音乐约束' in output[0]['text'] and '有音乐且没有音乐' in output[0]['text'] and '原文4' in output[0]['text']


@pytest.mark.asyncio
async def test_sound_retires_object_use_and_adopts_complete_field_reference_is_rejected(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '声源引用'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'key', 'port_id': 'text', 'position': 0}
    doc.update(cards=[{'id': 'key', 'type': 'content.prop', 'object_id': 'key', 'name': '钥匙', 'text': '唯一金属纹路'},
        {'id': 'sound', 'type': 'direction.sound', 'action_sound': {'text': '钥匙落地', 'authorship': 'user'},
         'input_bindings': [{'id': 'old', 'input_port': 'effect_object', 'source': {**source, 'port_id': 'object', 'object_id': 'key'}}]},
        {'id': 'model', 'type': 'model.text', 'input_bindings': [{'id': 'use', 'input_port': 'text', 'source': {**source, 'card_id': 'sound'}}]}],
        edges=[{'id': 'old', 'source_card': 'key', 'source_port': 'object', 'target_card': 'sound', 'target_port': 'effect_object'},
               {'id': 'use', 'source_card': 'sound', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'sound': {'effect_object': ['old']}, 'model': {'text': ['use']}})
    saved = await client.put(url, json={'request_id': 'old', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 422, saved.text
