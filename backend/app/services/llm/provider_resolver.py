from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import Model, ModelCategoryKey, Provider, ProviderStatus
from app.services.common import entity_not_found
from app.bootstrap import bootstrap_all_registries
from app.services.llm.provider_registry import (
    get_provider_spec,
    is_provider_category_supported,
    try_resolve_provider_key_from_name,
)


@dataclass(frozen=True, slots=True)
class ResolvedProviderConfig:
    provider_key: str
    api_key: str
    base_url: str | None


def _status_value(value: ProviderStatus | str | None) -> str:
    if isinstance(value, ProviderStatus):
        return value.value
    return (str(value or "")).strip().lower()


def _validate_provider_status(provider: Provider) -> None:
    if _status_value(provider.status) == ProviderStatus.disabled.value:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider is disabled: provider_id={provider.id}",
        )


async def resolve_provider_config(
    db: AsyncSession,
    *,
    provider_id: str,
    category: ModelCategoryKey,
) -> ResolvedProviderConfig:
    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{entity_not_found('Provider')} for provider_id={provider_id}",
        )
    return resolve_provider_config_from_provider(provider=provider, category=category)


def resolve_provider_config_from_provider(
    *,
    provider: Provider,
    category: ModelCategoryKey,
) -> ResolvedProviderConfig:
    bootstrap_all_registries()
    _validate_provider_status(provider)
    provider_key = try_resolve_provider_key_from_name(provider.name)
    if provider_key is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Custom provider has no registered task adapter: provider_id={provider.id}",
        )
    if not is_provider_category_supported(provider_key, category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Provider {provider.name!r} does not support category={category.value}",
        )

    spec = get_provider_spec(provider_key)
    api_key = (provider.api_key or "").strip()
    if spec.requires_api_key and not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider api_key is empty for provider_id={provider.id}",
        )

    base_url = resolve_effective_base_url(
        provider=provider,
        provider_key=provider_key,
        category=category,
    )
    return ResolvedProviderConfig(
        provider_key=provider_key,
        api_key=api_key,
        base_url=base_url,
    )


def resolve_effective_base_url(
    *,
    provider: Provider,
    category: ModelCategoryKey,
    provider_key: str | None = None,
) -> str | None:
    """按类别解析 Provider 实际 base_url；自定义供应商没有内置默认值。"""
    bootstrap_all_registries()
    key = provider_key or try_resolve_provider_key_from_name(provider.name)
    spec = get_provider_spec(key) if key else None
    default_base_url = spec.default_base_url if spec else None
    common_base = (provider.base_url or "").strip()
    image_base = (provider.image_base_url or "").strip()
    video_base = (provider.video_base_url or "").strip()
    if category == ModelCategoryKey.image:
        return image_base or common_base or default_base_url
    if category == ModelCategoryKey.video:
        return video_base or common_base or default_base_url
    # text 仍使用通用 base_url；保留内置默认值兜底。
    return common_base or default_base_url


async def resolve_provider_config_by_model(
    db: AsyncSession,
    *,
    model: Model,
) -> ResolvedProviderConfig:
    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider not found for model.provider_id={model.provider_id}",
        )
    return resolve_provider_config_from_provider(provider=provider, category=model.category)
