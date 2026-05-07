"""模型配置验证：service 与 API 信封测试。"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.routes import llm as llm_routes
from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, ModelCategoryKey, Provider, ProviderStatus
from app.schemas.llm import ProviderCreate
from app.services.llm import manage as llm_manage
from app.services.llm import model_chat_test
from app.services.llm import model_verify


async def _memory_session() -> tuple[AsyncSession, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_local = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return session_local(), engine


@pytest.mark.asyncio
async def test_verify_model_not_found_raises_404() -> None:
    db, engine = await _memory_session()
    async with db:
        with pytest.raises(HTTPException) as exc:
            await model_verify.verify_model_config(db, model_id="missing")
        assert exc.value.status_code == 404
    await engine.dispose()


@pytest.mark.asyncio
async def test_verify_text_success_mocked_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    db, engine = await _memory_session()
    async with db:
        await llm_manage.create_provider(
            db,
            body=ProviderCreate(
                id="p_openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
            ),
        )
        db.add(
            Model(
                id="m1",
                name="gpt-4o-mini",
                category=ModelCategoryKey.text,
                provider_id="p_openai",
            )
        )
        await db.commit()

        class _FakeLLM:
            async def ainvoke(self, *_a: object, **_kw: object) -> AIMessage:
                return AIMessage(content="pong")

            def bind(self, **_kw: object) -> _FakeLLM:
                return self

        monkeypatch.setattr(
            model_verify,
            "build_chat_model_for_model",
            lambda **kwargs: _FakeLLM(),
        )

        result = await model_verify.verify_model_config(db, model_id="m1")
        assert result.ok is True
        assert result.category == ModelCategoryKey.text
        assert result.detail and result.detail.get("reply_preview") == "pong"
    await engine.dispose()


@pytest.mark.asyncio
async def test_verify_image_openai_list_contains_model(monkeypatch: pytest.MonkeyPatch) -> None:
    db, engine = await _memory_session()
    async with db:
        await llm_manage.create_provider(
            db,
            body=ProviderCreate(
                id="p_openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
            ),
        )
        db.add(
            Model(
                id="mi1",
                name="dall-e-3",
                category=ModelCategoryKey.image,
                provider_id="p_openai",
            )
        )
        await db.commit()

        class _FakeResp:
            status_code = 200
            text = "{}"

            def json(self) -> dict[str, Any]:
                return {"data": [{"id": "dall-e-3"}, {"id": "dall-e-2"}]}

        class _FakeClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            async def __aenter__(self) -> _FakeClient:
                return self

            async def __aexit__(self, *args: object) -> None:
                pass

            async def get(self, *args: object, **kwargs: object) -> _FakeResp:
                return _FakeResp()

        monkeypatch.setattr(model_verify.httpx, "AsyncClient", _FakeClient)

        result = await model_verify.verify_model_config(db, model_id="mi1")
        assert result.ok is True
        assert result.category == ModelCategoryKey.image
    await engine.dispose()


@pytest.mark.asyncio
async def test_verify_image_model_name_missing_in_list(monkeypatch: pytest.MonkeyPatch) -> None:
    db, engine = await _memory_session()
    async with db:
        await llm_manage.create_provider(
            db,
            body=ProviderCreate(
                id="p_openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
            ),
        )
        db.add(
            Model(
                id="mi2",
                name="unknown-model",
                category=ModelCategoryKey.image,
                provider_id="p_openai",
            )
        )
        await db.commit()

        class _FakeResp:
            status_code = 200
            text = "{}"

            def json(self) -> dict[str, Any]:
                return {"data": [{"id": "dall-e-3"}]}

        class _FakeClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            async def __aenter__(self) -> _FakeClient:
                return self

            async def __aexit__(self, *args: object) -> None:
                pass

            async def get(self, *args: object, **kwargs: object) -> _FakeResp:
                return _FakeResp()

        monkeypatch.setattr(model_verify.httpx, "AsyncClient", _FakeClient)

        result = await model_verify.verify_model_config(db, model_id="mi2")
        assert result.ok is False
        assert "未找到" in result.message
    await engine.dispose()


@pytest.mark.asyncio
async def test_chat_test_rejects_non_text_model() -> None:
    db, engine = await _memory_session()
    async with db:
        await llm_manage.create_provider(
            db,
            body=ProviderCreate(
                id="p_openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
            ),
        )
        db.add(
            Model(
                id="m_image",
                name="dall-e-3",
                category=ModelCategoryKey.image,
                provider_id="p_openai",
            )
        )
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await model_chat_test.chat_test_with_model(
                db,
                model_id="m_image",
                user_message="hi",
            )
        assert exc.value.status_code == 400
    await engine.dispose()


@pytest.mark.asyncio
async def test_verify_provider_disabled_returns_fail() -> None:
    db, engine = await _memory_session()
    async with db:
        await llm_manage.create_provider(
            db,
            body=ProviderCreate(
                id="p_openai",
                name="OpenAI",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
                status=ProviderStatus.disabled,
            ),
        )
        db.add(
            Model(
                id="m2",
                name="gpt-4o-mini",
                category=ModelCategoryKey.text,
                provider_id="p_openai",
            )
        )
        await db.commit()

        result = await model_verify.verify_model_config(db, model_id="m2")
        assert result.ok is False
        assert "配置未通过检查" in result.message or "disabled" in result.message.lower()
    await engine.dispose()


def test_verify_llm_model_api_envelope(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.schemas.llm import ModelCategoryKey, ModelVerifyRead

    async def _fake_verify(_db: AsyncSession, *, model_id: str) -> ModelVerifyRead:
        assert model_id == "m_x"
        return ModelVerifyRead(
            ok=True,
            category=ModelCategoryKey.text,
            message="验证通过",
            elapsed_ms=12,
            detail={"model_name": "x"},
        )

    monkeypatch.setattr(llm_routes, "verify_model_config_service", _fake_verify)

    class _MinimalDB:
        async def commit(self) -> None:
            return None

        async def rollback(self) -> None:
            return None

        async def close(self) -> None:
            return None

    async def _override_db() -> AsyncGenerator[_MinimalDB, None]:
        yield _MinimalDB()

    app.dependency_overrides[get_db] = _override_db
    try:
        res = client.post("/api/v1/llm/models/m_x/verify")
        assert res.status_code == 200
        body = res.json()
        assert body.get("code") == 200
        assert body.get("data", {}).get("ok") is True
    finally:
        app.dependency_overrides.pop(get_db, None)
        monkeypatch.undo()
