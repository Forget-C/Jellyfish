"""设计关系通过保存 HTTP 保持诊断、首错顺序与草稿语义。"""
from copy import deepcopy
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,code,message', [
    ('guidance', 'INVALID_REQUIREMENT_BINDING', '请选择直接候选中适用的对象或验收要求'),
    ('shot', 'INVALID_NARRATIVE_BINDING', '请选择直接候选中的明确关系'),
    ('blocking', 'INVALID_SPATIAL_BINDING', '请选择直接候选中的明确空间关系'),
    ('sound', 'INVALID_DESIGN_BINDING', '请选择直接候选中的具体对象'),
    ('performance', 'INVALID_DESIGN_BINDING', '请选择直接候选中的具体对象'),
    ('fact', 'INVALID_CONSTRAINT_BINDING', '请选择直接候选中的明确关系'),
])
@pytest.mark.parametrize('problem', ['disconnected', 'missing_identity', 'foreign_canvas', 'duplicate', 'wrong_port'])
async def test_design_binding_errors_keep_exact_diagnostic(canvas_client, kind, code, message, problem):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '关系校验'})).json()['data']
    doc = canvas['document']
    port = 'participant' if kind in ('shot', 'blocking') else 'effect_object'
    binding = {'id': 'selected', 'input_port': port, 'source': {
        'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person'}}
    doc.update(cards=[{'id': 'person', 'type': 'content.character', 'name': '人物', 'object_id': 'person'},
        {'id': 'design', 'type': 'direction.' + kind, 'input_bindings': [binding]}],
        edges=[{'id': 'edge', 'source_card': 'person', 'source_port': 'object', 'target_card': 'design', 'target_port': port}],
        input_order={'design': {port: ['edge']}})
    if problem == 'disconnected':
        doc.update(edges=[], input_order={})
    elif problem == 'missing_identity':
        binding['source']['object_id'] = 'missing'
    elif problem == 'foreign_canvas':
        binding['source']['canvas_id'] = 'other-canvas'
    elif problem == 'duplicate':
        doc['cards'][1]['input_bindings'].append(deepcopy(binding))
    else:
        binding['input_port'] = 'unknown'
    if kind == 'performance' and problem in ('duplicate', 'wrong_port'):
        message = '请选择已接入的明确关系用途'
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': code, 'severity': 'error', 'message': message,
        'target': {'card_id': 'design', 'path': ['input_bindings', 'selected']}, 'blocks': ['save']}


@pytest.mark.asyncio
async def test_acceptance_error_precedes_earlier_card_and_binding_errors(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '首错'})).json()['data']
    source = {'canvas_id': canvas['id'], 'card_id': 'missing', 'port_id': 'object', 'position': 0}
    doc = canvas['document']
    doc['cards'] = [
        {'id': 'earlier', 'type': 'direction.performance', 'input_bindings': [
            {'id': 'first', 'input_port': 'participant', 'source': source}]},
        {'id': 'later', 'type': 'direction.shot', 'input_bindings': [
            {'id': 'other', 'input_port': 'participant', 'source': source},
            {'id': 'criterion', 'input_port': 'acceptance_basis', 'source': {**source, 'port_id': 'criterion'}}]}]
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': 'INVALID_REQUIREMENT_BINDING', 'severity': 'error',
        'message': '请选择直接候选中适用的对象或验收要求',
        'target': {'card_id': 'later', 'path': ['input_bindings', 'criterion']}, 'blocks': ['save']}


