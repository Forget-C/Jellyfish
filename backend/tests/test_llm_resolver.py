from __future__ import annotations

import sys
import types
from typing import Any

import pytest
from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
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
from app.services.llm.text_fallback import FallbackChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult


@pytest.mark.asyncio
async def test_get_default_model_by_category_uses_model_settings() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
        db.add(provider)
        await db.commit()

        by_id = await get_provider_by_id_or_obj(db, "p1")
        by_obj = await get_provider_by_id_or_obj(db, provider)
        assert by_id.id == "p1"
        assert by_obj.id == "p1"

    await engine.dispose()


@pytest.mark.asyncio
async def test_build_chat_model_from_provider_builds_chatopenai_with_model_params(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeChatOpenAI:
        def __init__(self, **kwargs):  # noqa: ANN003, ANN204
            self.kwargs = kwargs

    fake_module = types.ModuleType("langchain_openai")
    fake_module.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_module)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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

        assert isinstance(chat_model, FakeChatOpenAI)
        assert chat_model.kwargs["model"] == "gpt-4o-mini"
        assert chat_model.kwargs["api_key"] == "k"
        assert chat_model.kwargs["base_url"] == "https://api.openai.com/v1"
        assert chat_model.kwargs["temperature"] == 0.2
        assert chat_model.kwargs["max_tokens"] == 256

    await engine.dispose()


@pytest.mark.asyncio
async def test_build_default_text_llm_supports_thinking_toggle(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeChatOpenAI:
        def __init__(self, **kwargs):  # noqa: ANN003, ANN204
            self.kwargs = kwargs

    fake_module = types.ModuleType("langchain_openai")
    fake_module.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_module)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        provider = Provider(id="p1", name="OpenAI", base_url="https://api.openai.com/v1", api_key="k")
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

        assert isinstance(thinking_llm, FakeChatOpenAI)
        assert "extra_body" not in thinking_llm.kwargs
        assert isinstance(nothinking_llm, FakeChatOpenAI)
        assert nothinking_llm.kwargs["extra_body"]["enable_thinking"] is False

    await engine.dispose()


@pytest.mark.asyncio
async def test_build_default_text_llm_wraps_fallback_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeChatOpenAI(BaseChatModel):
        kwargs: dict[str, Any] = {}

        def __init__(self, **kwargs):  # noqa: ANN003, ANN204
            super().__init__()
            self.kwargs = kwargs

        @property
        def _llm_type(self) -> str:  # pragma: no cover
            return "fake-chat-openai"

        def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # type: ignore[override]
            msg = AIMessage(content="ok")
            return ChatResult(generations=[ChatGeneration(message=msg)])

    fake_module = types.ModuleType("langchain_openai")
    fake_module.ChatOpenAI = FakeChatOpenAI
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_module)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_local() as db:
        local_provider = Provider(
            id="p_local",
            name="Ollama",
            base_url="http://localhost:11434/v1",
            api_key="",
        )
        cloud_provider = Provider(
            id="p_cloud",
            name="DeepSeek",
            base_url="https://api.deepseek.com/v1",
            api_key="dk",
        )
        local_model = Model(
            id="m_local",
            name="qwen3.5:9b",
            category=ModelCategoryKey.text,
            provider_id="p_local",
        )
        cloud_model = Model(
            id="m_cloud",
            name="deepseek-chat",
            category=ModelCategoryKey.text,
            provider_id="p_cloud",
        )
        settings = ModelSettings(
            id=1,
            default_text_model_id="m_local",
            fallback_text_model_id="m_cloud",
        )
        db.add_all([local_provider, cloud_provider, local_model, cloud_model, settings])
        await db.commit()

        llm = await build_default_text_llm(db, thinking=True)

        assert isinstance(llm, FallbackChatModel)
        assert llm.primary.kwargs["model"] == "qwen3.5:9b"
        assert llm.primary.kwargs["api_key"] == "ollama"
        assert llm.primary.kwargs["base_url"] == "http://localhost:11434/v1"
        assert llm.fallback is not None
        assert llm.fallback.kwargs["model"] == "deepseek-chat"
        assert llm.fallback.kwargs["api_key"] == "dk"

    await engine.dispose()


def test_resolve_effective_base_url_prefers_category_specific_url() -> None:
    provider = Provider(
        id="p1",
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
