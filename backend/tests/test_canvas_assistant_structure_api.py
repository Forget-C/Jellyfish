"""Verify typed canvas structure previews, approval and video compilation."""

import io
import json

import httpx
from PIL import Image
import pytest

from app.models.llm import Model
from tests.canvas_urls import append_canvas_path, canvas_url, seed_scene_canvas
from tests.test_canvas_assistant_edit_api import assistant_edit_model  # pylint: disable=unused-import
from tests.test_canvas_assistant_media_api import recorded_media_storage  # pylint: disable=unused-import
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # pylint: disable=unused-import


def mock_structure_reply(monkeypatch, change):
    """Respond to the assistant against the public supplier tool interface."""
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        tools = [m['tool_call_id'] for m in body['messages'] if m['role'] == 'tool']
        call = ('read_canvas_context', {}) if not tools else (
            ('propose_canvas_structure', {'change': change}) if 'structure' not in tools else None
        )
        outcome = next((m['content'] for m in body['messages'] if m.get('tool_call_id') == 'structure'), '')
        message = {'role': 'assistant', 'content': outcome if '当前画布不允许' in outcome else '事项请确认'}
        if call:
            message = {'role': 'assistant', 'tool_calls': [{
                'id': 'read' if not tools else 'structure', 'type': 'function',
                'function': {'name': call[0], 'arguments': json.dumps(call[1])},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if call else 'stop', 'message': message}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)


async def send_structure(client, url, canvas, text, *, target=None, files=None):
    context = {'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'canvas'}
    if target:
        context.update(scope='selection', card_ids=[target])
    result = await client.post(append_canvas_path(url, '/assistant'), json={
        'request_id': 'structure', 'text': text, 'context': context, 'attachment_file_ids': files or [],
    })
    assert result.status_code == 200, result.text
    return result.json()['data']


async def approve_structure(client, url, canvas, proposal):
    assert proposal is not None
    return await client.post(append_canvas_path(url, '/assistant/proposals/structure'), json={
        'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': [proposal['groups'][0]['id']],
    })



@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('structured', [None, 'flat', 'nested'])
@pytest.mark.parametrize('write_request', ['写入画布', '按此方案继续'])
async def test_write_canvas_from_chat_prepares_a_real_preview(canvas_client, monkeypatch, structured, write_request):
    async with canvas_client.canvas_sessions.begin() as db:
        model = await db.get(Model, 'canvas-text')
        model.capability_profile = None
    canvas = (await canvas_client.post('/canvases', json={'name': '旧方案画布'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    assistant = url + '/assistant'
    provider_input = []
    original_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await original_send(client, request, **kwargs)
        body = json.loads(request.content)
        provider_input.append(body['messages'])
        if len(provider_input) == 1:
            content = '方案：镜头 01 用慢速推近。'
        elif structured:
            card = {'reference': 'shot-01', 'card': {'kind': 'add_text_card', 'text': '镜头 01 用慢速推近。'}}
            payload = {'change': card} if structured == 'nested' else card
            content = json.dumps({'reply': '原方案 1 镜，本次覆盖 1 镜。' if write_request == '按此方案继续' else '已发起写入请求', 'groups': [{'title': '镜头方案', 'changes': [
                {'kind': 'add_card', **payload},
            ]}]})
        else:
            content = '已发起写入请求，请等待。'
        return httpx.Response(200, request=request, json={
            'id': 'answer', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': content}}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    for request_id, message in [('plan', '先给一个镜头方案'), ('write', write_request)]:
        command = {'request_id': request_id, 'text': message}
        if request_id == 'write':
            command['context'] = {'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'canvas'}
        response = await canvas_client.post(assistant, json=command)
        assert response.status_code == 200, response.text
    turn = response.json()['data']
    assert ('groups' in str(provider_input[-1])) and ('方案：镜头 01 用慢速推近。' in str(provider_input[-1]))
    assert '可独立编辑的镜头数' in str(provider_input[-1])
    assert turn['context']['scope'] == 'canvas'
    assert '已发起写入请求' not in turn['reply']
    assert bool(turn['proposal']) is bool(structured)
    if structured:
        expected = '原方案 1 镜，本次覆盖 1 镜。' if write_request == '按此方案继续' else '已准备提案，请核对待审批的改动。'
        assert turn['reply'] == expected
        assert turn['proposal']['state'] == 'pending'
    else:
        assert '没有生成可审批的修改提案' in turn['reply']
    assert (await canvas_client.get(url)).json()['data']['revision'] == canvas['revision']
    missing_scope = await canvas_client.post(assistant, json={'request_id': 'without-scope', 'text': '写入画布'})
    assert missing_scope.status_code == 200, missing_scope.text
    assert '没有收到画布范围' in missing_scope.json()['data']['reply']
    assert len(provider_input) == 2
    if structured == 'nested':
        approved = await canvas_client.post(assistant + '/proposals/write', json={
            'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': ['1'],
        })
        assert approved.status_code == 200, approved.text
        saved = (await canvas_client.get(url)).json()['data']
        assert saved['revision'] == canvas['revision'] + 1
        assert [card['text'] for card in saved['document']['cards']] == ['镜头 01 用慢速推近。']



@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('native_tools,field_conflict', [(True, False), (False, False), (True, True)])
async def test_batch_proposal_edits_creates_and_connects_atomically(canvas_client, monkeypatch, native_tools, field_conflict):
    if not native_tools:
        async with canvas_client.canvas_sessions.begin() as db:
            model = await db.get(Model, 'canvas-text')
            model.capability_profile = {'tool_calling': {'declaration': 'unsupported'}}
    canvas = (await canvas_client.post('/canvases', json={'name': '画布'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    document = dict(canvas['document'], cards=[
        {'id': 'notes', 'type': 'content.text', 'text': '初稿'}, {'id': 'target', 'type': 'model.text'},
    ])
    saved = await canvas_client.put(url, json={
        'request_id': 'setup', 'expected_revision': canvas['revision'], 'document': document,
    })
    assert saved.status_code == 200, saved.text
    canvas = (await canvas_client.get(url)).json()['data']
    groups = [{'title': '整理说明与参考来源', 'changes': [
        {'kind': 'edit_field', 'change': {'card_id': 'notes', 'target': {'kind': 'card_text'}, 'text': '定稿'}},
        {'kind': 'add_card', 'reference': 'new-notes', 'card': {'kind': 'add_text_card', 'text': '新增参考'}},
        {'kind': 'edit_field', 'change': {'card_id': 'new-notes', 'target': {'kind': 'card_text'}, 'text': '最终参考'}},
        {'kind': 'add_card', 'reference': 'hero', 'card': {'kind': 'add_catalog_card', 'card_type': 'reference.character'}},
        {'kind': 'edit_field', 'change': {'card_id': 'hero', 'target': {'kind': 'reference_name'}, 'text': '主角'}},
        {'kind': 'connect_cards', 'source_card': 'new-notes', 'source_port': 'text',
         'target_card': 'target', 'target_port': 'text'},
    ]}]
    if not native_tools:
        edge = groups[0]['changes'][-1]
        groups[0]['changes'][-1] = {'kind': 'connect_cards', 'change': {key: val for key, val in edge.items() if key != 'kind'}}
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        completed = [m.get('tool_call_id') for m in body['messages'] if m['role'] == 'tool']
        answer = {'role': 'assistant', 'content': '事项请确认'}
        if not native_tools:
            assert not body.get('tools')
            answer['content'] = json.dumps({'reply': '事项请确认', 'groups': groups}, ensure_ascii=False)
        elif 'batch' not in completed:
            tool = ('batch', 'propose_canvas_changes', {'groups': groups}) if completed else ('read', 'read_canvas_context', {})
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': tool[0], 'type': 'function', 'function': {'name': tool[1], 'arguments': json.dumps(tool[2])},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'response', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop', 'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    exchange = await send_structure(canvas_client, url, canvas, '把笔记改成定稿，加一张参考卡并连到文本模型')
    proposal = exchange['proposal']
    assert proposal is not None
    changes = proposal['groups'][0]['edits']
    assert [item['target']['kind'] for item in changes] == [
        'card_text', 'add_canvas_card', 'card_text', 'add_canvas_card', 'reference_name', 'connect_cards',
    ]
    new_card_id = changes[1]['card_id']
    assert changes[-1]['target']['source_card'] == new_card_id
    assert exchange['reply'] == '事项请确认'
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']

    if field_conflict:
        document['cards'][0]['text'] = '用户手改'
        changed = await canvas_client.put(url, json={
            'request_id': 'manual', 'expected_revision': canvas['revision'], 'document': document,
        })
        assert changed.status_code == 200, changed.text
        canvas = (await canvas_client.get(url)).json()['data']

    snapshot = (await canvas_client.get(url + '/assistant')).json()['data']
    creation = (await canvas_client.get(url + '/assistant/events')).json()['data']
    assert [item['type'] for item in creation if item['type'] != 'turn.progress'] == ['turn.completed', 'proposal.created']
    assert all(item['occurred_at'] for item in creation)
    assert any(item['payload']['progress']['revision'] == exchange['context']['revision']
               for item in creation if item['type'] == 'turn.progress')
    assert creation[-1]['payload']['proposal']['state'] == 'pending'

    approved = await approve_structure(canvas_client, url, canvas, proposal)
    assert approved.status_code == 200, approved.text
    events = (await canvas_client.get(url + '/assistant/events', params={'after': snapshot['cursor']})).json()['data']
    assert [item['type'] for item in events if item['type'] != 'turn.progress'] == [
        'approval.decided', 'execution.blocked' if field_conflict else 'execution.succeeded',
    ]
    assert all(event['turn_id'] == exchange['request_id'] for event in events)
    assert all(item['subject'] == 'edit' and item['target_version'] == exchange['request_id']
               and item['group_ids'] == [proposal['groups'][0]['id']] for item in events)
    assert events[-1]['payload']['approval_audit'][-1]['outcome'] == ('conflict' if field_conflict else 'applied')
    result = approved.json()['data']
    assert result['graph_resumed'] is True
    actual = (await canvas_client.get(url)).json()['data']
    if field_conflict:
        assert result['receipt'] is None
        assert [conflict['current'] for conflict in result['conflicts']] == ['用户手改']
        assert actual['document'] == canvas['document']
    else:
        assert actual['revision'] == canvas['revision'] + 1
        assert {card['id']: card.get('text') for card in actual['document']['cards']} == {
            'notes': '定稿', 'target': None, new_card_id: '最终参考', changes[3]['card_id']: None,
        }
        assert next(card for card in actual['document']['cards'] if card['id'] == changes[3]['card_id'])['name'] == '主角'
        edge, = actual['document']['edges']
        assert edge['source_card'] == new_card_id and edge['target_card'] == 'target'
        replay = await approve_structure(canvas_client, url, canvas, proposal)
        assert replay.status_code == 200 and replay.json()['data']['receipt'] == result['receipt']
        assert (await canvas_client.get(url)).json()['data'] == actual

@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
async def test_assistant_adds_candidate_connection_without_adopting(canvas_client, monkeypatch):
    canvas = (await canvas_client.post('/canvases', json={'name': '画布'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    document = {**canvas['document'], 'cards': [
        {'id': 'notes', 'type': 'content.text', 'text': '参考正文'}, {'id': 'target', 'type': 'model.text'},
    ]}
    saved = await canvas_client.put(url, json={
        'request_id': 'setup', 'expected_revision': canvas['revision'], 'document': document,
    })
    assert saved.status_code == 200, saved.text
    canvas = (await canvas_client.get(url)).json()['data']
    mock_structure_reply(monkeypatch, {'kind': 'connect_cards', 'source_card': 'notes', 'source_port': 'text',
                                       'target_card': 'target', 'target_port': 'text'})
    exchange = await send_structure(canvas_client, url, canvas, '把笔记连到文本模型')
    assert exchange['proposal']['target']['kind'] == 'connect_cards'
    assert (await canvas_client.get(url)).json()['data']['document'].get('edges', []) == []
    approved = await approve_structure(canvas_client, url, canvas, exchange['proposal'])
    assert approved.status_code == 200, approved.text
    current = (await canvas_client.get(url)).json()['data']['document']
    edge, = current['edges']
    assert (edge['source_card'], edge['source_port'], edge['target_card'], edge['target_port']) == (
        'notes', 'text', 'target', 'text',
    )
    assert current['input_order']['target']['text'] == [edge['id']]
    assert current['cards'][1].get('input_bindings', []) == []


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('target_change', [None, 'removed', 'changed_model', 'replace'])
async def test_approve_reference_as_first_frame(recorded_media_storage, monkeypatch, target_change):
    client = recorded_media_storage
    buffer = io.BytesIO()
    Image.new('RGB', (12, 12), 'red').save(buffer, 'PNG')
    uploaded = await client.post('/files/upload', files={'file': ('红船.png', buffer.getvalue(), 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    canvas = (await client.post('/canvases', json={'name': '画布'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    card = {'id': 'shot', 'type': 'model.video', 'model_id': 'canvas-video', 'config': {'ratio': '16:9', 'seconds': 5}}
    document = {**canvas['document'], 'cards': [card]}
    if target_change == 'replace':
        old_file = await client.post('/files/upload', files={'file': ('旧参考.png', buffer.getvalue(), 'image/png')})
        assert old_file.status_code == 201, old_file.text
        document['cards'].append({'id': 'old-image', 'type': 'content.image', 'file_id': old_file.json()['data']['id']})
        document['edges'] = [{'id': 'old-edge', 'source_card': 'old-image', 'source_port': 'image',
                              'target_card': 'shot', 'target_port': 'first_frame'}]
        document['input_order'] = {'shot': {'first_frame': ['old-edge']}}
        card['input_bindings'] = [{'id': 'old-binding', 'input_port': 'first_frame',
                                   'source': {'canvas_id': canvas['id'], 'card_id': 'old-image',
                                              'port_id': 'image', 'position': 0}}]
        card['prompt'] = {'segments': [{'id': 'old-instruction', 'kind': 'instruction', 'command': '首帧参考',
                                      'references': [{'id': 'old-ref', 'kind': 'reference', 'binding_id': 'old-binding'}]}]}
    saved = await client.put(url, json={
        'request_id': 'setup', 'expected_revision': canvas['revision'], 'document': document,
    })
    assert saved.status_code == 200, saved.text
    canvas = (await client.get(url)).json()['data']
    replace = target_change == 'replace'
    kind = 'replace_first_frame' if replace else 'adopt_first_frame'
    mock_structure_reply(monkeypatch, {'kind': kind, 'card_id': 'shot', 'file_id': file_id})
    exchange = await send_structure(client, url, canvas, '换首帧参考' if replace else '把这张图用作首帧',
                                    target='shot', files=[file_id])
    group = exchange['proposal']['groups'][0]
    assert '首帧' in group['title']
    assert file_id in json.dumps(group)
    assert (await client.get(url)).json()['data']['document'] == canvas['document']
    if replace:
        assert group['edits'][0]['before'] == 'old-image'
    if target_change in ('removed', 'changed_model'):
        latest = {**canvas['document'], 'cards': [] if target_change == 'removed' else [{**card, 'model_id': None}]}
        changed = await client.put(url, json={
            'request_id': 'changed', 'expected_revision': canvas['revision'], 'document': latest,
        })
        assert changed.status_code == 200, changed.text
        before = (await client.get(url)).json()['data']
    approved = await approve_structure(client, url, canvas, exchange['proposal'])
    assert approved.status_code == 200, approved.text
    if target_change in ('removed', 'changed_model'):
        assert approved.json()['data']['conflicts'][0]['card_id'] == 'shot'
        assert (await client.get(url)).json()['data'] == before
        return
    saved = approved.json()['data']['canvas']
    source = next(card for card in saved['document']['cards'] if card['type'] == 'content.image' and card['id'] != 'old-image')
    assert source['file_id'] == file_id
    assert any(edge['source_card'] == source['id'] and edge['target_card'] == 'shot'
               and edge['target_port'] == 'first_frame' for edge in saved['document']['edges'])
    precheck = await client.post(url + '/precheck', json={'card_id': 'shot'})
    assert precheck.status_code == 200, precheck.text
    assert precheck.json()['data']['input']['video_media']['frames']['first']['file_id'] == file_id
    if replace:
        assert any(card['id'] == 'old-image' for card in saved['document']['cards'])
        assert any(edge['id'] == 'old-edge' for edge in saved['document']['edges'])


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
@pytest.mark.parametrize('scene,change,expected', [
    (False, {'kind': 'add_text_card', 'text': '红船'}, 'content.text'),
    (False, {'kind': 'add_model_card', 'modality': 'image', 'prompt': '安静湖面'}, 'model.image'),
    (False, {'kind': 'add_movement_card', 'movement_speed': '慢推'}, None),
    (True, {'kind': 'add_movement_card', 'movement_speed': '慢推'}, 'direction.movement'),
    (False, {'kind': 'add_catalog_card', 'card_type': 'direction.camera'}, None),
    (True, {'kind': 'add_catalog_card', 'card_type': 'direction.camera'}, 'direction.camera'),
])
async def test_catalog_limits_assistant_card_creation(canvas_client, monkeypatch, scene, change, expected):
    if scene:
        canvas = (await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '分镜画布'})).json()['data']
        url = canvas_url(f"/canvases/p/{canvas['id']}")
    else:
        canvas = (await canvas_client.post('/canvases', json={'name': '自由画布'})).json()['data']
        url = f"/canvases/{canvas['id']}"
    mock_structure_reply(monkeypatch, change)
    exchange = await send_structure(canvas_client, url, canvas, '请新建这张卡')
    assert (await canvas_client.get(url)).json()['data']['document'] == canvas['document']
    proposal = exchange['proposal']
    if expected is None:
        assert proposal is None
        name = '机位与视角卡' if change['kind'] == 'add_catalog_card' else '运镜卡'
        assert exchange['reply'] == f'当前画布不允许创建 {name}'
        return
    approval = await approve_structure(canvas_client, url, canvas, proposal)
    assert approval.status_code == 200, approval.text
    current = (await canvas_client.get(url)).json()['data']
    created = next(card for card in current['document']['cards'] if card['id'] == proposal['card_id'])
    assert created['type'] == expected
    if expected == 'direction.movement':
        assert created['fields']['movement_speed']['text'] == '慢推'


@pytest.mark.asyncio
@pytest.mark.usefixtures('assistant_edit_model')
async def test_revise_one_duration_keeps_dependent_changes_and_independent_decisions(canvas_client, monkeypatch):
    canvas = (await canvas_client.post('/canvases', json={'name': '字段修订'})).json()['data']
    url = f"/canvases/{canvas['id']}"
    document = {**canvas['document'], 'cards': [
        {'id': 'shot', 'type': 'model.video', 'config': {'seconds': 8}, 'prompt': {
            'segments': [{'kind': 'text', 'id': 'prompt', 'text': '继续推进'}],
        }},
        {'id': 'notes', 'type': 'content.text', 'text': '初稿'},
    ]}
    saved = await canvas_client.put(url, json={
        'request_id': 'setup-duration', 'expected_revision': canvas['revision'], 'document': document,
    })
    assert saved.status_code == 200, saved.text
    canvas = (await canvas_client.get(url)).json()['data']
    duration = {'kind': 'edit_field', 'change': {
        'card_id': 'shot', 'target': {'kind': 'video_duration'}, 'text': '5',
    }}
    independent = {'kind': 'edit_field', 'change': {
        'card_id': 'notes', 'target': {'kind': 'card_text'}, 'text': '定稿',
    }}
    dependent = {'kind': 'edit_field', 'change': {
        'card_id': 'shot', 'target': {'kind': 'video_prompt_segment', 'segment_id': 'prompt'}, 'text': '减速推进',
    }}
    real_send = httpx.AsyncClient.send

    async def respond(client, request, **kwargs):
        if request.url.host != 'example.test':
            return await real_send(client, request, **kwargs)
        body = json.loads(request.content)
        messages = body['messages']
        text = [message['content'] for message in messages if message['role'] == 'user'][-1]
        completed = {m['tool_call_id'] for m in messages if m['role'] == 'tool'}
        groups = [{'title': '时长及提示词', 'changes': [duration, dependent]},
                  {'title': '笔记', 'changes': [independent]}]
        if text == '改为 6 秒':
            groups = [{'title': '时长', 'changes': [{
                **duration, 'change': {**duration['change'], 'text': '6'},
            }]}]
        answer = {'role': 'assistant', 'content': '请核对差异'}
        if 'batch-duration' not in completed:
            call = ('batch-duration', 'propose_canvas_changes', {'groups': groups}) if completed else (
                'read-duration', 'read_canvas_context', {},
            )
            answer = {'role': 'assistant', 'tool_calls': [{
                'id': call[0], 'type': 'function',
                'function': {'name': call[1], 'arguments': json.dumps(call[2])},
            }]}
        return httpx.Response(200, request=request, json={
            'id': 'duration', 'object': 'chat.completion', 'created': 1, 'model': body['model'],
            'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in answer else 'stop',
                         'message': answer}],
        })

    monkeypatch.setattr(httpx.AsyncClient, 'send', respond)
    original = await send_structure(canvas_client, url, canvas, '缩短时长并更新提示词，同步笔记')
    assert original['proposal']['groups'][0]['edits'][0]['before'] == '8'
    decide = f"{url}/assistant/proposals/{original['request_id']}"
    approved = await canvas_client.post(decide, json={
        'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': ['2'],
    })
    assert approved.status_code == 200, approved.text
    canvas = (await canvas_client.get(url)).json()['data']
    revision = await canvas_client.post(url + '/assistant', json={
        'request_id': 'field-revision', 'text': '改为 6 秒', 'revises': original['request_id'],
        'revises_field': {'group_id': '1', 'change_index': 0},
        'context': {'draft': canvas['document'], 'revision': canvas['revision'], 'scope': 'selection',
                    'card_ids': ['shot']},
    })
    assert revision.status_code == 200, revision.text
    revised = revision.json()['data']
    group, = revised['proposal']['groups']
    assert [(edit['before'], edit['after']) for edit in group['edits']] == [
        ('8', '6'), ('继续推进', '减速推进'),
    ]
    history = (await canvas_client.get(url + '/assistant')).json()['data']['turns']
    assert [group['state'] for group in history[0]['proposal']['groups']] == ['superseded', 'applied']
    assert (await canvas_client.post(decide, json={
        'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': ['1'],
    })).status_code == 409
    written = await canvas_client.post(url + '/assistant/proposals/field-revision', json={
        'action': 'approve', 'expected_revision': canvas['revision'], 'group_ids': [group['id']],
    })
    assert written.status_code == 200, written.text
    cards = written.json()['data']['canvas']['document']['cards']
    assert cards[0]['config']['seconds'] == 6
    assert cards[0]['prompt']['segments'][0]['text'] == '减速推进'
    assert cards[1]['text'] == '定稿'
