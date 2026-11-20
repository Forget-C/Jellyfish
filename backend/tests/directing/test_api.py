"""场次接口的事务边界、失败恢复及项目隔离；不调用外部模型。"""

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect

from app.api.v1.routes.studio.directing import router
from app.api.v1.routes.studio.files import router as file_router
from app.api.v1.routes.studio.generation_canvases import router as canvas_router
from app.api.v1.routes.film.task_status import router as task_router
from app.dependencies import get_db
from app.models.llm import Model, Provider
from app.models.studio import FileUsage
from app.services.directing.store import DirectingStore
from app.task_worker import TaskWorker
from tests.directing.samples import design_sample, plan_sample
from tests.directing.test_store import database, frozen, setup_story


@pytest.mark.asyncio
async def test_production_take_media_works_without_retired_tables(tmp_path):
    """现行 Take 从任务产物取得文件，新库没有旧四画布专属表。"""
    from tests.directing.test_store import output

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            connection = await db.connection()
            tables = await connection.run_sync(lambda conn: set(inspect(conn).get_table_names()))
            assert not tables & {
                'directing_scene_versions', 'directing_scene_copy_origins', 'directing_scene_unit_identities',
                'directing_instruction_bases', 'directing_scene_video_executions', 'directing_scene_takes',
                'directing_scene_take_reviews', 'directing_scene_cut_reviews', 'directing_scene_seam_reviews',
                'directing_scene_end_frames', 'directing_scene_deliveries', 'directing_scene_delivery_uses',
            }
            store, sequence_id, _, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
        path = f'/api/v1/studio/projects/p1/directing/sequences/{sequence_id}/takes/{take.id}/media'
        response = await client.get(path)
        assert response.status_code == 200
        assert response.json()['data']['file_id'] == 'video1'
        assert response.json()['data']['url'] == '/api/v1/studio/files/video1/download'
        assert (await client.delete('/api/v1/studio/files/video1')).status_code == 409


@pytest.mark.asyncio
async def test_thumbnail_url_returns_project_scoped_cached_image(tmp_path, monkeypatch):
    """媒体契约中的预览地址可直接读取，跨项目请求不触发存储或解码。"""
    from unittest.mock import AsyncMock
    from app.core import storage
    from tests.directing.test_store import setup_story, output

    frame = b'\x89PNG\r\n\x1a\npreview'
    download = AsyncMock(return_value=frame)
    monkeypatch.setattr(storage, 'download_file', download)
    monkeypatch.setattr(storage, 'upload_file', AsyncMock())
    monkeypatch.setattr('app.services.directing.media.extract_frame', lambda *args, **kwargs: frame)
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            take = await service.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
        async with client_for(sessions) as client:
            base = f'/api/v1/studio/projects/p1/directing/sequences/{sequence_id}/takes/{take.id}'
            media = await client.get(base + '/media')
            assert media.status_code == 200
            url = media.json()['data']['thumbnail_url']
            assert (await client.get(url.replace('/projects/p1/', '/projects/p2/'))).status_code == 422
            download.assert_not_called()
            response = await client.get(url)
            assert response.status_code == 200 and response.content == frame
            assert response.headers['content-type'] == 'image/png'
            assert 'private' in response.headers['cache-control']


@asynccontextmanager
async def client_for(sessions):
    """每次 HTTP 请求使用独立事务，错误请求不得污染后续工作区。"""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/studio")
    app.include_router(task_router, prefix="/api/v1/film")
    app.include_router(file_router, prefix="/api/v1/studio/files")
    from app.api.v1.routes.studio.entities import router as entity_router
    from app.api.v1.routes.studio.project_assets import router as project_asset_router
    app.include_router(entity_router, prefix="/api/v1/studio/entities")
    app.include_router(project_asset_router, prefix="/api/v1/studio/project-assets")
    app.include_router(canvas_router, prefix="/api/v1/studio/generation-canvases")
    from app.api.v1.routes.studio.chapters import router as chapter_router
    app.include_router(chapter_router, prefix="/api/v1/studio/chapters")
    from app.main import http_exception_handler
    from app.services.generation_canvas.errors import CanvasDomainError
    app.add_exception_handler(CanvasDomainError, http_exception_handler)

    async def scoped_db():
        """模拟真实请求提交和异常回滚，不共享未提交的测试会话。"""
        async with sessions.begin() as db:
            yield db

    app.dependency_overrides[get_db] = scoped_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.canvas_sessions = sessions
        yield client


