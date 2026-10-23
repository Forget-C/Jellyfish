"""画布公共 HTTP 边界：真实数据库与服务。"""
import asyncio
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.dependencies import get_db
from app.models.studio import Project
from sqlalchemy import delete, select

@pytest_asyncio.fixture
async def canvas_client(request):
    from app.api.v1.routes.studio.generation_canvases import router
    mysql = getattr(request, 'param', None) == 'mysql'
    if mysql:
        from tests.services.test_task_mysql import isolated_database_url
        url = isolated_database_url()
    else:
        url = 'sqlite+aiosqlite:///:memory:'
    engine = create_async_engine(url, isolation_level='READ COMMITTED' if mysql else None)
    if not mysql:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([Project(id='p', name='项目', style='真人都市'), Project(id='other', name='其他', style='真人都市')])
        from app.models.llm import Model, Provider
        from app.bootstrap import bootstrap_all_registries
        bootstrap_all_registries()
        db.add(Provider(id='canvas-provider', name='openai', base_url='https://example.test'))
        await db.flush()
        db.add_all([Model(id=f'canvas-{kind}', name=f'canvas-{kind}', category=kind, provider_id='canvas-provider')
                    for kind in ('text', 'image', 'video')])
        await db.commit()
    async def database():
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    app = FastAPI()
    app.include_router(router, prefix='/canvases')
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        yield client
    if mysql:
        async with sessions.begin() as db:
            from app.models.generation_canvas import GenerationCanvas
            ids = list((await db.scalars(select(GenerationCanvas.id).where(GenerationCanvas.project_id.in_(['p', 'other'])))).all())
            from app.models.generation_canvas import CanvasSaveReceipt
            await db.execute(delete(CanvasSaveReceipt).where(CanvasSaveReceipt.canvas_id.in_(ids)))
            await db.execute(delete(GenerationCanvas).where(GenerationCanvas.id.in_(ids)))
            from app.models.llm import Model, Provider
            await db.execute(delete(Model).where(Model.provider_id == 'canvas-provider'))
            await db.execute(delete(Provider).where(Provider.id == 'canvas-provider'))
            await db.execute(delete(Project).where(Project.id.in_(['p', 'other'])))
    await engine.dispose()

