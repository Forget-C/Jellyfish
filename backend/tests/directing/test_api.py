"""场次接口的事务边界、失败恢复及项目隔离；不调用外部模型。"""

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1.routes.studio.directing import router
from app.dependencies import get_db
from app.models.studio import FileUsage
from app.services.directing.store import DirectingStore
from tests.directing.samples import design_sample, plan_sample
from tests.directing.test_store import database, frozen


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

    async def scoped_db():
        """模拟真实请求提交和异常回滚，不共享未提交的测试会话。"""
        async with sessions.begin() as db:
            yield db

    app.dependency_overrides[get_db] = scoped_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


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
