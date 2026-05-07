from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import LogLevel, Model, ModelCategoryKey, ModelSettings, Provider
from app.schemas.llm import ModelCreate, ModelSettingsUpdate, ModelUpdate, ProviderCreate
from app.services.llm.manage import (
    create_model,
    create_provider,
    get_image_generation_options,
    get_video_generation_options,
    get_or_create_settings,
    list_models_paginated,
    update_model,
    update_model_settings,
)


async def _build_session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


@pytest.mark.asyncio
async def test_create_model_persists_with_non_default_flag() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p1",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="k",
            ),
        )
        created = await create_model(
            db,
            body=ModelCreate(
                id="m1",
                name="gpt-4o-mini",
                category=ModelCategoryKey.text,
                provider_id="p1",
            ),
        )
        assert created.id == "m1"
    await engine.dispose()


@pytest.mark.asyncio
async def test_update_model_allows_regular_field_updates() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        db.add(provider)
        db.add(
            Model(
                id="m_text",
                name="gpt-4o-mini",
                category=ModelCategoryKey.text,
                provider_id="p1",
            )
        )
        await db.commit()

        updated = await update_model(
            db,
            model_id="m_text",
            body=ModelUpdate(description="updated"),
        )
        assert updated.description == "updated"
    await engine.dispose()


@pytest.mark.asyncio
async def test_get_or_create_settings_behaves_like_singleton() -> None:
    db, engine = await _build_session()
    async with db:
        first = await get_or_create_settings(db)
        second = await get_or_create_settings(db)

        rows = (await db.execute(select(ModelSettings))).scalars().all()

        assert first.id == 1
        assert second.id == 1
        assert len(rows) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_update_model_settings_persists_latest_values() -> None:
    db, engine = await _build_session()
    async with db:
        updated = await update_model_settings(
            db,
            body=ModelSettingsUpdate(api_timeout=45, log_level=LogLevel.debug),
        )

        stored = await db.get(ModelSettings, 1)
        assert updated.id == 1
        assert updated.api_timeout == 45
        assert updated.log_level == LogLevel.debug
        assert stored is not None and stored.api_timeout == 45
    await engine.dispose()


@pytest.mark.asyncio
async def test_list_models_paginated_returns_filtered_items() -> None:
    db, engine = await _build_session()
    async with db:
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        db.add(provider)
        db.add_all(
            [
                Model(id="m1", name="gpt-4o-mini", category=ModelCategoryKey.text, provider_id="p1"),
                Model(id="m2", name="seedream", category=ModelCategoryKey.image, provider_id="p1"),
            ]
        )
        await db.commit()

        resp = await list_models_paginated(
            db,
            provider_id="p1",
            category=ModelCategoryKey.image,
            q="seed",
            order="created_at",
            is_desc=False,
            page=1,
            page_size=10,
            allow_fields={"created_at", "name"},
        )

        assert resp.data is not None
        assert resp.data.pagination.total == 1
        assert [item.id for item in resp.data.items] == ["m2"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_model_allows_volcengine_text_category() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-volc",
                name="火山引擎",
                base_url="https://ark.cn-beijing.volces.com/api/v3",
                api_key="k",
            ),
        )

        created = await create_model(
            db,
            body=ModelCreate(
                id="m-text-valid",
                name="doubao-text",
                category=ModelCategoryKey.text,
                provider_id="p-volc",
            ),
        )

        assert created.provider_id == "p-volc"
        assert created.category == ModelCategoryKey.text
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_model_allows_custom_provider_category_binding() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-custom",
                name="自定义网关",
                base_url="https://gateway.example/v1",
                api_key="k",
            ),
        )

        created = await create_model(
            db,
            body=ModelCreate(
                id="m-custom-video",
                name="custom-video-model",
                category=ModelCategoryKey.video,
                provider_id="p-custom",
            ),
        )

        assert created.provider_id == "p-custom"
        assert created.category == ModelCategoryKey.video
    await engine.dispose()


@pytest.mark.asyncio
async def test_update_model_allows_switch_to_volcengine_for_text_model() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="k",
            ),
        )
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-volc",
                name="火山引擎",
                base_url="https://ark.cn-beijing.volces.com/api/v3",
                api_key="k",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-text-ok",
                name="gpt-4",
                category=ModelCategoryKey.text,
                provider_id="p-openai",
            ),
        )

        updated = await update_model(
            db,
            model_id="m-text-ok",
            body=ModelUpdate(provider_id="p-volc"),
        )
        assert updated.provider_id == "p-volc"
        assert updated.category == ModelCategoryKey.text
    await engine.dispose()


@pytest.mark.asyncio
async def test_update_model_allows_switch_to_custom_provider() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="k",
            ),
        )
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-custom",
                name="自定义网关",
                base_url="https://gateway.example/v1",
                api_key="k",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-video",
                name="sora",
                category=ModelCategoryKey.video,
                provider_id="p-openai",
            ),
        )

        updated = await update_model(
            db,
            model_id="m-video",
            body=ModelUpdate(provider_id="p-custom"),
        )

        assert updated.provider_id == "p-custom"
    await engine.dispose()


@pytest.mark.asyncio
async def test_get_image_generation_options_uses_default_image_model_capability() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-volc",
                name="火山引擎",
                base_url="https://ark.cn-beijing.volces.com/api/v3",
                api_key="k",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-image-default",
                name="seedream-4.0",
                category=ModelCategoryKey.image,
                provider_id="p-volc",
            ),
        )
        await update_model_settings(
            db,
            body=ModelSettingsUpdate(default_image_model_id="m-image-default"),
        )

        options = await get_image_generation_options(db)

        assert options.provider == "volcengine"
        assert options.model_id == "m-image-default"
        assert options.default_resolution_profile == "standard"
        assert options.ratio_size_profiles["9:16"]["standard"] == "1600x2848"
        assert options.ratio_size_profiles["21:9"]["high"] == "4704x2016"
    await engine.dispose()


@pytest.mark.asyncio
async def test_generation_options_fall_back_for_custom_default_models() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-custom",
                name="自定义网关",
                base_url="https://gateway.example/v1",
                api_key="k",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-custom-image",
                name="custom-image",
                category=ModelCategoryKey.image,
                provider_id="p-custom",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-custom-video",
                name="custom-video",
                category=ModelCategoryKey.video,
                provider_id="p-custom",
            ),
        )
        await update_model_settings(
            db,
            body=ModelSettingsUpdate(
                default_image_model_id="m-custom-image",
                default_video_model_id="m-custom-video",
            ),
        )

        image_options = await get_image_generation_options(db)
        video_options = await get_video_generation_options(db)

        assert image_options.provider == "自定义网关"
        assert image_options.default_resolution_profile == "standard"
        assert image_options.ratio_size_profiles["16:9"]["standard"] == "1792x1024"
        assert video_options.provider == "自定义网关"
        assert video_options.allowed_ratios == ["16:9"]
        assert video_options.default_ratio == "16:9"
    await engine.dispose()