@pytest.mark.asyncio
async def test_project_canvas_can_save_empty_text_and_reopen_independently(canvas_client):
    client = canvas_client
    first = (await client.post('/canvases/p', json={'name': '画布一'})).json()['data']
    second = (await client.post('/canvases/p', json={'name': '画布二'})).json()['data']
    document = first['document']
    document['cards'] = [{'id': 'text-one', 'type': 'content.text', 'type_version': 1, 'text': ''}]
    document['name'] = '已命名'
    saved = await client.put(f"/canvases/p/{first['id']}", json={'request_id': 'save-one', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    assert saved.json()['data']['revision'] == 1
    reopened = (await client.get(f"/canvases/p/{first['id']}")).json()['data']
    assert reopened['document'] == document
    assert reopened['revision'] == 1
    assert (await client.get(f"/canvases/p/{second['id']}")).json()['data']['document']['cards'] == []
    assert (await client.get(f"/canvases/other/{first['id']}")).status_code == 404
    assert (await client.delete(f"/canvases/other/{first['id']}")).status_code == 404
    assert len((await client.get('/canvases/p')).json()['data']) == 2
    assert (await client.delete(f"/canvases/p/{second['id']}")).status_code == 200

@pytest.mark.asyncio
async def test_original_receipt_replays_after_new_revision_and_conflicts_do_not_overwrite(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '画布'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    command = {'request_id': 'first', 'expected_revision': 0, 'document': canvas['document']}
    original = (await client.put(url, json=command)).json()
    newer = {**command, 'request_id': 'second', 'expected_revision': 1,
             'document': {**canvas['document'], 'name': '新名称'}}
    assert (await client.put(url, json=newer)).json()['data']['revision'] == 2
    assert (await client.put(url, json=command)).json() == original
    conflicting = await client.put(url, json={**command, 'document': newer['document']})
    assert conflicting.status_code == 409
    assert conflicting.json()['detail']['code'] == 'IDEMPOTENCY_CONFLICT'
    stale = await client.put(url, json={**command, 'request_id': 'stale'})
    assert stale.status_code == 409
    assert stale.json()['detail']['code'] == 'REVISION_CONFLICT'
    reopened = (await client.get(url)).json()['data']
    assert reopened['revision'] == 2
    assert reopened['document']['name'] == '新名称'

@pytest.mark.asyncio
@pytest.mark.parametrize('change,code', [
    ({'id': 'another'}, 'INVALID_IDENTITY'),
    ({'cards': [{'id': 'duplicate'}, {'id': 'duplicate'}]}, 'INVALID_CARD_IDENTITY'),
    ({'cards': [{'id': 'bad', 'type': 'unknown'}]}, 'INVALID_DOCUMENT'),
    ({'cards': [{'id': 'bad', 'type_version': 2}]}, 'INVALID_DOCUMENT'),
    ({'cards': [{'id': ''}]}, 'INVALID_DOCUMENT'),
    ({'viewport': {'x': 1}}, 'INVALID_DOCUMENT'),
])
async def test_invalid_document_reports_structural_diagnostic_and_preserves_revision(canvas_client, change, code):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '画布'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    response = await client.put(url, json={'request_id': 'invalid', 'expected_revision': 0,
                                         'document': {**canvas['document'], **change}})
    assert response.status_code == 422
    diagnostic = response.json()['detail']
    assert diagnostic['code'] == code
    assert diagnostic['target']
    assert diagnostic['blocks'] == ['save']
    assert (await client.get(url)).json()['data']['revision'] == 0

@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['mysql'], indirect=True)
async def test_mysql_real_http_connections_serialize_cas_and_identical_request_races(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '并发画布'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    commands = [{'request_id': f'competitor-{index}', 'expected_revision': 0,
                 'document': {**canvas['document'], 'name': f'获胜候选-{index}'}} for index in range(4)]
    responses = await asyncio.gather(*(client.put(url, json=command) for command in commands))
    assert sorted(response.status_code for response in responses) == [200, 409, 409, 409]
    winner = next(index for index, response in enumerate(responses) if response.status_code == 200)
    reopened = (await client.get(url)).json()['data']
    assert reopened['revision'] == 1
    assert reopened['document']['name'] == f'获胜候选-{winner}'
    same = {'request_id': 'identical', 'expected_revision': 1, 'document': reopened['document']}
    replies = await asyncio.gather(*(client.put(url, json=same) for _ in range(4)))
    assert [response.status_code for response in replies] == [200, 200, 200, 200]
    assert all(response.json() == replies[0].json() for response in replies)
    assert replies[0].json()['data']['revision'] == 2
    assert (await client.get(url)).json()['data']['revision'] == 2
    same_id = [{**same, 'request_id': 'competing-body', 'expected_revision': 2,
                'document': {**reopened['document'], 'name': f'正文-{index}'}} for index in range(4)]
    replies = await asyncio.gather(*(client.put(url, json=body) for body in same_id))
    assert sorted(response.status_code for response in replies) == [200, 409, 409, 409]
    assert all(response.json()['detail']['code'] == 'IDEMPOTENCY_CONFLICT'
               for response in replies if response.status_code == 409)
    assert (await client.get(url)).json()['data']['revision'] == 3

@pytest.mark.asyncio
async def test_non_object_document_has_machine_readable_save_diagnostic(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '画布'})).json()['data']
    response = await client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'bad-shape', 'expected_revision': 0, 'document': []})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'INVALID_DOCUMENT'
    assert response.json()['detail']['blocks'] == ['save']

