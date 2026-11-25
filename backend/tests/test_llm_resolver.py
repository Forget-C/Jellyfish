from __future__ import annotations

import asyncio
import json

import httpx

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.llm import (
    build_default_text_llm,
    build_chat_model_from_provider,
    get_default_model_by_category,
    get_model_by_category,
    get_provider_by_id_or_obj,
    get_provider_by_model_or_id,
)
from app.services.llm.provider_resolver import resolve_effective_base_url


@pytest.mark.asyncio
async def test_get_default_model_by_category_uses_model_settings() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m_text", name="gpt-4o-mini", category=ModelCategoryKey.text, provider_id="p1")
        settings = ModelSettings(id=1, default_text_model_id="m_text")
        db.add_all([provider, model, settings])
        await db.commit()

        resolved = await get_default_model_by_category(db, ModelCategoryKey.text)
        assert resolved.id == "m_text"

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_default_model_by_category_requires_model_settings_entry() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(
            id="m_text",
            name="gpt-4o-mini",
            category=ModelCategoryKey.text,
            provider_id="p1",
        )
        db.add_all([provider, model])
        await db.commit()

        with pytest.raises(HTTPException) as exc_info:
            await get_default_model_by_category(db, ModelCategoryKey.text)
        assert "No default model configured for category=text" in str(exc_info.value)

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_provider_by_model_or_id_supports_both_inputs() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m_text", name="gpt-4o-mini", category=ModelCategoryKey.text, provider_id="p1")
        db.add_all([provider, model])
        await db.commit()

        by_id = await get_provider_by_model_or_id(db, "m_text")
        by_model = await get_provider_by_model_or_id(db, model)
        assert by_id.id == "p1"
        assert by_model.id == "p1"

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_model_by_category_supports_explicit_id_without_default_fallback() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(id="m_img", name="gpt-image-1", category=ModelCategoryKey.image, provider_id="p1")
        db.add_all([provider, model])
        await db.commit()

        resolved = await get_model_by_category(
            db,
            ModelCategoryKey.image,
            model_or_id="m_img",
            allow_default_fallback=False,
        )
        assert resolved.id == "m_img"

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_provider_by_id_or_obj_supports_both_inputs() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        db.add(provider)
        await db.commit()

        by_id = await get_provider_by_id_or_obj(db, "p1")
        by_obj = await get_provider_by_id_or_obj(db, provider)
        assert by_id.id == "p1"
        assert by_obj.id == "p1"

    await engine.dispose()


@pytest.fixture
def chat_requests(monkeypatch: pytest.MonkeyPatch):
    observed = []

    def reply(request: httpx.Request) -> httpx.Response:
        observed.append((str(request.url), request.headers["authorization"], json.loads(request.content)))
        return httpx.Response(200, json={
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "生成结果"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        })

    transport = httpx.MockTransport(reply)
    original_init = httpx.AsyncClient.__init__

    def init_client(self, *args, **kwargs):
        kwargs.setdefault("transport", transport)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", init_client)
    return observed


@pytest.mark.asyncio
async def test_build_chat_model_from_provider_sends_bound_config(chat_requests) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(
            id="m_text",
            name="gpt-4o-mini",
            category=ModelCategoryKey.text,
            provider_id="p1",
            params={"temperature": 0.2, "max_tokens": 256},
        )
        db.add_all([provider, model])
        await db.commit()

        chat_model = await build_chat_model_from_provider(db, "p1")

        result = await chat_model.ainvoke("测试")
        assert result.content == "生成结果"
        assert result.usage_metadata["total_tokens"] == 5
        [(url, auth, payload)] = chat_requests
        assert (url, auth) == ("https://api.openai.com/v1/chat/completions", "Bearer k")
        assert payload["model"] == "gpt-4o-mini"
        assert payload["temperature"] == 0.2
        assert payload["max_tokens"] == 256

    await engine.dispose()


@pytest.mark.asyncio
async def test_build_default_text_llm_supports_thinking_toggle(chat_requests) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", provider_key='openai', name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        model = Model(
            id="m_text",
            name="gpt-4o-mini",
            category=ModelCategoryKey.text,
            provider_id="p1",
            params={"temperature": 0.2},
        )
        settings = ModelSettings(id=1, default_text_model_id="m_text")
        db.add_all([provider, model, settings])
        await db.commit()

        thinking_llm = await build_default_text_llm(db, thinking=True)
        nothinking_llm = await build_default_text_llm(db, thinking=False)

        assert (await thinking_llm.ainvoke("测试")).content == "生成结果"
        assert (await asyncio.to_thread(nothinking_llm.invoke, "测试")).content == "生成结果"
        assert "enable_thinking" not in chat_requests[0][2]
        assert chat_requests[1][2]["enable_thinking"] is False

    await engine.dispose()


def test_resolve_effective_base_url_prefers_category_specific_url() -> None:
    provider = Provider(
        id="p1",
        provider_key='openai',
        name="OpenAI",
        base_url="https://gateway.example/v1",
        image_base_url="https://image-gateway.example/v1",
        video_base_url="https://video-gateway.example/v1",
        api_key="k",
    )
    assert (
        resolve_effective_base_url(provider=provider, category=ModelCategoryKey.text)
        == "https://gateway.example/v1"
    )
    assert (
        resolve_effective_base_url(provider=provider, category=ModelCategoryKey.image)
        == "https://image-gateway.example/v1"
    )
    assert (
        resolve_effective_base_url(provider=provider, category=ModelCategoryKey.video)
        == "https://video-gateway.example/v1"
    )