@pytest.mark.asyncio
async def test_production_design_task_keeps_results_sources_and_file_protection(tmp_path, monkeypatch):
    """现行生产计划通过 Worker 取得导演方案，采用后可读，引用继续保护。"""
    expected = design_sample()

    class ControlledModel:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, _messages):
            return SimpleNamespace(content=json.dumps(expected, ensure_ascii=False))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', ControlledModel)
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            _, sequence_id, _, _, _ = await setup_story(db)
            db.add(Provider(id='director-provider', name='openai', base_url='https://director.test/v1', api_key='test'))
            await db.flush()
            db.add(Model(id='director-text', name='text', category='text', provider_id='director-provider'))
        base = '/api/v1/studio/projects/p1/directing'
        response = await client.post(f'{base}/sequences/{sequence_id}/design', json={'model_id': 'director-text'})
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']

        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*worker.jobs.values())
        finally:
            worker.text_pool.shutdown(wait=True)

        response = await client.get(f'{base}/tasks/{task_id}')
        assert response.status_code == 200, response.text
        detail = response.json()['data']
        assert detail['status'] == 'succeeded', detail
        assert detail['design']['direction']['viewpoint']['text'] == expected['direction']['viewpoint']['text']
        assert (await client.get(f'/api/v1/studio/projects/p2/directing/tasks/{task_id}')).status_code == 422
        assert (await client.post(f'{base}/sequences/{sequence_id}/design/apply', json={'task_id': task_id})).status_code == 200

        page = (await client.get('/api/v1/film/tasks', params={'project_id': 'p1', 'task_kind': 'directing_design'})).json()['data']
        assert page['items'][0]['source']['id'] == sequence_id
        assert page['items'][0]['source']['kind'] == 'sequence'
        assert (await client.delete('/api/v1/studio/files/image1')).status_code == 409

        contract = (await client.get('/openapi.json')).json()['components']['schemas']
        assert {'scene_design', 'scene_instruction', 'instruction_check'}.isdisjoint(contract['DirectingTaskRead']['properties'])
        assert {'version_id', 'unit_id', 'shot_id'}.isdisjoint(contract['TaskSourceRead']['properties'])


@pytest.mark.asyncio
async def test_retired_scene_versions_are_not_routed(tmp_path):
    """旧场次版本接口已退役，场次读取接口仍可处理请求。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            scene = await DirectingStore(db, "p1").create_sequence(chapter_id="ch1", title="店内", position=0)
        path = f"/api/v1/studio/projects/p1/directing/sequences/{scene.id}"
        assert (await client.get(path)).status_code == 200
        assert (await client.get(path + "/versions")).status_code == 404
        assert (await client.post(path + "/versions/version/exports", json={})).status_code == 404
        contract = (await client.get("/openapi.json")).json()
        assert not any("/sequences/{sequence_id}/versions" in path for path in contract["paths"])


@pytest.mark.asyncio
async def test_retired_scene_delivery_queries_are_not_routed(tmp_path):
    """章节和场次的旧交付查询退役，章节组合仍可读取。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            scene = await DirectingStore(db, "p1").create_sequence(chapter_id="ch1", title="店内", position=0)
        base = "/api/v1/studio/projects/p1/directing"
        chapter = f"{base}/chapters/ch1"
        assert (await client.get(chapter + "/assembly")).status_code == 200
        assert (await client.get(chapter + "/deliveries")).status_code == 404
        assert (await client.get(f"{base}/sequences/{scene.id}/deliveries")).status_code == 404


