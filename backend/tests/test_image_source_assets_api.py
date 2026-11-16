"""通过 HTTP 验证图片来源对象的权限与复制隔离。"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.db import Base
from app.core import storage
from app.dependencies import get_db
from app.main import app


@pytest_asyncio.fixture
async def client(monkeypatch):
    files = {}
    async def upload(*, key, data, **_):
        files[key] = data if isinstance(data, bytes) else data.read()
    async def download(*, key):
        return files[key]
    async def info(*, key):
        return storage.StoredFileInfo(key=key, url=f"http://test/{key}", size=len(files[key]))
    monkeypatch.setattr(storage, "upload_file", upload)
    monkeypatch.setattr(storage, "download_file", download)
    monkeypatch.setattr(storage, "get_file_info", info)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    from app.models.studio import Actor
    async with sessions() as db:
        db.add(Actor(id="legacy", name="旧转化演员", style="国漫", visual_style="动漫", age_appearance="历史年龄", source_character_id="old-role"))
        await db.commit()
    async def database():
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = database
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield http
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["actor", "scene", "prop", "costume"])
async def test_upload_locked_details_and_default_order(client, kind):
    uploaded = await client.post("/api/v1/studio/files/upload", files={"file": ("image.png", b"image", "image/png")})
    file_id = uploaded.json()["data"]["id"]
    body = {"id": "upload", "name": "上传对象", "images": [{"file_id": file_id, "view_angle": angle} for angle in ["LEFT", "FRONT", "LEFT"]]}
    response = await client.post(f"/api/v1/studio/entities/{kind}/image-source", json=body)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["origin"] == "upload" and data["description"] == ""
    assert data["created_at"]
    assert (await client.get(f"/api/v1/studio/entities/{kind}/upload")).json()["data"]["created_at"] == data["created_at"]
    listed = (await client.get(f"/api/v1/studio/entities/{kind}")).json()["data"]["items"]
    assert next(item for item in listed if item["id"] == "upload")["created_at"] == data["created_at"]
    assert data["style"] is None and data["visual_style"] is None
    assert (await client.post(f"/api/v1/studio/entities/{kind}/image-source", json=body)).json()["data"]["id"] == "upload"
    assert (await client.patch(f"/api/v1/studio/entities/{kind}/upload", json={"supplementary_info": "禁止"})).status_code == 403
    assert (await client.patch(f"/api/v1/studio/entities/{kind}/upload", json={"name": "未确认改名"})).status_code == 403
    images = (await client.get(f"/api/v1/studio/entities/{kind}/upload/images")).json()["data"]["items"]
    assert [image["is_primary"] for image in images] == [True, False, False]
    assert [image["is_view_default"] for image in images] == [True, True, False]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["actor", "scene", "prop", "costume"])
async def test_uploaded_details_open_once_and_participate_in_generation(client, kind):
    uploaded = await client.post("/api/v1/studio/files/upload", files={"file": ("image.png", b"image", "image/png")})
    file_id = uploaded.json()["data"]["id"]
    path = f"/api/v1/studio/entities/{kind}"
    created = await client.post(path + "/image-source", json={"id": "editable-upload", "name": "图片对象", "images": [{"file_id": file_id, "view_angle": "FRONT"}]})
    assert created.status_code == 201, created.text
    identity = path + "/editable-upload"
    assert (await client.patch(identity, json={"supplementary_info": "未确认"})).status_code == 403
    rejected = await client.patch(identity, json={"details_editable": True, "references": [{"file_id": "missing", "role": "design"}]})
    assert rejected.status_code in {400, 404, 422}
    assert (await client.get(identity)).json()["data"]["details_editable"] is False
    fields = {"details_editable": True, "name": "开放对象", "supplementary_info": "保持窗边自然光", "style": "国漫", "visual_style": "动漫"}
    opened = await client.patch(identity, json=fields)
    assert opened.status_code == 200, opened.text
    saved = (await client.get(identity)).json()["data"]
    assert saved["details_editable"] is True and saved["origin"] == "upload"
    assert saved["supplementary_info"] == fields["supplementary_info"]
    assert saved["style"] == "国漫" and saved["visual_style"] == "动漫"
    listed = (await client.get(path, params={"style": "国漫"})).json()["data"]["items"]
    assert any(item["id"] == "editable-upload" and item["details_editable"] for item in listed)
    images = (await client.get(identity + "/images")).json()["data"]["items"]
    rendered = await client.post(f"/api/v1/studio/generation-prompts/assets/{kind}/editable-upload/slots/{images[0]['id']}/render", json={"references": [{"file_id": file_id, "role": "design"}]})
    assert rendered.status_code == 200, rendered.text
    assert fields["supplementary_info"] in rendered.json()["data"]["execution_prompt"]
    assert (await client.patch(identity, json={"supplementary_info": "后续修改"})).status_code == 200
    assert (await client.patch(identity, json={"details_editable": False})).status_code == 422


def test_uploaded_details_migration_preserves_existing_facts():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import sqlalchemy as sa
    path = Path(__file__).parents[1] / "alembic/versions/e82cfa190b64_uploaded_asset_details.py"
    spec = importlib.util.spec_from_file_location("uploaded_detail_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            for table in ("scenes", "props", "costumes"):
                connection.execute(sa.text(f"CREATE TABLE {table} (id TEXT PRIMARY KEY, supplementary_info TEXT)"))
                connection.execute(sa.text(f"INSERT INTO {table} VALUES ('existing', '原资料')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            for table in ("scenes", "props", "costumes"):
                assert connection.execute(sa.text(f"SELECT supplementary_info, details_editable FROM {table}")).one() == ("原资料", False)
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["actor", "character", "scene", "prop", "costume"])
async def test_import_and_publish_copy_only_images(client, kind):
    source_kind = "actor" if kind == "character" else kind
    assert (await client.post("/api/v1/studio/projects", json={"id": "p", "name": "项目", "style": "真人都市"})).status_code == 201
    uploaded = await client.post("/api/v1/studio/files/upload", files={"file": ("image.png", b"source pixels", "image/png")})
    file_id = uploaded.json()["data"]["id"]
    assert (await client.post(f"/api/v1/studio/entities/{source_kind}", json={"id": "source", "name": "来源", "supplementary_info": "不复制的设定"})).status_code == 201
    assert (await client.post(f"/api/v1/studio/entities/{source_kind}/source/images", json={"file_id": file_id, "view_angle": "LEFT"})).status_code == 201
    body = {"id": "target", "name": "项目副本", "source_id": "source", "project_id": "p"}
    response = await client.post(f"/api/v1/studio/entities/{kind}/image-source", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["data"]["origin"] == "library"
    assert response.json()["data"]["created_at"]
    listed = (await client.get(f"/api/v1/studio/entities/{kind}", params={"project_id": "p"})).json()["data"]["items"]
    assert next(item for item in listed if item["id"] == "target")["created_at"] == response.json()["data"]["created_at"]
    assert response.json()["data"]["description"] == ""
    assert (await client.post(f"/api/v1/studio/entities/{kind}/image-source", json=body)).json()["data"]["id"] == "target"
    images = (await client.get(f"/api/v1/studio/entities/{kind}/target/images")).json()["data"]["items"]
    assert len(images) == 1 and images[0]["file_id"] != file_id
    assert images[0]["view_angle"] == "LEFT" and images[0]["is_view_default"] and images[0]["is_primary"]
    published = await client.post(f"/api/v1/studio/entities/{kind}/target/publish-to-library", json={"name": "转化副本"})
    assert published.status_code == 201, published.text
    library = published.json()["data"]
    assert library["origin"] == "project" and library["description"] == ""
    library_images = (await client.get(f"/api/v1/studio/entities/{source_kind}/{library['id']}/images")).json()["data"]["items"]
    assert library_images[0]["file_id"] not in {file_id, images[0]["file_id"]}
    assert (await client.get(f"/api/v1/studio/files/{library_images[0]['file_id']}/download")).content == b"source pixels"
    assert (await client.post(f"/api/v1/studio/entities/{source_kind}/{library['id']}/images", json={"file_id": images[0]["file_id"], "view_angle": "BACK"})).status_code == 201
    assert (await client.patch(f"/api/v1/studio/entities/{kind}/target", json={"description": "禁止"} if kind == "character" else {"supplementary_info": "禁止"})).status_code == 403
    assert (await client.delete(f"/api/v1/studio/entities/{source_kind}/{library['id']}")).status_code == 200
    assert (await client.get(f"/api/v1/studio/entities/{kind}/target")).json()["data"]["library_copy_id"] is None
    assert (await client.post(f"/api/v1/studio/entities/{kind}/target/publish-to-library", json={"name": "再次入库"})).status_code == 201


@pytest.mark.asyncio
async def test_image_source_generation_requires_reference_and_keeps_style_temporary(client):
    uploaded = await client.post("/api/v1/studio/files/upload", files={"file": ("image.png", b"pixels", "image/png")})
    file_id = uploaded.json()["data"]["id"]
    assert (await client.post("/api/v1/studio/entities/actor/image-source", json={"id": "uploaded", "name": "图片演员", "images": [{"file_id": file_id, "view_angle": "FRONT"}]})).status_code == 201
    slot = (await client.post("/api/v1/studio/entities/actor/uploaded/images", json={"view_angle": "LEFT"})).json()["data"]["id"]
    path = f"/api/v1/studio/generation-prompts/assets/actor/uploaded/slots/{slot}/render"
    preview = await client.post(path, json={"visual_style": "动漫", "style": "国漫"})
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["variables_snapshot"]["style"] == "国漫"
    assert preview.json()["data"]["recommended_media"]["references"][0]["file_id"] == file_id
    assert (await client.post(path, json={"references": []})).status_code == 422
    draft = await client.post("/api/v1/studio/generation-prompts/assets/draft/render", json={"asset_type": "actor", "view_angle": "LEFT", "resource": {"id": "uploaded", "name": "预览改名", "supplementary_info": "不能注入的基础信息"}, "style": "国漫", "visual_style": "动漫"})
    assert draft.status_code == 200, draft.text
    assert "不能注入" not in draft.json()["data"]["execution_prompt"]
    assert draft.json()["data"]["variables_snapshot"]["name"] == "预览改名"
    saved = (await client.get("/api/v1/studio/entities/actor/uploaded")).json()["data"]
    assert saved["description"] == "" and saved["style"] is None and saved["name"] == "图片演员"


@pytest.mark.asyncio
async def test_invalid_upload_and_request_conflict(client):
    path = "/api/v1/studio/entities/actor/image-source"
    assert (await client.post(path, json={"id": "x", "name": "x", "images": []})).status_code == 422
    assert (await client.post(path, json={"id": "x", "name": " ", "images": [{"file_id": "missing", "view_angle": "FRONT"}]})).status_code == 422
    assert (await client.post(path, json={"id": "x", "name": "x", "images": [{"file_id": "missing", "view_angle": "RIGHT"}]})).status_code == 422
    assert (await client.post(path, json={"id": "x", "name": "x", "images": [{"file_id": "missing", "view_angle": "FRONT"}]})).status_code == 404


@pytest.mark.asyncio
async def test_legacy_permissions_and_image_source_rename_validation(client):
    assert (await client.get("/api/v1/studio/entities/actor/legacy")).json()["data"]["origin"] == "created"
    assert (await client.patch("/api/v1/studio/entities/actor/legacy", json={"name": "不能改"})).status_code == 403
    assert (await client.post("/api/v1/studio/entities/actor/legacy/images", json={"view_angle": "FRONT"})).status_code == 201
    uploaded = await client.post("/api/v1/studio/files/upload", files={"file": ("actor.png", b"pixels", "image/png")})
    file_id = uploaded.json()["data"]["id"]
    image = await client.post("/api/v1/studio/entities/actor/legacy/images", json={"file_id": file_id, "view_angle": "FRONT", "is_primary": True})
    path = f"/api/v1/studio/generation-prompts/assets/actor/legacy/slots/{image.json()['data']['id']}/render"
    rendered = await client.post(path, json={"visual_style": "动漫", "style": "国漫"})
    assert rendered.status_code == 200, rendered.text
    assert "历史年龄" not in rendered.json()["data"]["execution_prompt"]
    defaults = await client.post(path, json={})
    assert defaults.status_code == 200, defaults.text
    assert defaults.json()["data"]["variables_snapshot"]["style"] == "真人都市"
    assert defaults.json()["data"]["variables_snapshot"]["visual_style"] == "现实"
    assert (await client.post(path, json={"references": []})).status_code == 422
    opened = await client.patch("/api/v1/studio/entities/actor/legacy", json={"details_editable": True, "age_appearance": "30岁"})
    assert opened.status_code == 200, opened.text
    assert opened.json()["data"]["details_editable"] is True
    assert opened.json()["data"]["source_character_id"] == "old-role"
    rendered = await client.post(path, json={"references": [{"file_id": file_id, "role": "identity"}]})
    assert rendered.status_code == 200, rendered.text
    assert "30岁" in rendered.json()["data"]["execution_prompt"]
    assert (await client.patch("/api/v1/studio/entities/actor/legacy", json={"age_appearance": "35岁"})).status_code == 200
    assert (await client.patch("/api/v1/studio/entities/actor/legacy", json={"details_editable": False})).status_code == 422


def test_origin_migration_preserves_existing_facts():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import sqlalchemy as sa
    path = Path(__file__).parents[1] / "alembic/versions/c6e5a1b8d203_add_asset_origins.py"
    spec = importlib.util.spec_from_file_location("origin_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            for table in ("actors", "characters", "scenes", "props", "costumes"):
                connection.execute(sa.text(f"CREATE TABLE {table} (id TEXT PRIMARY KEY, name TEXT, description TEXT)"))
                connection.execute(sa.text(f"INSERT INTO {table} VALUES ('existing', '原名称', '原设定')"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            for table in ("actors", "characters", "scenes", "props", "costumes"):
                assert connection.execute(sa.text(f"SELECT name, description, origin, source_id FROM {table}")).one() == ("原名称", "原设定", "created", None)
            connection.execute(sa.text("UPDATE actors SET origin='upload'"))
            with Operations.context(MigrationContext.configure(connection)), pytest.raises(RuntimeError, match="image-source"):
                migration.downgrade()
            assert 'origin' in {column['name'] for column in sa.inspect(connection).get_columns('actors')}
            connection.execute(sa.text("UPDATE actors SET origin='created'"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert connection.execute(sa.text("SELECT name, description FROM actors")).one() == ("原名称", "原设定")
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_copy_failure_rolls_back_and_retry_keeps_identity(client, monkeypatch):
    assert (await client.post("/api/v1/studio/projects", json={"id": "copy-project", "name": "复制项目", "style": "真人都市"})).status_code == 201
    file_id = (await client.post("/api/v1/studio/files/upload", files={"file": ("image.png", b"pixels", "image/png")})).json()["data"]["id"]
    await client.post("/api/v1/studio/entities/actor", json={"id": "source", "name": "来源"})
    await client.post("/api/v1/studio/entities/actor/source/images", json={"file_id": file_id})
    original = storage.upload_file
    async def unavailable(**_kwargs):
        raise RuntimeError("isolated storage failure")
    monkeypatch.setattr(storage, "upload_file", unavailable)
    body = {"id": "copy", "name": "副本", "project_id": "copy-project", "source_id": "source"}
    with pytest.raises(RuntimeError, match="isolated storage failure"):
        await client.post("/api/v1/studio/entities/actor/image-source", json=body)
    assert (await client.get("/api/v1/studio/entities/actor/copy")).status_code == 404
    monkeypatch.setattr(storage, "upload_file", original)
    assert (await client.post("/api/v1/studio/entities/ACTOR/image-source", json=body)).status_code == 201
    assert (await client.delete("/api/v1/studio/entities/actor/source")).status_code == 200
    assert (await client.post("/api/v1/studio/entities/actor/image-source", json=body)).json()["data"]["id"] == "copy"
    assert (await client.post("/api/v1/studio/entities/actor/image-source", json={**body, "name": "不同请求"})).status_code == 409


@pytest.mark.asyncio
async def test_mysql_concurrent_same_upload_request_returns_one_object():
    import asyncio
    from uuid import uuid4
    from sqlalchemy import delete
    from app.models.studio import FileItem
    from tests.services.test_task_mysql import isolated_database_url
    from tests.directing.test_api import client_for
    engine = create_async_engine(isolated_database_url())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    identity = uuid4().hex
    try:
        async with sessions.begin() as db:
            db.add(FileItem(id=identity, name="来源并发检查", type="image", storage_key=f"check/{identity}"))
        async with client_for(sessions) as http:
            body = {"id": identity, "name": identity, "images": [{"file_id": identity, "view_angle": "LEFT"}]}
            results = await asyncio.gather(*(http.post("/api/v1/studio/entities/actor/image-source", json=body) for _ in range(2)))
            assert [result.status_code for result in results] == [201, 201]
            assert all(result.json()["data"]["id"] == identity for result in results)
            images = (await http.get(f"/api/v1/studio/entities/actor/{identity}/images")).json()["data"]["items"]
            assert len(images) == 1
            await http.delete(f"/api/v1/studio/entities/actor/{identity}")
    finally:
        async with sessions.begin() as db:
            await db.execute(delete(FileItem).where(FileItem.id == identity))
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["actor", "scene", "prop", "costume"])
async def test_project_link_requires_an_independent_project_object(client, kind):
    assert (await client.post("/api/v1/studio/projects", json={"id": "p", "name": "项目", "style": "真人都市"})).status_code == 201
    assert (await client.post(f"/api/v1/studio/entities/{kind}", json={"id": "library", "name": "库中原件"})).status_code == 201
    linked = await client.post(f"/api/v1/studio/project-assets/{kind}", json={"project_id": "p", "asset_id": "library"})
    assert linked.status_code == 400, linked.text
    assert (await client.post(f"/api/v1/studio/entities/{kind}", json={"id": "private", "name": "项目对象", "project_id": "p"})).status_code == 201
    private_link = await client.post(f"/api/v1/studio/project-assets/{kind}", json={"project_id": "p", "asset_id": "private"})
    assert private_link.status_code == 201
    assert (await client.delete(f"/api/v1/studio/project-assets/{kind}/{private_link.json()['data']['id']}")).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["character", "scene", "prop"])
async def test_project_exact_name_candidates_are_distinct_from_keyword_search(client, kind):
    await client.post('/api/v1/studio/projects', json={'id': 'candidate-project', 'name': '候选项目', 'style': '真人都市'})
    for index, name in enumerate(['张三', '张三的朋友', '李四']):
        response = await client.post(f'/api/v1/studio/entities/{kind}', json={
            'id': f'candidate-{index}', 'name': name, 'project_id': 'candidate-project'})
        assert response.status_code == 201, response.text
    assert (await client.post('/api/v1/studio/projects', json={'id': 'other-project', 'name': '其他项目', 'style': '真人都市'})).status_code == 201
    assert (await client.post(f'/api/v1/studio/entities/{kind}', json={'id': 'foreign', 'name': '张三', 'project_id': 'other-project'})).status_code == 201
    matches = await client.get(f'/api/v1/studio/entities/{kind}', params={
        'project_id': 'candidate-project', 'exact_name': ' 张三 '})
    assert matches.status_code == 200, matches.text
    assert [item['name'] for item in matches.json()['data']['items']] == ['张三']
    missing = await client.get(f'/api/v1/studio/entities/{kind}', params={
        'project_id': 'candidate-project', 'exact_name': '不存在'})
    assert missing.json()['data']['pagination']['total'] == 0
