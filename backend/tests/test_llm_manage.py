from __future__ import annotations

from fastapi import HTTPException
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.contracts.model_catalog import ProviderModelCandidate
from app.models.llm import LogLevel, Model, ModelCategoryKey, ModelSettings, Provider
from app.schemas.llm import ModelCreate, ModelSettingsUpdate, ModelUpdate, ProviderCreate
from app.services.llm.manage import (
    create_model,
    create_provider,
    get_image_generation_options,
    get_or_create_settings,
    list_models_paginated,
    import_provider_models,
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
async def test_create_model_rejects_unsupported_category_for_provider() -> None:
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-bailian",
                name="阿里百炼",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                api_key="k",
            ),
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_model(
                db,
                body=ModelCreate(
                    id="m-video-invalid",
                    name="qwen-vl-video",
                    category=ModelCategoryKey.video,
                    provider_id="p-bailian",
                ),
            )
        assert exc_info.value.status_code == 400
        assert "does not support category=video" in str(exc_info.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_update_model_rejects_switch_to_unsupported_provider_category_combo() -> None:
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
                id="p-bailian",
                name="阿里百炼",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                api_key="k",
            ),
        )
        await create_model(
            db,
            body=ModelCreate(
                id="m-video-ok",
                name="sora",
                category=ModelCategoryKey.video,
                provider_id="p-openai",
            ),
        )

        with pytest.raises(HTTPException) as exc_info:
            await update_model(
                db,
                model_id="m-video-ok",
                body=ModelUpdate(provider_id="p-bailian"),
            )
        assert exc_info.value.status_code == 400
        assert "does not support category=video" in str(exc_info.value.detail)
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
async def test_import_provider_models_creates_and_skips_duplicates() -> None:
    """从供应商目录导入时，同一 Provider、名称、类别的重复模型应被跳过。"""
    db, engine = await _build_session()
    async with db:
        await create_provider(
            db,
            body=ProviderCreate(
                id="p-vidu",
                name="Vidu",
                base_url="https://api.vidu.cn",
                api_key="k",
            ),
        )
        db.add(Model(id="existing", name="viduq2", category=ModelCategoryKey.video, provider_id="p-vidu"))
        await db.commit()

        result = await import_provider_models(
            db,
            provider_id="p-vidu",
            candidates=[
                ProviderModelCandidate(name="viduq2", category=ModelCategoryKey.video),
                ProviderModelCandidate(name="viduq2", category=ModelCategoryKey.image),
            ],
        )

        assert [item.name for item in result.created] == ["viduq2"]
        assert result.created[0].category == ModelCategoryKey.image
        assert [(item.name, item.category) for item in result.skipped] == [
            ("viduq2", ModelCategoryKey.video)
        ]
    await engine.dispose()