@pytest.mark.asyncio
async def test_scene_api_conflicts_do_not_break_refresh_or_freeze(tmp_path):
    """旧版本、重复顺序和冻结后修改被拒绝，随后刷新仍返回完整有效版本。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        base = "/api/v1/studio/projects/p1/directing"
        chapter = (await client.get(base + "/chapters/ch1")).json()["data"]
        body = {"title": "店内", "position": 0, "source_version": chapter["source_version"], "span": {"start": 0, "end": 4}}
        response = await client.post(base + "/chapters/ch1/sequences", json=body)
        assert response.status_code == 200
        scene = response.json()["data"]
        assert (await client.post(base + "/chapters/ch1/sequences", json=body)).status_code == 409
        assert (await client.post(base + "/chapters/ch1/sequences", json={**body, "position": 1, "span": {"start": 4, "end": 2}})).status_code == 422
        path = base + "/sequences/" + scene["id"]
        assert (await client.post(path + "/revisions", json={"sequence_version": 99, "document": {"kind": "design", "content": design_sample()}})).status_code == 409
        workspace = (await client.get(path)).json()["data"]
        assert workspace["designs"] == []
        saved = await client.post(path + "/revisions", json={"sequence_version": 1, "document": {"kind": "design", "content": design_sample()}})
        assert saved.status_code == 200
        design = saved.json()["data"]["designs"][0]
        confirmed = await client.post(path + "/revisions/" + design["id"] + "/confirm", json={"expected_version": design["version"]})
        assert confirmed.status_code == 200
        conflict = await client.post(path + "/revisions", json={"sequence_version": 1, "revision_id": design["id"], "expected_version": 1,
            "document": {"kind": "design", "content": design_sample("handover")}})
        assert conflict.status_code == 409
        fresh = (await client.get(path)).json()["data"]
        assert fresh["designs"][0]["confirmed_by"] == "local-user"
        assert fresh["designs"][0]["content"] == design["content"]
        assert (await client.get(path.replace("projects/p1/", "projects/p2/"))).status_code == 422
        assert len((await client.get(base + "/chapters/ch1")).json()["data"]["sequences"]) == 1


@pytest.mark.asyncio
async def test_reference_from_other_project_is_rejected_without_partial_plan(tmp_path):
    """其他项目专属文件不能经生产计划进入当前项目，失败后仍可保存合法计划。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingStore(db, "p1")
            scene = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            design = await frozen(service, scene.id, "design", design_sample())
            plan = plan_sample(design.id)
            plan["units"][0]["references"] = [{"id": "r1", "file_id": "image1", "media_kind": "image", "purpose": "space",
                "participant_ids": [], "ordinal": 0, "source": {"kind": "human", "reference": "author", "version": "1"}}]
            db.add(FileUsage(file_id="image1", project_id="p2", usage_kind="upload", source_ref="foreign"))
        async with client_for(sessions) as client:
            path = f"/api/v1/studio/projects/p1/directing/sequences/{scene.id}"
            response = await client.post(path + "/revisions", json={"document": {"kind": "plan", "content": plan}})
            assert response.status_code == 422 and "其他项目" in response.json()["detail"]
            assert (await client.get(path)).json()["data"]["plans"] == []
            plan["units"][0]["references"] = []
            assert (await client.post(path + "/revisions", json={"document": {"kind": "plan", "content": plan}})).status_code == 200


@pytest.mark.asyncio
async def test_scene_transaction_commits_before_response_is_sent(tmp_path):
    """客户端拿到成功即可进入下一步，不能先发送响应再提交确认状态。"""
    async with database(tmp_path) as sessions:
        app = FastAPI()
        app.include_router(router, prefix='/api/v1/studio')
        committed = False
        states_at_response = []

        async def scoped_db():
            """记录实际事务提交完成的时刻。"""
            nonlocal committed
            committed = False
            async with sessions.begin() as db:
                yield db
            committed = True

        async def observe_response(scope, receive, send):
            """在 HTTP 响应真正发出时检查提交顺序。"""
            async def observed_send(message):
                """只观察协议事件，不延迟响应或改变提交顺序。"""
                if message['type'] == 'http.response.start':
                    states_at_response.append(committed)
                await send(message)
            await app(scope, receive, observed_send)

        app.dependency_overrides[get_db] = scoped_db
        async with AsyncClient(transport=ASGITransport(app=observe_response), base_url='http://test') as client:
            base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
            chapter = (await client.get(base)).json()['data']
            response = await client.post(base + '/sequences', json={'title':'店内','position':0,
                'source_version':chapter['source_version'],'span':{'start':0,'end':4}})
            assert response.status_code == 200
        assert states_at_response == [True, True]


