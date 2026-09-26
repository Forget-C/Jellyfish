"""给 Celery worker 使用的同步 LLM runtime。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from sqlalchemy.orm import Session

from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.llm.provider_resolver import resolve_effective_base_url
from app.services import paid_outlet_guard


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
    """worker 侧构造默认文本大模型；构造即代表即将真实调用，统一过 DRY_RUN 守卫。"""
    paid_outlet_guard.require_outlet(
        "worker 构造默认文本大模型（即将真实调用）",
        outlet=paid_outlet_guard.OUTLET_LLM,
    )
    provider, model = _require_provider_and_model_sync(db, category=ModelCategoryKey.text)

    api_key = (provider.api_key or "").strip()
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
