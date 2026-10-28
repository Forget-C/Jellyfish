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

@pytest.fixture
def canvas_file_store():
    """真实文件库场景准备；行为断言仍只经过 HTTP。"""
    return {}


@pytest_asyncio.fixture
async def canvas_client(request, monkeypatch, canvas_file_store):
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
    canvas_file_store["sessions"] = sessions
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
    real_app = getattr(request, 'param', None) == 'app-handler'
    if real_app:
        from app.main import app
    else:
        app = FastAPI()
        app.include_router(router, prefix='/canvases')
    from app.api.v1.routes.studio.files import router as files_router
    from app.core import storage
    async def upload(**kwargs):
        return None
    async def download(**kwargs):
        return b'media-bytes'
    monkeypatch.setattr(storage, 'upload_file', upload)
    monkeypatch.setattr(storage, 'download_file', download)
    if not real_app:
        app.include_router(files_router, prefix='/files')
    previous_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    base_url = 'http://test/api/v1/studio/generation-canvases/' if real_app else 'http://test'
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=base_url) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
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
async def test_create_canvas_returns_created_response_and_readable_document(canvas_client):
    response = await canvas_client.post('/canvases/p', json={'name': '新画布'})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['code'] == 201
    assert body['data']['document']['name'] == '新画布'
    reopened = await canvas_client.get(f"/canvases/p/{body['data']['id']}")
    assert reopened.json()['data'] == body['data']


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
                      {'id': 'm', 'type': 'model.text', 'model_id': None, 'prompt': {'segments': []}, 'config': {}}],
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
    register_video_model_capability(provider='vidu', model_prefix='canvas-video', capability=VideoModelCapability(
        supports_seed=False, allowed_ratios={'9:16'}, min_seconds=4, max_seconds=8,
        supports_subject_video_reference=True, max_subjects=2))
    try:
        # Subject fields are delivered by Vidu; OpenAI never serializes them.
        from app.models.llm import Provider
        from app.dependencies import get_db
        dependency = canvas_client._transport.app.dependency_overrides[get_db]
        async for db in dependency():
            provider = await db.get(Provider, 'canvas-provider')
            provider.name = 'vidu'
            await db.commit()
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
        register_video_model_capability(provider='vidu', model_prefix='canvas-video', capability=VideoModelCapability())
        assert (await canvas_client.put(base, json={'request_id': 'switch', 'expected_revision': 1, 'document': doc})).status_code == 200
        doc['cards'].append({'id': 'b', 'type': 'model.video'})
        doc['edges'].append({'id': 'f', 'source_card': 'b', 'source_port': 'video', 'target_card': 'm', 'target_port': 'subject_video'})
        doc['input_order']['m']['subject_video'].append('f')
        response = await canvas_client.put(base, json={'request_id': 'unsupported', 'expected_revision': 2, 'document': doc})
        assert response.status_code == 422
        assert response.json()['detail']['code'] == 'UNSUPPORTED_INPUT'
    finally:
        clear_video_model_capability_overrides(provider='vidu')