@pytest.mark.asyncio
async def test_reference_capabilities_use_model_and_adapter_rules(tmp_path):
    """返回的是当前接入范围，未知上限保留为空，不允许其他类别或不存在项目。"""
    from app.models.llm import Provider, Model
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add_all([Provider(id="v", name="Vidu", api_key="test", base_url="https://example.invalid"),
                        Provider(id="o", name="OpenAI", api_key="test", base_url="https://example.invalid"),
                        Provider(id="k", name="Kling", api_key="test", base_url="https://example.invalid")])
            await db.flush()
            db.add_all([Model(id="v1", provider_id="v", name="viduq2", category="video"),
                        Model(id="o1", provider_id="o", name="unknown-video", category="video"),
                        Model(id="k1", provider_id="k", name="kling-3.0-turbo", category="video"),
                        Model(id="k2", provider_id="k", name="kling-3.0", category="video"),
                        Model(id="text", provider_id="o", name="text", category="text")])
        async with client_for(sessions) as client:
            base = "/api/v1/studio/projects/p1/directing/video-models/"
            response = await client.get(base + "v1/reference-capabilities")
            assert response.status_code == 200
            data = response.json()["data"]
            assert data["subject_images"] and data["max_images_per_subject"] == 3
            assert data["max_subjects"] == 7 and not data["combine_subjects_and_frames"]
            data = (await client.get(base + "o1/reference-capabilities")).json()["data"]
            assert not data["subject_images"] and data["max_frames"] == 1
            assert data["frame_roles"] == ["first_frame"]
            assert data["max_subjects"] is None
            data = (await client.get(base + "k1/reference-capabilities")).json()["data"]
            assert data["frame_roles"] == []
            data = (await client.get(base + "k2/reference-capabilities")).json()["data"]
            assert data["frame_roles"] == ["first_frame", "last_frame"]
            assert (await client.get(base + "text/reference-capabilities")).status_code == 422
            assert (await client.get(base.replace("p1", "missing") + "v1/reference-capabilities")).status_code == 422


@pytest.mark.asyncio
async def test_chapter_overview_api_is_lightweight_and_project_scoped(tmp_path):
    """概览独立响应契约，不允许跨项目读取。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = '/api/v1/studio/projects/p1/directing/chapters/ch1/overview'
        response = await client.get(path)
        assert response.status_code == 200
        assert set(response.json()['data']) == {'chapter_id', 'title', 'source_version', 'sequences'}
        assert response.json()['data']['sequences'] == []
        assert (await client.get(path.replace('/p1/', '/p2/'))).status_code == 422


@pytest.mark.asyncio
async def test_chapter_division_preview_commit_receipt_and_history(tmp_path):
    """HTTP 预览零写入、原子保存幂等、历史深链接与跨项目保护。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        base = '/api/v1/studio/projects/p1/directing'
        path = base + '/chapters/ch1'
        chapter = (await client.get(path)).json()['data']
        draft = {'source_version': chapter['source_version'], 'baseline': [], 'members': [
            {'key': 'a', 'title': '前场', 'span': {'start': 0, 'end': 3}},
            {'key': 'b', 'title': '后场', 'span': {'start': 3, 'end': 7}}], 'lineage': [], 'exited_sequence_ids': []}
        old_member = {**draft['members'][0], 'shooting_preparation': {}}
        obsolete = {**draft, 'members': [old_member, draft['members'][1]]}
        assert (await client.post(path + '/division/preview', json=obsolete)).status_code == 422
        preview = await client.post(path + '/division/preview', json=draft)
        assert preview.status_code == 200
        assert (await client.get(path)).json()['data']['sequences'] == []
        body = {'request_id': 'atomic', 'draft': draft, 'preview_token': preview.json()['data']['preview_token']}
        saved = await client.put(path + '/division', json=body)
        assert saved.status_code == 200
        assert (await client.put(path + '/division', json=body)).json() == saved.json()
        assert (await client.get(path + '/division/receipts/atomic')).json() == saved.json()
        assert (await client.get(path + '/division/receipts/missing')).json()['data'] is None
        assert (await client.get(path + '/division/history/receipts/atomic')).status_code == 404
        changed = {**body, 'draft': {**draft, 'members': [{**draft['members'][0], 'title': '另一个方案'}, draft['members'][1]]}}
        assert (await client.put(path + '/division', json=changed)).status_code == 409
        first_version = saved.json()['data']['chapter']['current_version']
        rows = saved.json()['data']['chapter']['sequences']
        assert len(rows) == 2
        draft.update(baseline=[{'sequence_id': row['id'], 'version': row['version']} for row in rows],
            members=[{'key': 'b', 'sequence_id': rows[1]['id'], 'title': rows[1]['title'], 'span': rows[1]['span']}],
            exited_sequence_ids=[rows[0]['id']], lineage=[{'sequence_id': rows[0]['id'], 'target_keys': []},
                                                       {'sequence_id': rows[1]['id'], 'target_keys': ['b']}])
        preview = (await client.post(path + '/division/preview', json=draft)).json()['data']
        body = {'request_id': 'retire', 'draft': draft, 'preview_token': preview['preview_token'], 'identity_changes_confirmed': True}
        assert (await client.put(path + '/division', json=body)).status_code == 200
        history = (await client.get(path + '/history')).json()['data']
        assert history[0]['id'] == rows[0]['id'] and history[0]['is_current'] is False
        old = (await client.get(base + '/sequences/' + rows[0]['id'])).json()['data']
        assert old['sequence']['is_current'] is False
        assert (await client.get(path.replace('/p1/', '/p2/') + '/history')).status_code == 422
        assert len((await client.get(path + '/overview')).json()['data']['sequences']) == 1
        latest = (await client.get(path)).json()['data']
        historical = (await client.get(path + '/division/versions/' + first_version['id'])).json()['data']
        surviving = latest['sequences'][0]
        restored_draft = {
            'source_version': latest['source_version'], 'source_revision_id': first_version['id'],
            'baseline': [{'sequence_id': surviving['id'], 'version': surviving['version']}],
            'restored_baseline': historical['restored_baseline'], 'exited_sequence_ids': [],
            'members': [{'key': row['id'], 'sequence_id': row['id'], 'title': row['title'], 'span': row['span']}
                        for row in historical['chapter']['sequences']],
            'lineage': [{'sequence_id': surviving['id'], 'target_keys': [surviving['id']]}],
        }
        preview = await client.post(path + '/division/preview', json=restored_draft)
        assert preview.status_code == 200, preview.text
        restore = {'request_id': 'restore', 'draft': restored_draft,
                   'preview_token': preview.json()['data']['preview_token'], 'identity_changes_confirmed': True}
        restored = await client.put(path + '/division', json=restore)
        assert restored.status_code == 200, restored.text
        assert (await client.put(path + '/division', json=restore)).json() == restored.json()
        versions = (await client.get(path + '/division/history')).json()['data']
        assert versions['total'] == 3
        assert versions['current_version'] == restored.json()['data']['chapter']['current_version']
        current = (await client.get(path)).json()['data']['sequences']
        assert [(row['id'], row['position']) for row in current] == [(rows[0]['id'], 0), (rows[1]['id'], 1)]