@pytest.mark.asyncio
async def test_typed_graph_roundtrip_preserves_port_order_and_groups(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '图'})).json()['data']
    doc = canvas['document']
    doc.update(cards=[{'id': 'a', 'type': 'content.text', 'text': 'first'},
                      {'id': 'b', 'type': 'content.text', 'text': 'second'},
                      {'id': 'm', 'type': 'model.text', 'model_id': None, 'prompt': '', 'config': {}}],
               edges=[{'id': 'e1', 'source_card': 'a', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'},
                      {'id': 'e2', 'source_card': 'b', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}],
               input_order={'m': {'text': ['e2', 'e1']}},
               groups=[{'id': 'g', 'name': '组一', 'card_ids': ['a', 'm'], 'collapsed': True}])
    url = f"/canvases/p/{canvas['id']}"
    saved = await client.put(url, json={'request_id': 'graph', 'expected_revision': 0, 'document': doc})
    assert saved.status_code == 200, saved.text
    reopened = (await client.get(url)).json()['data']['document']
    assert reopened['input_order'] == {'m': {'text': ['e2', 'e1']}}
    assert reopened['groups'] == doc['groups']
    assert reopened['cards'][2]['model_id'] is None

@pytest.mark.asyncio
@pytest.mark.parametrize('change,code', [
    ({'edges': [{'id': 'bad', 'source_card': 'absent', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]}, 'INVALID_ENDPOINT'),
    ({'edges': [{'id': 'bad', 'source_card': 'm', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]}, 'SELF_CONNECTION'),
    ({'edges': [{'id': 'e', 'source_card': 'm', 'source_port': 'text', 'target_card': 'n', 'target_port': 'text'},
                {'id': 'f', 'source_card': 'n', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}]}, 'GRAPH_CYCLE'),
    ({'input_order': {'m': {'text': ['missing']}}}, 'INVALID_INPUT_ORDER'),
    ({'groups': [{'id': 'g', 'name': '损坏组', 'card_ids': ['missing']}]}, 'INVALID_GROUP'),
])
async def test_invalid_graph_has_located_save_diagnostic(canvas_client, change, code):
    canvas = (await canvas_client.post('/canvases/p', json={})).json()['data']
    document = {**canvas['document'], 'cards': [{'id': 'm', 'type': 'model.text'}, {'id': 'n', 'type': 'model.text'}], **change}
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'broken-graph', 'expected_revision': 0, 'document': document})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == code
    assert response.json()['detail']['target']

@pytest.mark.asyncio
async def test_new_incompatible_connection_rejected_but_model_switch_keeps_existing_candidates(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    doc = {**canvas['document'], 'cards': [{'id': 'a', 'type': 'content.text', 'text': 'x'},
                                        {'id': 'm', 'type': 'model.image'}],
           'edges': [{'id': 'e', 'source_card': 'a', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'}],
           'input_order': {'m': {'text': ['e']}}}
    assert (await client.put(url, json={'request_id': 'candidate', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][1]['model_id'] = 'no-longer-available'
    response = await client.put(url, json={'request_id': 'switch', 'expected_revision': 1, 'document': doc})
    assert response.status_code == 200
    assert (await client.get(url)).json()['data']['document']['edges'] == doc['edges']


@pytest.mark.asyncio
async def test_capability_declarations_match_real_dtos_and_video_adapter(canvas_client):
    from app.core.integrations.video_capabilities import VideoModelCapability, register_video_model_capability, clear_video_model_capability_overrides
    register_video_model_capability(provider='openai', model_prefix='canvas-video', capability=VideoModelCapability(
        supports_seed=False, allowed_ratios={'9:16'}, min_seconds=4, max_seconds=8,
        supports_subject_video_reference=True, max_subjects=2))
    try:
        canvas = (await canvas_client.post('/canvases/p', json={})).json()['data']
        base = f"/canvases/p/{canvas['id']}"
        text = (await canvas_client.get(base + '/models/canvas-text/capability')).json()['data']
        assert text['input_ports'] == ['text']
        assert not text['supports_seed']
        video = (await canvas_client.get(base + '/models/canvas-video/capability')).json()['data']
        assert video['ratios'] == ['9:16']
        assert video['min_seconds'] == 4 and video['max_seconds'] == 8
        assert video['max_subjects'] == 2 and not video['supports_seed']
        assert 'subject_video' in video['input_ports'] and 'subject_image' not in video['input_ports']
        doc = {**canvas['document'], 'cards': [{'id': 'a', 'type': 'model.video'},
                                            {'id': 'm', 'type': 'model.video', 'model_id': 'canvas-video'}],
               'edges': [{'id': 'e', 'source_card': 'a', 'source_port': 'video', 'target_card': 'm', 'target_port': 'subject_video'}],
               'input_order': {'m': {'subject_video': ['e']}}}
        assert (await canvas_client.put(base, json={'request_id': 'video', 'expected_revision': 0, 'document': doc})).status_code == 200
        # 去掉支持后，已有候选仍能保存；相同结构的新连接须拒绝。
        register_video_model_capability(provider='openai', model_prefix='canvas-video', capability=VideoModelCapability())
        assert (await canvas_client.put(base, json={'request_id': 'switch', 'expected_revision': 1, 'document': doc})).status_code == 200
        doc['cards'].append({'id': 'b', 'type': 'model.video'})
        doc['edges'].append({'id': 'f', 'source_card': 'b', 'source_port': 'video', 'target_card': 'm', 'target_port': 'subject_video'})
        doc['input_order']['m']['subject_video'].append('f')
        response = await canvas_client.put(base, json={'request_id': 'unsupported', 'expected_revision': 2, 'document': doc})
        assert response.status_code == 422
        assert response.json()['detail']['code'] == 'UNSUPPORTED_INPUT'
    finally:
        clear_video_model_capability_overrides(provider='openai')
