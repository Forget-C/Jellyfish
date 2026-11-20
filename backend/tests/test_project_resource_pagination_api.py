"""查询项目独立对象的公开筛选与分页契约。"""

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Actor, ActorImage, Chapter, Project, ProjectActorLink


@pytest.mark.asyncio
async def test_project_resources_filter_owned_objects_before_pagination(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine)

        async def database():
            async with sessions() as session:
                yield session

        monkeypatch.setitem(app.dependency_overrides, get_db, database)
        created = datetime(2026, 1, 1, tzinfo=UTC)
        async with sessions.begin() as session:
            session.add_all(Project(id=key, name=key, style="真人都市") for key in ("p1", "p2"))
            await session.flush()
            session.add_all([
                Actor(id="c", name="机场创建", project_id="p1", origin="created", style="真人都市", created_at=created),
                Actor(id="b", name="机场导入", project_id="p1", origin="library", style="真人都市", created_at=created),
                Actor(id="a", name="演员", project_id="p1", style="真人都市", created_at=created,
                      supplementary_info="机场", origin="project", source_kind="character", source_id="role"),
                Actor(id="other", name="机场其他项目", project_id="p2", style="真人都市"),
                Actor(id="shared", name="机场共享", style="真人都市"),
            ])
            session.add(Chapter(id="chapter", project_id="p1", index=1, title="片段"))
            await session.flush()
            session.add_all([
                ProjectActorLink(project_id="p1", chapter_id="chapter", actor_id="a"),
                ProjectActorLink(project_id="p1", actor_id="a"),
                ProjectActorLink(project_id="p1", actor_id="b"),
                ActorImage(actor_id="b", file_id="file-b", view_angle="LEFT"),
                ActorImage(actor_id="a", file_id="file-a", view_angle="FRONT"),
                ActorImage(actor_id="c", file_id=None, view_angle="FRONT"),
            ])

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async def actors(**params):
                response = await client.get("/api/v1/studio/entities/actor", params={
                    "project_id": "p1", "q": "机场", "order": "created_at", "is_desc": True,
                    "page_size": 1, **params,
                })
                assert response.status_code == 200, response.text
                data = response.json()["data"]
                return [item["id"] for item in data["items"]], data["pagination"]["total"]

            assert await actors(source=["role_conversion", "library"], has_cover=True) == (["a"], 2)
            assert await actors(source=["role_conversion", "library"], has_cover=True, page=2) == (["b"], 2)
            assert await actors(has_cover=False) == (["c"], 1)
            assert await actors(source=["project"]) == ([], 0)
    finally:
        await engine.dispose()
