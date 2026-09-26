"""角色引用演员时，后端必须**在同一事务内幂等**确保 `ProjectActorLink`。

背景（收口要求）：
- 前端「从演员库选择」只写 `Character.actor_id`，**不提前写关联**（用户可能只是看看或随后取消）；
- 角色落库时由后端确保「演员 ↔ 本项目」的项目关联存在：
  同一事务、幂等（重复选择不产生重复关系）、失败整体回滚。

本文件覆盖：创建时补关联、重复选择不建重复关系、更新角色时补新演员关联、
以及失败时角色与关联都不落库（回滚）。
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.studio import Actor, Project, ProjectActorLink


def _build():
    from app.core.db import Base
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    asyncio.run(_create_all(engine))
    return factory, engine


async def _create_all(engine):
    from app.core.db import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _seed(factory: async_sessionmaker[AsyncSession]) -> None:
    """用接口建项目与演员（与真实用法一致，避免自己拼 ORM 字段）。"""

    async def run() -> None:
        async with factory() as db:
            db.add(Project(id="proj-1", name="项目", description="", style="真人都市", visual_style="现实"))
            await db.commit()

    asyncio.run(run())


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


async def _actor_links(factory: async_sessionmaker[AsyncSession]) -> list[tuple[str, str]]:
    async with factory() as db:
        rows = (
            await db.execute(
                select(ProjectActorLink.actor_id, ProjectActorLink.project_id).where(
                    ProjectActorLink.project_id == "proj-1"
                )
            )
        ).all()
    return [(row[0], row[1]) for row in rows]


async def _character_count(factory: async_sessionmaker[AsyncSession]) -> int:
    from app.models.studio import Character

    async with factory() as db:
        return int((await db.execute(select(func.count()).select_from(Character))).scalar() or 0)


def _create_actor(client: TestClient, actor_id: str, name: str) -> None:
    res = client.post(
        "/api/v1/studio/entities/actor",
        json={"id": actor_id, "name": name, "description": "", "visual_style": "现实", "view_count": 1},
    )
    assert res.status_code == 201, res.text


def _post_character(client: TestClient, *, character_id: str, actor_id: str | None, name: str = "角色"):
    body = {
        "id": character_id,
        "project_id": "proj-1",
        "name": name,
        "description": "",
        "visual_style": "现实",
        "style": "真人都市",
    }
    if actor_id is not None:
        body["actor_id"] = actor_id
    return client.post("/api/v1/studio/entities/character", json=body)


def test_create_character_ensures_project_actor_link() -> None:
    """创建角色即在同一事务内建立「演员 ↔ 项目」关联。"""
    factory, engine = _build()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_actor(client, "actor-1", "演员甲")
            res = _post_character(client, character_id="char-1", actor_id="actor-1")
            assert res.status_code == 201, res.text
            assert res.json()["data"]["actor_id"] == "actor-1"
        assert asyncio.run(_actor_links(factory)) == [("actor-1", "proj-1")]
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_repeated_selection_does_not_duplicate_link() -> None:
    """两个角色引用同一位演员 → 项目关联仍只有一条（幂等，不重复）。"""
    factory, engine = _build()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_actor(client, "actor-1", "演员甲")
            assert _post_character(client, character_id="char-1", actor_id="actor-1").status_code == 201
            assert _post_character(client, character_id="char-2", actor_id="actor-1", name="角色2").status_code == 201
        links = asyncio.run(_actor_links(factory))
        assert links == [("actor-1", "proj-1")], links
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_update_character_ensures_link_for_new_actor() -> None:
    """改角色换演员 → 新演员的关联被补齐（旧关联保留，不做破坏性删除）。"""
    factory, engine = _build()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            _create_actor(client, "actor-1", "演员甲")
            _create_actor(client, "actor-2", "演员乙")
            assert _post_character(client, character_id="char-1", actor_id="actor-1").status_code == 201
            patched = client.patch("/api/v1/studio/entities/character/char-1", json={"actor_id": "actor-2"})
            assert patched.status_code == 200, patched.text
            assert patched.json()["data"]["actor_id"] == "actor-2"
        links = asyncio.run(_actor_links(factory))
        assert ("actor-2", "proj-1") in links
        assert ("actor-1", "proj-1") in links  # 历史关联不清除（非破坏性）
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_failed_create_rolls_back_character_and_link() -> None:
    """演员不存在 → 请求失败，角色与关联都不落库（同一事务回滚）。"""
    factory, engine = _build()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            res = _post_character(client, character_id="char-bad", actor_id="actor-missing")
            assert res.status_code == 400, res.text
        assert asyncio.run(_character_count(factory)) == 0
        assert asyncio.run(_actor_links(factory)) == []
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_character_without_actor_creates_no_link() -> None:
    """不选演员的角色不会凭空产生关联。"""
    factory, engine = _build()
    _seed(factory)
    app.dependency_overrides[get_db] = _override(factory)
    try:
        with TestClient(app) as client:
            assert _post_character(client, character_id="char-no-actor", actor_id=None).status_code == 201
        assert asyncio.run(_actor_links(factory)) == []
        assert asyncio.run(_character_count(factory)) == 1
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())
