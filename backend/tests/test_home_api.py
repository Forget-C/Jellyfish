"""首页摘要的公开接口回归测试。"""
from datetime import datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.directing import Sequence
from app.models.generation_canvas import GenerationCanvas
from app.models.studio import Actor, Chapter, Costume, FileItem, Project, Prop, PropImage, Scene


@pytest_asyncio.fixture
async def home_api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine)

    async def database():
        async with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, database)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1/studio/home/") as client:
            yield client, sessions
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_recent_canvases_mix_free_and_scene_canvases(home_api):
    client, sessions = home_api
    assert (await client.get("recent-canvases")).json()["data"] == []
    async with sessions.begin() as db:
        db.add_all([
            Project(id="project", name="真实项目", style="现实主义"),
            Chapter(id="chapter", project_id="project", index=1, title="第一章"),
            Sequence(id="sequence", chapter_id="chapter", position=1, title="第一场", source={}),
        ])
        for canvas_id, kind, day in [("free", "free", 3), ("scene-b", "scene", 3), ("scene-a", "scene", 2),
                                     ("old", "free", 1), ("detached", "scene", 4)]:
            db.add(GenerationCanvas(
                id=canvas_id, kind=kind, project_id="project" if kind == "scene" else None,
                sequence_id="sequence" if canvas_id.startswith("scene") else None,
                updated_at=datetime(2026, 11, day),
                document={"name": canvas_id, "cover_file_id": "cover"} if canvas_id == "free" else {"name": canvas_id},
            ))

    response = await client.get("recent-canvases")
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [row["id"] for row in rows] == ["scene-b", "free", "scene-a"]
    assert [row["project_name"] for row in rows] == ["真实项目", None, "真实项目"]
    assert rows[0]["cover_file_id"] is None and rows[1]["cover_file_id"] == "cover"
    assert rows[0]["updated_at"] == "2026-11-03T00:00:00Z"
    assert "document" not in rows[0]


@pytest.mark.asyncio
async def test_recent_assets_rank_library_records_across_types(home_api):
    client, sessions = home_api
    empty = await client.get("recent-assets")
    assert empty.status_code == 200, empty.text
    assert empty.json()["data"] == []

    async with sessions.begin() as db:
        db.add(Project(id="project", name="项目", style="现实主义"))
        for model, asset_id, day in [
            (Actor, "actor", 4), (Costume, "costume", 4), (Scene, "scene", 3),
            (Prop, "prop-b", 5), (Prop, "prop-a", 5), (Prop, "prop-c", 2), (Actor, "old", 1),
        ]:
            db.add(model(id=asset_id, name=asset_id, style="现实主义", updated_at=datetime(2026, 11, day)))
        db.add(Prop(id="copy", name="项目副本", project_id="project", style="现实主义", updated_at=datetime(2026, 11, 8)))
        for file_id in ["primary", "front"]:
            db.add(FileItem(id=file_id, type="image", name=file_id, storage_key=file_id))
        db.add_all([
            PropImage(prop_id="prop-c", file_id="primary", is_primary=True, view_angle="LEFT"),
            PropImage(prop_id="prop-c", file_id="front", view_angle="FRONT", updated_at=datetime(2026, 11, 9)),
        ])

    response = await client.get("recent-assets")
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [row["id"] for row in rows] == ["prop-a", "prop-b", "actor", "costume", "scene", "prop-c"]
    assert [row["type"] for row in rows] == ["prop", "prop", "actor", "costume", "scene", "prop"]
    assert rows[0]["thumbnail"] is None
    assert rows[-1]["thumbnail"] == "/api/v1/studio/files/primary/download"
    assert rows[-1]["updated_at"] == "2026-11-02T00:00:00Z"
