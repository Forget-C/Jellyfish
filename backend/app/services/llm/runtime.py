"""给 Celery worker 使用的同步 LLM runtime。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from sqlalchemy.orm import Session

from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.llm.provider_resolver import resolve_effective_base_url
from app.services.llm.text_fallback import FallbackChatModel


logger = logging.getLogger(__name__)


def _default_model_id(settings_row: ModelSettings | None, category: ModelCategoryKey) -> str | None:
    if settings_row is None:
        return None
    if category == ModelCategoryKey.text:
        return settings_row.default_text_model_id
    if category == ModelCategoryKey.image:
        return settings_row.default_image_model_id
    return settings_row.default_video_model_id


def _require_provider_and_model_sync(
    db: Session,
    *,
    category: ModelCategoryKey,
) -> tuple[Provider, Model]:
    settings_row = db.get(ModelSettings, 1)
    model_id = _default_model_id(settings_row, category)
    if not model_id:
        raise HTTPException(status_code=503, detail=f"No default model configured for category={category.value}")

    model = db.get(Model, model_id)
    if model is None:
        raise HTTPException(status_code=503, detail=f"Configured default model not found: {model_id}")

    provider = db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(status_code=503, detail=f"Provider not found for model_id={model.id}")

    return provider, model


def build_default_text_llm_sync(
    db: Session,
    *,
    thinking: bool,
) -> BaseChatModel:
    """基于默认文本模型构造同步 ChatOpenAI；配置回退模型时返回 FallbackChatModel。"""
    provider, model = _require_provider_and_model_sync(db, category=ModelCategoryKey.text)
    primary = _build_chat_openai_model_sync(provider=provider, model=model, thinking=thinking)
    fallback = _build_fallback_text_model_sync(db=db, thinking=thinking)
    if fallback is None:
        return primary
    return FallbackChatModel(primary=primary, fallback=fallback)


def _build_chat_openai_model_sync(
    *,
    provider: Provider,
    model: Model,
    thinking: bool,
) -> BaseChatModel:
    api_key = _resolve_llm_api_key(provider)
    if not api_key:
        raise HTTPException(status_code=503, detail=f"Provider api_key is empty for provider_id={provider.id}")

    try:
        from langchain_openai import ChatOpenAI
    except ImportError as e:
        raise HTTPException(status_code=503, detail="Install langchain-openai to enable script-processing tasks") from e

    kwargs: dict[str, Any] = dict(model.params or {})
    kwargs["model"] = model.name
    kwargs["api_key"] = api_key
    kwargs.setdefault("temperature", 0)

    base_url = resolve_effective_base_url(provider=provider, category=ModelCategoryKey.text)
    if base_url:
        kwargs.setdefault("base_url", base_url)

    if not thinking:
        extra_body = dict(kwargs.get("extra_body") or {})
        extra_body["enable_thinking"] = False
        kwargs["extra_body"] = extra_body

    return ChatOpenAI(**kwargs)


def _build_fallback_text_model_sync(
    *,
    db: Session,
    thinking: bool,
) -> BaseChatModel | None:
    """按 ModelSettings.fallback_text_model_id 构造同步回退模型；未配置或缺失时返回 None。"""
    settings = db.get(ModelSettings, 1)
    fallback_id = settings.fallback_text_model_id if settings is not None else None
    if not fallback_id:
        return None
    fallback_model = db.get(Model, fallback_id)
    if fallback_model is None or fallback_model.category != ModelCategoryKey.text:
        logger.warning("fallback text model not found or invalid: %s; fallback disabled", fallback_id)
        return None
    fallback_provider = db.get(Provider, fallback_model.provider_id)
    if fallback_provider is None:
        logger.warning("fallback provider missing for model: %s; fallback disabled", fallback_id)
        return None
    return _build_chat_openai_model_sync(provider=fallback_provider, model=fallback_model, thinking=thinking)


def _resolve_llm_api_key(provider: Provider) -> str:
    """返回文本模型调用所需的 API Key；本地 Ollama 允许空 key 并使用占位值。"""
    api_key = (provider.api_key or "").strip()
    if api_key:
        return api_key
    provider_name = (provider.name or "").strip().lower()
    if provider_name == "ollama" or "ollama" in provider_name:
        return "ollama"
    return ""
