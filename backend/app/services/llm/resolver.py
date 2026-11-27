from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

import httpx
from fastapi import HTTPException, status
from langchain_core.language_models.chat_models import BaseChatModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.model_provider import ModelProviderConfig, ModelProviderConfigurationError, TextModelProvider
from app.core.contracts.model_capabilities import ModelCapabilityProfile
from app.core.integrations.langchain_chat import build_langchain_chat
from app.core.integrations.model_provider_registry import bind_text_provider
from app.core.integrations.model_capabilities import describe_operation
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.common import entity_not_found
from app.services.llm.provider_resolver import resolve_provider_config_from_provider


def _settings_model_id(settings_row: ModelSettings | None, category: ModelCategoryKey) -> str | None:
    if settings_row is None:
        return None
    if category == ModelCategoryKey.text:
        return settings_row.default_text_model_id
    if category == ModelCategoryKey.image:
        return settings_row.default_image_model_id
    return settings_row.default_video_model_id


async def get_provider_by_id_or_obj(db: AsyncSession, provider_or_id: Provider | str) -> Provider:
    """通过 Provider 实体或 provider_id 获取 Provider。"""
    return await _resolve_provider(db, provider_or_id)


async def get_model_by_category(
    db: AsyncSession,
    category: ModelCategoryKey,
    *,
    model_or_id: Model | str | None = None,
    allow_default_fallback: bool = True,
) -> Model:
    """按类别解析模型，可传入显式模型（或 id），也可从默认设置解析。"""
    if model_or_id is not None:
        model = await _resolve_model(db, model_or_id)
        if model.category != category:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Configured model category mismatch: {model.id} (category={model.category})",
            )
        return model

    settings_row = await db.get(ModelSettings, 1)
    settings_model_id = _settings_model_id(settings_row, category)
    if settings_model_id:
        try:
            return await get_model_by_category(db, category, model_or_id=settings_model_id)
        except HTTPException as e:
            if e.status_code == status.HTTP_404_NOT_FOUND:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Configured default model not found: {settings_model_id}",
                ) from e
            raise

    _ = allow_default_fallback  # 保留参数签名兼容，默认模型来源统一为 ModelSettings。
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"No default model configured for category={category.value}",
    )


async def get_default_model_by_category(db: AsyncSession, category: ModelCategoryKey) -> Model:
    """按类别解析默认模型，仅从单例 ModelSettings 读取。"""
    return await get_model_by_category(db, category, allow_default_fallback=True)


async def _resolve_model(db: AsyncSession, model_or_id: Model | str) -> Model:
    if not isinstance(model_or_id, str):
        return model_or_id
    model = await db.get(Model, model_or_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Model"))
    return model if isinstance(model, Model) else cast(Model, cast(Any, model))


async def _resolve_provider(db: AsyncSession, provider_or_id: Provider | str) -> Provider:
    if not isinstance(provider_or_id, str):
        return provider_or_id
    provider = await db.get(Provider, provider_or_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Provider"))
    return provider if isinstance(provider, Provider) else cast(Provider, cast(Any, provider))


async def get_provider_by_model_or_id(db: AsyncSession, model_or_id: Model | str) -> Provider:
    """通过 Model 实体或 model_id 获取 Provider。"""
    model = await _resolve_model(db, model_or_id)
    try:
        provider = await get_provider_by_id_or_obj(db, model.provider_id)
    except HTTPException as e:
        if e.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Provider not found for model_id={model.id}",
            ) from e
        raise
    return provider


async def build_chat_model_from_provider(
    db: AsyncSession,
    provider_or_id: Provider | str,
) -> BaseChatModel:
    """根据 Provider 配置构造文本对话适配器。"""
    provider = await _resolve_provider(db, provider_or_id)

    stmt = (
        select(Model)
        .where(Model.provider_id == provider.id, Model.category == ModelCategoryKey.text)
        .order_by(Model.updated_at.desc())
        .limit(1)
    )
    model = (await db.execute(stmt)).scalars().first()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No text model configured for provider_id={provider.id}",
        )

    return build_provider_agent_model(provider=provider, model=model, thinking=True)


async def build_default_text_llm(
    db: AsyncSession,
    *,
    thinking: bool,
) -> BaseChatModel:
    """基于默认文本模型构造 LangChain 适配器。"""
    model = await get_default_model_by_category(db, ModelCategoryKey.text)
    provider = await get_provider_by_model_or_id(db, model)
    return build_provider_agent_model(provider=provider, model=model, thinking=thinking)


async def build_text_chat_model(
    db: AsyncSession,
    *,
    model_id: str,
    thinking: bool = False,
    configure: Callable[[dict[str, Any]], None] | None = None,
) -> BaseChatModel:
    """为需要 LangChain 的调用方绑定显式选择的文本模型。"""
    model = await get_model_by_category(db, ModelCategoryKey.text, model_or_id=model_id)
    provider = await get_provider_by_model_or_id(db, model)
    return build_provider_agent_model(provider=provider, model=model, thinking=thinking, configure=configure)


async def build_laboratory_chat(
    db: AsyncSession,
    *,
    model_id: str,
    streaming: bool = False,
) -> TextModelProvider:
    """为实验室绑定文本操作，并保留显式选择的 Responses API。"""
    model = await get_model_by_category(db, ModelCategoryKey.text, model_or_id=model_id)
    provider = await get_provider_by_model_or_id(db, model)
    provider_key, params = _chat_config(provider, model, thinking=False)
    profile = ModelCapabilityProfile.model_validate(model.capability_profile or {})
    effective = describe_operation(provider_key, model.name, profile, "chat").features
    if streaming:
        # 未声明流式的旧连接仍可使用实验室 SSE。
        if not effective.native_streaming or not (effective.text_inputs and effective.text_outputs):
            raise HTTPException(422, "Model does not support streaming text")
    elif not effective.non_streaming:
        raise HTTPException(422, "Model does not support non-streaming text")
    timeout = params.get("timeout", params.get("request_timeout", 30.0))
    try:
        return bind_text_provider(
            ModelProviderConfig(provider_key, params["api_key"], params.get("base_url")),
            model.name, params, client_factory=lambda: httpx.AsyncClient(timeout=timeout),
        )
    except ModelProviderConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def build_provider_agent_model(
    *,
    provider: Provider,
    model: Model,
    thinking: bool,
    configure: Callable[[dict[str, Any]], None] | None = None,
) -> BaseChatModel:
    """向 Agent 提供与选定供应商和模型绑定的 LangChain 入口。"""
    provider_key, params = _chat_config(provider, model, thinking=thinking)
    if configure:
        configure(params)
    capability = describe_operation(
        provider_key, model.name, ModelCapabilityProfile.model_validate(model.capability_profile or {}), operation="chat",
    ).features
    try:
        return build_langchain_chat(provider_key=provider_key, tools_available=capability.tool_results, **params)
    except ModelProviderConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _chat_config(provider: Provider, model: Model, *, thinking: bool) -> tuple[str, dict[str, Any]]:
    config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
    params = dict(model.params or {})
    params.update(model=model.name, api_key=config.api_key, base_url=config.base_url)
    params.setdefault("temperature", 0)
    if not thinking and not params.get("use_responses_api"):
        params["extra_body"] = {**(params.get("extra_body") or {}), "enable_thinking": False}
    return config.provider_key, params