@pytest.mark.asyncio
@pytest.mark.parametrize('reverse', [False, True])
async def test_binding_order_keeps_category_error_before_later_declaration_error(canvas_client, reverse):
    canvas = (await canvas_client.post('/canvases/p', json={'name': '绑定顺序'})).json()['data']
    source = {'canvas_id': canvas['id'], 'card_id': 'place', 'port_id': 'object', 'position': 0, 'object_id': 'place'}
    bindings = [{'id': 'category', 'input_port': 'participant', 'source': source},
                {'id': 'declaration', 'input_port': 'unknown', 'source': source}]
    if reverse:
        bindings.reverse()
    doc = canvas['document']
    doc.update(cards=[{'id': 'place', 'type': 'content.place', 'name': '场所', 'object_id': 'place'},
        {'id': 'act', 'type': 'direction.performance', 'input_bindings': bindings}],
        edges=[{'id': 'edge', 'source_card': 'place', 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'}],
        input_order={'act': {'participant': ['edge']}})
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'save', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422, response.text
    assert response.json()['detail'] == {'code': 'INVALID_DESIGN_BINDING' if reverse else 'INVALID_DESIGN_CATEGORY',
        'severity': 'error', 'message': '请选择已接入的明确关系用途' if reverse else '对象类别不适用于此关系',
        'target': {'card_id': 'act', 'path': ['input_bindings', 'declaration' if reverse else 'category']}, 'blocks': ['save']}


@pytest.mark.asyncio
@pytest.mark.parametrize('draft,code', [('empty', 'REFERENCE_NAME_REQUIRED'), ('duplicate', 'DUPLICATE_REFERENCE_NAME')])
async def test_adopted_reference_draft_saves_but_cannot_publish_or_run(canvas_client, canvas_file_store, draft, code):
    from app.models.llm import Provider
    async with canvas_file_store['sessions'].begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.api_key = 'test-key'

    file = (await canvas_client.post('/files/upload', data={'project_id': 'p', 'usage_kind': 'generation_upload'},
        files={'file': ('reference.png', b'image', 'image/png')})).json()['data']
    canvas = (await canvas_client.post('/canvases/p', json={'name': '草稿'})).json()['data']
    url, doc = f"/canvases/p/{canvas['id']}", canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'image', 'port_id': 'image', 'position': 0}
    reference = {'id': 'reference', 'type': 'reference.character', 'object_id': 'person', 'name': '人物',
                 'image_binding': {'file_id': file['id'], 'source': source}}
    doc.update(cards=[{'id': 'image', 'type': 'content.image', 'file_id': file['id']}, reference,
        {'id': 'act', 'type': 'direction.performance', 'input_bindings': [{'id': 'person', 'input_port': 'participant',
            'source': {**source, 'card_id': 'reference', 'port_id': 'object', 'object_id': 'person'}}]},
        {'id': 'model', 'type': 'model.image', 'model_id': 'canvas-image',
         'prompt': {'segments': [{'kind': 'text', 'id': 'body', 'text': '生成人物'}]},
         'input_bindings': [{'id': 'reference', 'input_port': 'image', 'source': {**source, 'card_id': 'reference'}}]}],
        edges=[{'id': 'image', 'source_card': 'image', 'source_port': 'image', 'target_card': 'reference', 'target_port': 'image_source'},
               {'id': 'person', 'source_card': 'reference', 'source_port': 'object', 'target_card': 'act', 'target_port': 'participant'},
               {'id': 'model', 'source_card': 'reference', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'}],
        input_order={'reference': {'image_source': ['image']}, 'act': {'participant': ['person']}, 'model': {'image': ['model']}})
    saved = await canvas_client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    preview = (await canvas_client.post(url + '/precheck', json={'card_id': 'model'})).json()['data']
    assert preview['can_run'], preview
    if draft == 'empty':
        reference['name'] = ''
    else:
        doc['cards'].append({'id': 'duplicate', 'type': 'reference.character', 'name': '人物', 'object_id': 'other'})
    saved = await canvas_client.put(url, json={'request_id': 'draft', 'expected_revision': 1, 'document': doc})
    assert saved.status_code == 200, saved.text
    assert (await canvas_client.get(url + '/cards/reference/outputs')).json()['data']['outputs'] == []
    preview = (await canvas_client.post(url + '/precheck', json={'card_id': 'model'})).json()['data']
    assert not preview['can_run']
    assert any(issue['code'] == code and issue['target'] == {'card_id': 'reference', 'path': ['name']}
               and issue['blocks'] == ['run'] for issue in preview['diagnostics'])