@pytest.mark.asyncio
async def test_division_history_http_contracts_are_read_only_and_scoped(tmp_path):
    """通过真实 HTTP 序列化验证摘要、版本和分析，不绕过响应 DTO。"""
    from app.models.task import Task
    from app.services.directing.division import DivisionService
    from tests.directing.test_division import setup_two

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DivisionService(db, 'p1')
            await setup_two(service)
            chapter = await service.list_sequences('ch1')
            db.add(Task(id='history-ai', project_id='p1', target_type='directing_chapter', target_id='ch1',
                kind='directing_divide', status='succeeded', input_snapshot={
                    'private_configuration': 'must-not-leak', 'run_args': {'script_text': chapter.raw_text,
                    'source_version': chapter.source_version, 'division_baseline': {row.id: row.version for row in chapter.sequences}}},
                result={'scenes': [{'title': '分析方案', 'excerpt': chapter.raw_text, 'purpose': '叙事'}]}))
        async with client_for(sessions) as client:
            path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
            before = (await client.get(path)).json()
            endpoints = ['/division/history?page_size=2', '/division/versions/' + chapter.current_version.id,
                         '/division/analyses/history-ai']
            responses = []
            for endpoint in endpoints:
                response = await client.get(path + endpoint)
                assert response.status_code == 200, response.text
                assert 'must-not-leak' not in response.text and 'private_configuration' not in response.text
                responses.append(response.json()['data'])
                assert (await client.get(path.replace('/p1/', '/p2/') + endpoint)).status_code == 422
            assert len(responses[0]['items']) == 2 and responses[0]['total'] == 3
            assert responses[1]['chapter']['current_version']['id'] == chapter.current_version.id
            assert responses[2]['result']['scenes'][0]['title'] == '分析方案'
            assert (await client.get(path + '/division/history?page=0')).status_code == 422
            assert (await client.get(path + '/division/history?page_size=101')).status_code == 422
            assert (await client.get(path)).json() == before
