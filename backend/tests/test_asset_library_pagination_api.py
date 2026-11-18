"""资产库按类别搜索后稳定分页。"""

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Actor, Scene


@pytest.mark.asyncio
async def test_asset_library_search_and_stable_pagination(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine)

        async def database():
            async with sessions() as session:
                yield session

        monkeypatch.setitem(app.dependency_overrides, get_db, database)
        timestamp = datetime(2026, 1, 1, tzinfo=UTC)
        async with sessions.begin() as session:
            session.add_all([
                Actor(id="c", name="机场演员", style="真人都市", updated_at=timestamp),
                Actor(id="b", name="其他演员", style="真人都市", updated_at=timestamp),
                Actor(id="a", name="普通演员", style="真人都市", updated_at=timestamp,
                      supplementary_info="机场旅客"),
                Scene(id="scene", name="机场场景", style="真人都市"),
            ])

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async def actors(page, q=""):
                response = await client.get("/api/v1/studio/entities/actor", params={
                    "q": q, "page": page, "page_size": 1, "order": "updated_at", "is_desc": True,
                })
                assert response.status_code == 200, response.text
                data = response.json()["data"]
                return [item["id"] for item in data["items"]], data["pagination"]["total"]

            assert await actors(1) == (["a"], 3)
            assert await actors(2) == (["b"], 3)
            assert await actors(1, "机场") == (["a"], 2)
            assert await actors(2, "机场") == (["c"], 2)
    finally:
        await engine.dispose()
