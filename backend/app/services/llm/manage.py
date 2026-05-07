"""LLM 管理服务：Provider / Model / ModelSettings 的查询与 CRUD。"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.core.integrations.image_capabilities import (
    DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
    resolve_image_capability,
)
from app.core.integrations.video_capabilities import resolve_default_ratio, resolve_video_capability
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.llm import (
    ImageGenerationOptionsRead,
    ModelCreate,
    ModelRead,
    ModelSettingsUpdate,
    ModelUpdate,
    ProviderCreate,
    ProviderRead,
    ProviderSupportedRead,
    VideoGenerationOptionsRead,
    ProviderUpdate,
)
from app.services.llm.provider_registry import (
    is_provider_category_supported,
    list_registered_providers,
    try_resolve_provider_key_from_name,
)
from app.bootstrap import bootstrap_all_registries
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    flush_and_refresh,
    get_or_404,
    patch_model,
    require_entity,
)


async def list_providers_paginated(
    db: AsyncSession,
    *,
    q: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    allow_fields: set[str],
) -> ApiResponse[PaginatedData[ProviderRead]]:
    """分页查询供应商。"""
    stmt = select(Provider)
    stmt = apply_keyword_filter(stmt, q=q, fields=[Provider.name, Provider.description])
    stmt = apply_order(
        stmt,
        model=Provider,
        order=order,
        is_desc=is_desc,
        allow_fields=allow_fields,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    return paginated_response(
        [ProviderRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


async def create_provider(
    db: AsyncSession,
    *,
    body: ProviderCreate,
) -> Provider:
    """创建供应商。"""
    await ensure_not_exists(
        db,
        Provider,
        body.id,
        detail=entity_already_exists("Provider"),
        status_code=400,
    )
    return await create_and_refresh(
        db,
        Provider(
            id=body.id,
            name=body.name,
            base_url=body.base_url,
            image_base_url=body.image_base_url,
            video_base_url=body.video_base_url,
            api_key=body.api_key,
            api_secret=body.api_secret,
            description=body.description,
            status=body.status,
            created_by=body.created_by,
        ),
    )


async def get_provider(
    db: AsyncSession,
    *,
    provider_id: str,
) -> Provider:
    """获取供应商。"""
    return await get_or_404(db, Provider, provider_id, detail=entity_not_found("Provider"))


async def update_provider(
    db: AsyncSession,
    *,
    provider_id: str,
    body: ProviderUpdate,
) -> Provider:
    """更新供应商。"""
    provider = await get_or_404(db, Provider, provider_id, detail=entity_not_found("Provider"))
    patch_model(provider, body.model_dump(exclude_unset=True))
    return await flush_and_refresh(db, provider)


async def delete_provider(
    db: AsyncSession,
    *,
    provider_id: str,
) -> None:
    """删除供应商。"""
    await delete_if_exists(db, Provider, provider_id)


async def list_models_paginated(
    db: AsyncSession,
    *,
    provider_id: str | None,
    category: ModelCategoryKey | None,
    q: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    allow_fields: set[str],
) -> ApiResponse[PaginatedData[ModelRead]]:
    """分页查询模型。"""
    stmt = select(Model)
    if provider_id is not None:
        stmt = stmt.where(Model.provider_id == provider_id)
    if category is not None:
        stmt = stmt.where(Model.category == category)
    stmt = apply_keyword_filter(stmt, q=q, fields=[Model.name, Model.description])
    stmt = apply_order(
        stmt,
        model=Model,
        order=order,
        is_desc=is_desc,
        allow_fields=allow_fields,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    return paginated_response(
        [ModelRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


async def create_model(
    db: AsyncSession,
    *,
    body: ModelCreate,
) -> Model:
    """创建模型。"""
    await ensure_not_exists(
        db,
        Model,
        body.id,
        detail=entity_already_exists("Model"),
        status_code=400,
    )
    provider = await require_entity(
        db,
        Provider,
        body.provider_id,
        detail=entity_not_found("Provider"),
        status_code=400,
    )
    _ensure_provider_supports_category(provider=provider, category=body.category)
    return await create_and_refresh(
        db,
        Model(
            id=body.id,
            name=body.name,
            category=body.category,
            provider_id=body.provider_id,
            params=body.params,
            description=body.description,
            created_by=body.created_by,
        ),
    )


async def get_model(
    db: AsyncSession,
    *,
    model_id: str,
) -> Model:
    """获取模型。"""
    return await get_or_404(db, Model, model_id, detail=entity_not_found("Model"))


async def update_model(
    db: AsyncSession,
    *,
    model_id: str,
    body: ModelUpdate,
) -> Model:
    """更新模型。"""
    model = await get_or_404(db, Model, model_id, detail=entity_not_found("Model"))
    update_data = body.model_dump(exclude_unset=True)
    if "provider_id" in update_data:
        await require_entity(
            db,
            Provider,
            update_data["provider_id"],
            detail=entity_not_found("Provider"),
            status_code=400,
        )
    target_category = update_data.get("category", model.category)
    target_provider_id = update_data.get("provider_id", model.provider_id)
    target_provider = await require_entity(
        db,
        Provider,
        target_provider_id,
        detail=entity_not_found("Provider"),
        status_code=400,
    )
    _ensure_provider_supports_category(provider=target_provider, category=target_category)
    patch_model(model, update_data)
    return await flush_and_refresh(db, model)


async def delete_model(
    db: AsyncSession,
    *,
    model_id: str,
) -> None:
    """删除模型。"""
    await delete_if_exists(db, Model, model_id)


async def get_or_create_settings(
    db: AsyncSession,
) -> ModelSettings:
    """获取或创建单例设置。"""
    settings = await db.get(ModelSettings, 1)
    if settings is None:
        settings = await create_and_refresh(db, ModelSettings(id=1))
    return settings


async def get_model_settings(
    db: AsyncSession,
) -> ModelSettings:
    """获取模型全局设置。"""
    return await get_or_create_settings(db)


async def update_model_settings(
    db: AsyncSession,
    *,
    body: ModelSettingsUpdate,
) -> ModelSettings:
    """更新模型全局设置。"""
    settings = await get_or_create_settings(db)
    patch_model(settings, body.model_dump())
    return await flush_and_refresh(db, settings)


async def get_video_generation_options(
    db: AsyncSession,
) -> VideoGenerationOptionsRead:
    """返回当前默认视频模型的动态 ratio 枚举。"""
    settings = await get_or_create_settings(db)
    model_id = settings.default_video_model_id
    if not model_id:
        return VideoGenerationOptionsRead(
            provider="",
            model_id="",
            model_name="",
            allowed_ratios=["16:9"],
            default_ratio="16:9",
        )

    model = await get_or_404(db, Model, model_id, detail=entity_not_found("Model"))
    provider = await get_or_404(db, Provider, model.provider_id, detail=entity_not_found("Provider"))
    provider_key = try_resolve_provider_key_from_name(provider.name)
    if provider_key is None:
        return VideoGenerationOptionsRead(
            provider=provider.name,
            model_id=model.id,
            model_name=model.name,
            allowed_ratios=["16:9"],
            default_ratio="16:9",
        )
    capability = resolve_video_capability(provider=provider_key, model=model.name)
    allowed_ratios = sorted(capability.allowed_ratios or {"16:9"})
    default_ratio = resolve_default_ratio(provider=provider_key, model=model.name) or allowed_ratios[0]
    if default_ratio not in allowed_ratios:
        allowed_ratios = sorted({*allowed_ratios, default_ratio})

    return VideoGenerationOptionsRead(
        provider=provider_key,
        model_id=model.id,
        model_name=model.name,
        allowed_ratios=allowed_ratios,
        default_ratio=default_ratio,
    )


async def get_image_generation_options(
    db: AsyncSession,
) -> ImageGenerationOptionsRead:
    """返回当前默认图片模型对应的关键帧比例/像素规格选项。"""
    settings = await get_or_create_settings(db)
    model_id = settings.default_image_model_id
    if not model_id:
        return ImageGenerationOptionsRead(
            provider="",
            model_id="",
            model_name="",
            supported_ratios=sorted(DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP.keys()),
            default_resolution_profile="standard",
            ratio_size_profiles=DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
        )

    model = await get_or_404(db, Model, model_id, detail=entity_not_found("Model"))
    provider = await get_or_404(db, Provider, model.provider_id, detail=entity_not_found("Provider"))
    provider_key = try_resolve_provider_key_from_name(provider.name)
    if provider_key is None:
        return ImageGenerationOptionsRead(
            provider=provider.name,
            model_id=model.id,
            model_name=model.name,
            supported_ratios=sorted(DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP.keys()),
            default_resolution_profile="standard",
            ratio_size_profiles=DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
        )
    capability = resolve_image_capability(provider=provider_key, model=model.name)
    ratio_size_profiles = capability.ratio_size_profiles or DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP
    supported_ratios = sorted(capability.supported_ratios or ratio_size_profiles.keys())

    return ImageGenerationOptionsRead(
        provider=provider_key,
        model_id=model.id,
        model_name=model.name,
        supported_ratios=supported_ratios,
        default_resolution_profile=capability.default_resolution_profile or "standard",
        ratio_size_profiles=ratio_size_profiles,
    )


def list_supported_providers(*, category: ModelCategoryKey | None) -> list[ProviderSupportedRead]:
    # 防御性初始化：保证在非应用生命周期上下文（如单测）下也可返回内置清单。
    bootstrap_all_registries()
    specs = list_registered_providers(category=category)
    return [
        ProviderSupportedRead(
            key=spec.key,
            display_name=spec.display_name,
            aliases=list(spec.aliases),
            supported_categories=list(spec.supported_categories),
            default_base_url=spec.default_base_url,
            requires_api_key=spec.requires_api_key,
            requires_api_secret=spec.requires_api_secret,
            is_experimental=spec.is_experimental,
        )
        for spec in specs
    ]


def _ensure_provider_supports_category(*, provider: Provider, category: ModelCategoryKey | str) -> None:
    bootstrap_all_registries()
    normalized_category = (
        category
        if isinstance(category, ModelCategoryKey)
        else ModelCategoryKey((str(category or "")).strip().lower())
    )
    provider_key = try_resolve_provider_key_from_name(provider.name)
    if provider_key is None:
        return
    if not is_provider_category_supported(provider_key, normalized_category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Provider {provider.name!r} does not support category={normalized_category.value}",
        )
