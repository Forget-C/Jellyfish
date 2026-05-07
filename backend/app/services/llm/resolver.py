from __future__ import annotations

from typing import Any, cast

from fastapi import HTTPException, status
from langchain_core.language_models.chat_models import BaseChatModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.common import entity_not_found
from app.services.llm.provider_resolver import resolve_effective_base_url


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


def build_chat_model_for_model(
    *,
    provider: Provider,
    model: Model,
    thinking: bool = False,
) -> BaseChatModel:
    """按已解析的 Model + Provider 构造 ChatOpenAI（用于脚本外显式模型，如配置验证）。

    与 ``build_chat_model_from_provider`` 不同：后者会选取该供应商下任意一条最新文本模型，
    本函数严格使用传入的 ``model``（须为 ``text`` 类别）。
    """
    if model.category != ModelCategoryKey.text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Not a text model: model_id={model.id} category={model.category.value}",
        )
    return _build_chat_openai_model(
        provider=provider,
        model=model,
        thinking=thinking,
        import_error_detail="Install langchain-openai to verify text model configuration",
    )


async def build_chat_model_from_provider(
    db: AsyncSession,
    provider_or_id: Provider | str,
) -> BaseChatModel:
    """根据 Provider 配置构造文本对话模型（ChatOpenAI）。"""
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

    return _build_chat_openai_model(
        provider=provider,
        model=model,
        thinking=True,
        import_error_detail="Install langchain-openai to build chat model from provider config",
    )


async def build_default_text_llm(
    db: AsyncSession,
    *,
    thinking: bool,
) -> BaseChatModel:
    """基于默认文本模型构造 ChatOpenAI。"""
    model = await get_default_model_by_category(db, ModelCategoryKey.text)
    provider = await get_provider_by_model_or_id(db, model)
    return _build_chat_openai_model(
        provider=provider,
        model=model,
        thinking=thinking,
        import_error_detail="Install langchain-openai (e.g. uv sync --group dev) to use film extraction endpoints",
    )


def _build_chat_openai_model(
    *,
    provider: Provider,
    model: Model,
    thinking: bool,
    import_error_detail: str,
) -> BaseChatModel:
    api_key = (provider.api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider api_key is empty for provider_id={provider.id}",
        )

    try:
        from langchain_openai import ChatOpenAI
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=import_error_detail,
        ) from e

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
