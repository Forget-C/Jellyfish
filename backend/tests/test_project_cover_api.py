"""项目封面经过公开 API 保存并独立管理。"""
from base64 import b64decode

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import storage
from app.core.db import Base
from app.dependencies import get_db
from app.main import app

PNG = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwCFgAAAHUASELh2rEAAAAAElFTkSuQmCC")


@pytest_asyncio.fixture
async def api(monkeypatch):
    objects = {}

    async def put(*, key, data, **_):
        objects[key] = data if isinstance(data, bytes) else data.read()

    async def get(*, key, max_bytes=None):
        return objects[key][:max_bytes]

    monkeypatch.setattr(storage, "upload_file", put)
    monkeypatch.setattr(storage, "download_file", get)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine)

    async def database():
        async with sessions.begin() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, database)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1/studio/") as client:
            created = await client.post("projects", json={"id": "project", "name": "项目", "style": "真人都市"})
            assert created.status_code == 201, created.text
            yield client
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_selected_cover_survives_source_deletion_and_is_retired_on_clear(api):
    source = (await api.post("files/upload", files={"file": ("poster.png", PNG, "image/png")})).json()["data"]["id"]
    updated = await api.patch("projects/project", json={"cover_file_id": source, "name": "新名称"})
    assert updated.status_code == 200, updated.text
    cover = updated.json()["data"]["cover_file_id"]
    assert cover != source
    assert (await api.get("projects")).json()["data"]["items"][0]["cover_file_id"] == cover
    assert (await api.patch("projects/project", json={"description": "简介"})).json()["data"]["cover_file_id"] == cover
    listed = (await api.get("files", params={"file_type": "image"})).json()["data"]["items"]
    assert [row["id"] for row in listed] == [source]
    assert (await api.delete(f"files/{cover}")).status_code == 409
    assert (await api.delete(f"files/{source}")).status_code == 200
    assert (await api.get(f"files/{cover}/download")).content == PNG
    failed = await api.patch("projects/project", json={"cover_file_id": source, "name": "不能保存"})
    assert failed.status_code == 410
    assert failed.json()["message"] == "源图片已不可用，请重新选择封面"
    assert (await api.get("projects/project")).json()["data"]["name"] == "新名称"
    cleared = await api.patch("projects/project", json={"cover_file_id": None})
    assert cleared.json()["data"]["cover_file_id"] is None
    assert (await api.get(f"files/{cover}/download")).status_code == 410


@pytest.mark.asyncio
async def test_cover_upload_replacement_and_project_deletion(api):
    path = "projects/project"
    first = await api.patch(path + "/cover-upload", data={"settings": '{"description":"新简介"}'},
                            files={"file": ("cover.png", PNG, "image/png")})
    assert first.status_code == 200, first.text
    first_cover = first.json()["data"]["cover_file_id"]
    assert first.json()["data"]["description"] == "新简介"
    invalid = await api.patch(path + "/cover-upload", files={"file": ("fake.png", b"not image", "image/png")})
    assert invalid.status_code == 422
    invalid_source = await api.post("files/upload", files={"file": ("broken.png", PNG[:16], "image/png")})
    invalid_copy = await api.patch(path, json={"cover_file_id": invalid_source.json()["data"]["id"]})
    assert invalid_copy.status_code == 422
    assert (await api.get(path)).json()["data"]["cover_file_id"] == first_cover
    second = await api.patch(path + "/cover-upload", files={"file": ("next.png", PNG, "image/png")})
    assert second.status_code == 200, second.text
    second_cover = second.json()["data"]["cover_file_id"]
    assert second_cover != first_cover
    assert (await api.get(f"files/{first_cover}/download")).status_code == 410
    assert [row["name"] for row in (await api.get("files")).json()["data"]["items"]] == ["broken"]
    assert (await api.delete(path)).status_code == 200
    assert (await api.get(f"files/{second_cover}/download")).status_code == 410
