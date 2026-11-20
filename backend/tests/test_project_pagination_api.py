"""项目的搜索、制作阶段与排序均在分页前生效。"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import Chapter, Project


@pytest.mark.asyncio
async def test_project_queries_cover_all_projects_and_chapters(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Project.__table__.create)
        await connection.run_sync(Chapter.__table__.create)
    sessions = async_sessionmaker(engine)

    async def database():
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, database)
    try:
        async with sessions.begin() as session:
            session.add_all([
                Project(id=f"p{i:02}", name="项目", style="真人都市", description="面包车" if i == 20 else "")
                for i in range(21)
            ])
            await session.flush()
            session.add(Chapter(id="ready", project_id="p00", index=1, title="已就绪", raw_text="原文"))
            session.add_all([
                Chapter(id=f"chapter{i}", project_id="p20", index=i, title="章节",
                        raw_text="\t\n\u3000" if i == 101 else "原文")
                for i in range(1, 102)
            ])

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async def list_projects(**params):
                response = await client.get("/api/v1/studio/projects", params=params)
                assert response.status_code == 200, response.text
                data = response.json()["data"]
                return [project["id"] for project in data["items"]], data["pagination"]["total"]

            assert await list_projects(q="%") == ([], 0)
            assert await list_projects(q="面包车", stage="edit_raw", page_size=1) == (["p20"], 1)
            assert await list_projects(stage="edit_raw", order="chapter_count", is_desc=True,
                                       page=2, page_size=2) == (["p02", "p03"], 20)
            assert await list_projects(order="chapter_count", is_desc=True,
                                       page_size=2) == (["p20", "p00"], 21)
            assert await list_projects(order="name", page=3, page_size=10) == (["p20"], 21)
    finally:
        await engine.dispose()