@pytest.mark.asyncio
async def test_media_uploads_are_project_files_and_canvas_content_protects_them(canvas_client):
    client = canvas_client
    audio = await client.post('/files/upload', files={'file': ('voice.mp3', b'media-bytes', 'audio/mpeg')},
                              data={'project_id': 'p', 'usage_kind': 'generation_upload'})
    assert audio.status_code == 201, audio.text
    file = audio.json()['data']
    assert file['type'] == 'audio'
    assert (await client.get(f"/files/{file['id']}/download")).headers['content-type'] == 'audio/mpeg'
    listed = (await client.get('/files', params={'project_id': 'p'})).json()['data']['items']
    assert [item['id'] for item in listed] == [file['id']]
    canvas = (await client.post('/canvases/p', json={'name': '媒体'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    document['cards'] = [{'id': 'audio', 'type': 'content.audio', 'file_id': file['id']},
                         {'id': 'empty-image', 'type': 'content.image'},
                         {'id': 'empty-video', 'type': 'content.video'}]
    saved = await client.put(url, json={'request_id': 'media', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    assert (await client.get(url)).json()['data']['document']['cards'][0]['file_id'] == file['id']
    assert (await client.delete(f"/files/{file['id']}")).status_code == 409
    assert (await client.delete(f"/files/{file['id']}/upload-retention", params={'project_id': 'p'})).status_code == 409
    assert (await client.delete(url)).status_code == 200
    assert (await client.get('/files', params={'project_id': 'p'})).json()['data']['pagination']['total'] == 1
    assert (await client.delete(f"/files/{file['id']}/upload-retention", params={'project_id': 'other'})).status_code == 404
    assert (await client.delete(f"/files/{file['id']}/upload-retention", params={'project_id': 'p'})).status_code == 200
    assert (await client.delete(f"/files/{file['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_media_card_rejects_missing_foreign_and_wrong_type_files_without_losing_saved_content(canvas_client):
    client = canvas_client
    image = (await client.post('/files/upload', files={'file': ('image.png', b'image', 'image/png')},
                               data={'project_id': 'p', 'usage_kind': 'generation_upload'})).json()['data']
    foreign = (await client.post('/files/upload', files={'file': ('foreign.png', b'image', 'image/png')},
                                 data={'project_id': 'other', 'usage_kind': 'generation_upload'})).json()['data']
    canvas = (await client.post('/canvases/p', json={'name': '图片'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = {**canvas['document'], 'cards': [{'id': 'image', 'type': 'content.image', 'file_id': image['id']}]}
    assert (await client.put(url, json={'request_id': 'valid', 'expected_revision': 0, 'document': document})).status_code == 200
    for index, (file_id, card_type) in enumerate([('missing', 'content.image'), (foreign['id'], 'content.image'), (image['id'], 'content.video')]):
        invalid = {**document, 'cards': [{'id': 'other-card', 'type': card_type, 'file_id': file_id}]}
        response = await client.put(url, json={'request_id': f'invalid-{index}', 'expected_revision': 1, 'document': invalid})
        assert response.status_code == 422, response.text
        assert response.json()['detail']['code'] == 'INVALID_MEDIA_FILE'
    reopened = (await client.get(url)).json()['data']
    assert reopened['revision'] == 1
    assert reopened['document']['cards'][0]['file_id'] == image['id']
    detail = (await client.get(f"/files/{image['id']}")).json()['data']
    assert {usage['usage_kind'] for usage in detail['usages']} == {'generation_upload', 'canvas_content'}


@pytest.mark.asyncio
@pytest.mark.parametrize('extension,mime,modality', [('png', 'image/png', 'image'), ('mp4', 'video/mp4', 'video'), ('wav', 'audio/wav', 'audio')])
async def test_each_media_content_can_replace_clear_and_save_during_upload_without_losing_file_protection(canvas_client, extension, mime, modality):
    client = canvas_client
    files = []
    for index in range(2):
        response = await client.post('/files/upload', files={'file': (f'file{index}.{extension}', b'content', mime)},
                                     data={'project_id': 'p', 'usage_kind': 'generation_upload'})
        assert response.status_code == 201
        files.append(response.json()['data']['id'])
    canvas = (await client.post('/canvases/p', json={'name': modality})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    document = canvas['document']
    for revision, (file_id, uploading) in enumerate([(files[0], False), (files[0], True), (files[1], False), (None, False)]):
        document['cards'] = [{'id': 'stable-source', 'type': f'content.{modality}', 'file_id': file_id, 'uploading': uploading}]
        response = await client.put(url, json={'request_id': f'save-{revision}', 'expected_revision': revision, 'document': document})
        assert response.status_code == 200, response.text
        reopened = (await client.get(url)).json()['data']['document']['cards'][0]
        assert reopened['id'] == 'stable-source'
        assert reopened['file_id'] == file_id
        assert reopened['uploading'] == uploading
        usages = (await client.get(f'/files/{files[0]}')).json()['data']['usages']
        assert any(usage['usage_kind'] == 'canvas_content' for usage in usages) is (file_id == files[0])
    assert (await client.get('/files', params={'project_id': 'p'})).json()['data']['pagination']['total'] == 2


@pytest.mark.asyncio
async def test_upload_rejects_missing_project_before_retaining_file(canvas_client):
    response = await canvas_client.post('/files/upload', files={'file': ('audio.mp3', b'content', 'audio/mpeg')},
                                        data={'project_id': 'missing-project', 'usage_kind': 'generation_upload'})
    assert response.status_code == 404

@pytest.mark.asyncio
async def test_model_switch_preserves_candidate_added_since_last_save(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={})).json()['data']
    base = f"/canvases/p/{canvas['id']}"
    doc = {**canvas['document'], 'cards': [{'id': 'a', 'type': 'model.video'},
                                        {'id': 'm', 'type': 'model.video', 'model_id': None}]}
    assert (await canvas_client.put(base, json={'request_id': 'before', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['cards'][1]['model_id'] = 'canvas-video'
    doc['edges'] = [{'id': 'e', 'source_card': 'a', 'source_port': 'video', 'target_card': 'm', 'target_port': 'subject_video'}]
    doc['input_order'] = {'m': {'subject_video': ['e']}}
    # 新模型不支持这个候选，但模型切换必须保留同一未保存文档中的现场。
    assert (await canvas_client.put(base, json={'request_id': 'switch', 'expected_revision': 1, 'document': doc})).status_code == 200
    assert (await canvas_client.get(base)).json()['data']['document']['edges'] == doc['edges']

@pytest.mark.asyncio
async def test_reference_protects_disconnect_but_final_document_cleanup_saves_once(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={})).json()['data']
    doc = canvas['document']
    reference = {'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': 'text', 'position': 0}}
    doc['cards'] = [{'id': 'source', 'type': 'content.text', 'text': 'actual'}, {'id': 'receiver', 'type': 'model.text', 'prompt': {'segments': [reference]}}]
    doc['edges'] = [{'id': 'edge', 'source_card': 'source', 'source_port': 'text', 'target_card': 'receiver', 'target_port': 'text'}]
    doc['input_order'] = {'receiver': {'text': ['edge']}}
    url = f"/canvases/p/{canvas['id']}"
    assert (await client.put(url, json={'request_id': 'initial', 'expected_revision': 0, 'document': doc})).status_code == 200
    doc['edges'] = []
    doc['input_order'] = {}
    blocked = await client.put(url, json={'request_id': 'blocked', 'expected_revision': 1, 'document': doc})
    assert blocked.status_code == 422
    assert blocked.json()['detail']['code'] == 'REFERENCE_IN_USE'
    doc['cards'][1]['prompt']['segments'] = []
    assert (await client.put(url, json={'request_id': 'clean', 'expected_revision': 1, 'document': doc})).status_code == 200

@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_real_app_handler_preserves_located_canvas_diagnostic_envelope(canvas_client):
    canvas = (await canvas_client.post('p', json={})).json()['data']
    base = f"p/{canvas['id']}"
    response = await canvas_client.put(base, json={'request_id': 'bad-order', 'expected_revision': 0,
        'document': {**canvas['document'], 'input_order': {'absent': {'text': ['missing']}}}})
    assert response.status_code == 422
    body = response.json()
    assert body['code'] == 422 and body['message'] == '输入顺序必须完整且仅包含本目标端口连接'
    assert body['data'] == {'code': 'INVALID_INPUT_ORDER', 'severity': 'error',
        'message': '输入顺序必须完整且仅包含本目标端口连接',
        'target': {'card_id': 'absent', 'port_id': 'text'}, 'blocks': ['save']}
    assert body['meta'] is None
    conflict = await canvas_client.put(base, json={'request_id': 'stale', 'expected_revision': 5, 'document': canvas['document']})
    assert conflict.status_code == 409 and conflict.json()['data']['code'] == 'REVISION_CONFLICT'
    # 普通 API 异常保留原有统一封套，不扩大诊断协议影响范围。
    missing = await canvas_client.get('other/missing')
    assert missing.json() == {'code': 404, 'message': 'Canvas not found', 'data': None, 'meta': None}

@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['app-handler'], indirect=True)
async def test_real_http_compile_preserves_mapping_and_locates_disconnect(canvas_client):
    client = canvas_client
    canvas = (await client.post('p', json={})).json()['data']
    ref = {'id': 'reference', 'kind': 'reference', 'source': {'canvas_id': canvas['id'], 'card_id': 'source', 'port_id': 'text', 'position': 0}}
    doc = {**canvas['document'], 'cards': [{'id': 'source', 'type': 'content.text', 'text': 'literal @图片1'},
           {'id': 'model', 'type': 'model.text', 'model_id': 'canvas-text', 'prompt': {'segments': [ref]}}],
           'edges': [{'id': 'edge', 'source_card': 'source', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
           'input_order': {'model': {'text': ['edge']}}}
    url = f"p/{canvas['id']}"
    assert (await client.put(url, json={'request_id': 'seed', 'expected_revision': 0, 'document': doc})).status_code == 200
    compiled = (await client.get(f'{url}/cards/model/compile')).json()['data']
    assert compiled['revision'] == 1
    assert compiled['text'] == 'literal @图片1' and compiled['can_run']
    assert compiled['mapping'] == [{'token': '@文本1', 'source': ref['source'], 'media_position': None}]
    doc['edges'] = []
    doc['input_order'] = {}
    blocked = await client.put(url, json={'request_id': 'disconnect', 'expected_revision': 1, 'document': doc})
    assert blocked.json()['data']['target'] == {'card_id': 'model', 'segment_id': 'reference', 'path': ['prompt', 'segments', 'reference']}
    assert blocked.json()['data']['blocks'] == ['save']
    doc['cards'][1]['prompt']['segments'] = []
    assert (await client.put(url, json={'request_id': 'clear-and-disconnect', 'expected_revision': 1, 'document': doc})).status_code == 200

@pytest.mark.asyncio
async def test_duplicate_prompt_segment_identity_cannot_save(canvas_client):
    canvas = (await canvas_client.post('/canvases/p', json={})).json()['data']
    doc = {**canvas['document'], 'cards': [{'id': 'model', 'type': 'model.text', 'prompt': {'segments': [
        {'id': 'same', 'kind': 'text', 'text': 'first'}, {'id': 'same', 'kind': 'text', 'text': 'second'}]}}]}
    response = await canvas_client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'duplicate', 'expected_revision': 0, 'document': doc})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_creative_basis_is_saved_and_exposes_only_its_declared_text(canvas_client):
    """创作依据不依赖章节，直接出口与编译使用同一份已保存文本。"""
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '创作依据'})).json()['data']
    document = canvas['document']
    document['cards'] = [
        {'id': 'basis', 'type': 'content.basis', 'text': '张三望向门口',
         'source_locator': '用户导入的段落', 'selection_start': 2, 'selection_end': 9},
        {'id': 'model', 'type': 'model.text'},
    ]
    document['edges'] = [{'id': 'edge', 'source_card': 'basis', 'source_port': 'text',
                          'target_card': 'model', 'target_port': 'text'}]
    document['input_order'] = {'model': {'text': ['edge']}}
    saved = await client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'save-basis', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    reopened = (await client.get(f"/canvases/p/{canvas['id']}")).json()['data']
    assert reopened['document']['cards'][0]['source_locator'] == '用户导入的段落'
    outputs = await client.get(f"/canvases/p/{canvas['id']}/cards/basis/outputs")
    assert outputs.status_code == 200, outputs.text
    result = outputs.json()['data']
    assert result['revision'] == 1
    assert result['outputs'][0]['payload'] == {'kind': 'text', 'text': '张三望向门口'}
    assert result['outputs'][0]['source']['port_id'] == 'text'
    candidates = await client.get(f"/canvases/p/{canvas['id']}/cards/model/outputs")
    assert candidates.json()['data']['candidates'][0]['payload']['text'] == '张三望向门口'
    compiled = (await client.get(f"/canvases/p/{canvas['id']}/cards/model/compile")).json()['data']
    assert compiled['text'] == ''
    assert compiled['used'] == []


@pytest.mark.asyncio
async def test_input_binding_owns_source_and_prompt_only_references_binding(canvas_client):
    """提示词与选择区共享同一采用记录，不再保存第二份来源。"""
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '统一采用'})).json()['data']
    document = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'text', 'port_id': 'text', 'position': 0}
    document['cards'] = [
        {'id': 'text', 'type': 'content.text', 'text': '直接上游正文'},
        {'id': 'model', 'type': 'model.text',
         'input_bindings': [{'id': 'selected-text', 'source': source, 'input_port': 'text'}],
         'prompt': {'segments': [{'id': 'mention', 'kind': 'reference', 'binding_id': 'selected-text'}]}},
    ]
    document['edges'] = [{'id': 'edge', 'source_card': 'text', 'source_port': 'text',
                          'target_card': 'model', 'target_port': 'text'}]
    document['input_order'] = {'model': {'text': ['edge']}}
    saved = await client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'save-binding', 'expected_revision': 0, 'document': document})
    assert saved.status_code == 200, saved.text
    reopened = (await client.get(f"/canvases/p/{canvas['id']}")).json()['data']
    model = reopened['document']['cards'][1]
    assert model['input_bindings'][0]['source'] == source
    assert model['prompt']['segments'][0] == {'id': 'mention', 'kind': 'reference', 'binding_id': 'selected-text'}
    compiled = (await client.get(f"/canvases/p/{canvas['id']}/cards/model/compile")).json()['data']
    assert compiled['text'] == '直接上游正文'
    assert compiled['used'][0]['source'] == source
    model['prompt']['segments'] = []
    model['input_bindings'] = []
    document['cards'][1] = model
    saved = await client.put(f"/canvases/p/{canvas['id']}", json={
        'request_id': 'remove-binding', 'expected_revision': 1, 'document': document})
    assert saved.status_code == 200, saved.text
    compiled = (await client.get(f"/canvases/p/{canvas['id']}/cards/model/compile")).json()['data']
    assert compiled['used'] == []


@pytest.mark.asyncio
async def test_legacy_prompt_document_is_read_as_version_two_without_duplicate_sources(canvas_client):
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '旧文档读取'})).json()['data']
    document = canvas['document']
    source = {'canvas_id': canvas['id'], 'card_id': 'text', 'port_id': 'text', 'position': 0}
    document.update(schema_version=1, cards=[{'id': 'text', 'type': 'content.text', 'text': '原始依据'},
        {'id': 'model', 'type': 'model.text', 'prompt': {'segments': [{'id': 'r', 'kind': 'reference', 'source': source}]}}],
        edges=[{'id': 'e', 'source_card': 'text', 'source_port': 'text', 'target_card': 'model', 'target_port': 'text'}],
        input_order={'model': {'text': ['e']}})
    response = await client.put(f"/canvases/p/{canvas['id']}", json={'request_id': 'legacy', 'expected_revision': 0, 'document': document})
    assert response.status_code == 200, response.text
    reopened = (await client.get(f"/canvases/p/{canvas['id']}")).json()['data']['document']
    assert reopened['schema_version'] == 2
    model = reopened['cards'][1]
    assert model['input_bindings'][0]['source'] == source
    assert model['prompt']['segments'][0]['binding_id'] == model['input_bindings'][0]['id']
    assert 'source' not in model['prompt']['segments'][0]


