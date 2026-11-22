from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import Model, ModelCategoryKey, Provider
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    ensure_not_exists,
    patch_model,
    require_entity,
    require_optional_entity,
)


async def _build_session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


@pytest.mark.asyncio
async def test_require_entity_returns_existing_object() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        await create_and_refresh(db, provider)

        found = await require_entity(db, Provider, "p1", detail="Provider not found")

        assert found.id == "p1"
    await engine.dispose()


@pytest.mark.asyncio
async def test_require_entity_raises_404_when_missing() -> None:
    db, engine = await _build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await require_entity(db, Provider, "missing", detail="Provider not found")

        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "Provider not found"
    await engine.dispose()


@pytest.mark.asyncio
async def test_require_optional_entity_returns_none_for_empty_id() -> None:
    db, engine = await _build_session()
    async with db:
        found = await require_optional_entity(db, Provider, None, detail="Provider not found")
        assert found is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_ensure_not_exists_raises_on_duplicate() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        await create_and_refresh(db, provider)

        with pytest.raises(HTTPException) as exc_info:
            await ensure_not_exists(db, Provider, "p1", detail="Provider already exists")

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "Provider already exists"
    await engine.dispose()


@pytest.mark.asyncio
async def test_patch_model_updates_fields_in_memory() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        await create_and_refresh(db, provider)

        patch_model(provider, {"name": "OpenAI Updated", "description": "new desc"})

        assert provider.name == "OpenAI Updated"
        assert provider.description == "new desc"
    await engine.dispose()


@pytest.mark.asyncio
async def test_delete_if_exists_is_idempotent() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m1", name="gpt-4o-mini", category=ModelCategoryKey.text, provider_id="p1")
        await create_and_refresh(db, provider)
        await create_and_refresh(db, model)

        await delete_if_exists(db, Model, "m1")
        await delete_if_exists(db, Model, "m1")

        deleted = await db.get(Model, "m1")
        assert deleted is None
    await engine.dispose()