@pytest.mark.asyncio
@pytest.mark.parametrize('modality,extension,mime', [
    ('image', 'png', 'image/png'), ('video', 'mp4', 'video/mp4'), ('audio', 'wav', 'audio/wav'),
])
async def test_media_output_identity_survives_upload_and_file_replacement(canvas_client, modality, extension, mime):
    """上传中保留出口身份但不泄漏有效媒体；保存重开与替换不改输出位置。"""
    client = canvas_client
    files = []
    for index in range(2):
        uploaded = await client.post('/files/upload', files={'file': (f'media-{index}.{extension}', b'content', mime)},
                                     data={'project_id': 'p', 'usage_kind': 'generation_upload'})
        files.append(uploaded.json()['data']['id'])
    canvas = (await client.post('/canvases/p', json={})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'media', 'port_id': modality, 'position': 0}
    document = canvas['document']
    for revision, (file_id, uploading) in enumerate([(files[0], False), (files[0], True), (files[1], False)]):
        document['cards'] = [{'id': 'media', 'type': f'content.{modality}', 'file_id': file_id, 'uploading': uploading}]
        saved = await client.put(url, json={'request_id': f'media-{revision}', 'expected_revision': revision, 'document': document})
        assert saved.status_code == 200, saved.text
        reopened = (await client.get(url)).json()['data']['document']['cards'][0]
        assert reopened['file_id'] == file_id
        output = (await client.get(url + '/cards/media/outputs')).json()['data']['outputs'][0]
        assert output['source'] == source
        assert output['available'] is not uploading
        assert output['payload'] == (None if uploading else {'kind': modality, 'file_id': file_id})
        assert output['file_id'] == (None if uploading else file_id)
        assert (await client.delete(f'/files/{file_id}')).status_code == 409


@pytest.mark.asyncio
async def test_unavailable_saved_media_has_no_usable_output_and_locates_adopted_reference(canvas_client, canvas_file_store):
    from app.models.studio import FileItem
    from app.services.task_service import utcnow
    client = canvas_client
    uploaded = await client.post('/files/upload', files={'file': ('image.png', b'image', 'image/png')},
                                 data={'project_id': 'p', 'usage_kind': 'generation_upload'})
    file_id = uploaded.json()['data']['id']
    canvas = (await client.post('/canvases/p', json={})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    source = {'canvas_id': canvas['id'], 'card_id': 'media', 'port_id': 'image', 'position': 0}
    document = canvas['document']
    document.update(cards=[{'id': 'media', 'type': 'content.image', 'file_id': file_id},
        {'id': 'model', 'type': 'model.image', 'input_bindings': [
            {'id': 'image-input', 'source': source, 'input_port': 'image'}]}],
        edges=[{'id': 'edge', 'source_card': 'media', 'source_port': 'image', 'target_card': 'model', 'target_port': 'image'}],
        input_order={'model': {'image': ['edge']}})
    assert (await client.put(url, json={'request_id': 'save', 'expected_revision': 0, 'document': document})).status_code == 200
    # 模拟外部文件库后来撤回文件，不能绕过正常 HTTP 删除保护来制造有效输出。
    async with canvas_file_store['sessions'].begin() as db:
        file = await db.get(FileItem, file_id)
        file.delete_requested_at = utcnow()
    output = (await client.get(url + '/cards/media/outputs')).json()['data']['outputs'][0]
    assert output['source'] == source and not output['available']
    assert output['payload'] is None and output['file_id'] is None
    compiled = (await client.get(url + '/cards/model/compile')).json()['data']
    assert not compiled['can_run'] and compiled['media'] == []
    diagnostic = next(item for item in compiled['diagnostics'] if item['code'] == 'OUTPUT_MISSING')
    assert diagnostic['target']['card_id'] == 'model'
    assert diagnostic['target']['path'] == ['input_bindings', 'image-input']
