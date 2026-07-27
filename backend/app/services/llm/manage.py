"""LLM 管理服务：Provider / Model / ModelSettings 的查询与 CRUD。"""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.models.llm import Model, ModelCategoryKey, ModelConfigRevision, ModelSettings, Provider
from app.core.integrations.image_capabilities import (
    DEFAULT_VIDEO_REFERENCE_RATIO_SIZE_MAP,
    resolve_image_capability,
)
from app.core.integrations.video_capabilities import resolve_default_ratio, resolve_video_capability
from app.core.integrations.model_catalog import discover_provider_models
from app.core.contracts.model_catalog import ProviderModelCandidate
from app.core.contracts.provider import ProviderConfig
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.llm import (
    ImageGenerationOptionsRead,
    ModelCreate,
    ModelRead,
    ModelSettingsUpdate,
    ModelUpdate,
    ProviderCreate,
    ProviderRead,
    ProviderModelCatalogRead,
    ProviderModelImportResult,
    ProviderSupportedRead,
    VideoGenerationOptionsRead,
    ProviderUpdate,
)
from app.services.llm.provider_registry import (
    get_provider_spec,
    is_provider_category_supported,
    list_registered_providers,
    resolve_provider_key_from_name,
)
from app.bootstrap import bootstrap_all_registries
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
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


async def _create_model_revision(
    db: AsyncSession,
    *,
    model: Model,
    provider: Provider,
) -> ModelConfigRevision:
    """冻结模型及 Provider 的可执行配置，并将模型指向新增 revision。

    凭据只保留稳定引用，执行器随后通过该引用读取当前值；这样任务快照不会
    包含 API Key 或 API Secret。
    """
    latest_version = (
        await db.execute(
            select(ModelConfigRevision.version_id)
            .where(ModelConfigRevision.model_id == model.id)
            .order_by(ModelConfigRevision.version_id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    provider_key = resolve_provider_key_from_name(provider.name)
    revision = ModelConfigRevision(
        id=uuid4().hex,
        model_id=model.id,
        version_id=(latest_version or 0) + 1,
        model_name=model.name,
        category=model.category,
        model_params=dict(model.params or {}),
        provider_key=provider_key,
        endpoint_config={
            "base_url": provider.base_url,
            "image_base_url": provider.image_base_url,
            "video_base_url": provider.video_base_url,
        },
        capability_snapshot={},
        credential_ref=f"provider:{provider.id}",
    )
    db.add(revision)
    await db.flush()
    model.current_revision_id = revision.id
    await db.flush()
    return revision


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
    await db.flush()
    models = (await db.execute(select(Model).where(Model.provider_id == provider.id))).scalars().all()
    for model in models:
        await _create_model_revision(db, model=model, provider=provider)
    return await flush_and_refresh(db, provider)


async def delete_provider(
    db: AsyncSession,
    *,
    provider_id: str,
) -> None:
    """删除供应商。"""
    await delete_if_exists(db, Provider, provider_id)


async def get_provider_model_catalog(
    db: AsyncSession,
    *,
    provider_id: str,
) -> ProviderModelCatalogRead:
    """刷新指定 Provider 的可导入模型目录，密钥仅用于后端出站请求。"""
    provider = await get_or_404(db, Provider, provider_id, detail=entity_not_found("Provider"))
    bootstrap_all_registries()
    provider_key = resolve_provider_key_from_name(provider.name)
    spec = get_provider_spec(provider_key)
    # 使用一个已支持类别触发统一的状态和密钥校验；目录请求始终走通用 Base URL。
    resolved = resolve_provider_config_from_provider(
        provider=provider,
        category=spec.supported_categories[0],
    )
    catalog = await discover_provider_models(
        cfg=ProviderConfig(
            provider=resolved.provider_key,  # type: ignore[arg-type]
            api_key=resolved.api_key,
            base_url=(provider.base_url or spec.default_base_url or "").strip() or None,
        )
    )
    return ProviderModelCatalogRead(
        provider_id=provider.id,
        provider_key=catalog.provider_key,
        source=catalog.source,
        models=catalog.models,
    )


async def import_provider_models(
    db: AsyncSession,
    *,
    provider_id: str,
    candidates: list[ProviderModelCandidate],
) -> ProviderModelImportResult:
    """将用户从目录中选中的模型写入数据库；同 Provider、名称、类别的重复项跳过。"""
    provider = await get_or_404(db, Provider, provider_id, detail=entity_not_found("Provider"))
    existing_rows = (
        await db.execute(select(Model.name, Model.category).where(Model.provider_id == provider.id))
    ).all()
    existing = {(str(name), category.value if isinstance(category, ModelCategoryKey) else str(category)) for name, category in existing_rows}
    created: list[ModelRead] = []
    skipped: list[ProviderModelCandidate] = []
    for candidate in candidates:
        category_value = candidate.category.value
        if (candidate.name, category_value) in existing:
            skipped.append(candidate)
            continue
        _ensure_provider_supports_category(provider=provider, category=candidate.category)
        model = Model(
            id=uuid4().hex,
            name=candidate.name,
            category=candidate.category,
            provider_id=provider.id,
            params=candidate.params,
            description=candidate.description,
            created_by="model_catalog",
        )
        db.add(model)
        await db.flush()
        await _create_model_revision(db, model=model, provider=provider)
        await db.refresh(model)
        created.append(ModelRead.model_validate(model))
        existing.add((candidate.name, category_value))
    return ProviderModelImportResult(created=created, skipped=skipped)


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
    model = Model(
        id=body.id,
        name=body.name,
        category=body.category,
        provider_id=body.provider_id,
        params=body.params,
        description=body.description,
        created_by=body.created_by,
    )
    db.add(model)
    await db.flush()
    await _create_model_revision(db, model=model, provider=provider)
    return await flush_and_refresh(db, model)


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
    await db.flush()
    await _create_model_revision(db, model=model, provider=target_provider)
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
    """部分更新模型全局设置，保留请求中未出现的模态默认模型。

    前端会按 text、image、video 分别提交默认模型字段。必须只写入显式
    提交的字段，避免 Pydantic 的 ``None`` 默认值清空其他模态的已配置模型。
    """
    settings = await get_or_create_settings(db)
    patch_model(settings, body.model_dump(exclude_unset=True))
    return await flush_and_refresh(db, settings)


async def get_video_generation_options(
    db: AsyncSession,
    *,
    model_id: str | None = None,
) -> VideoGenerationOptionsRead:
    """返回指定视频模型（未指定时为默认模型）的能力选项。"""
    settings = await get_or_create_settings(db)
    resolved_model_id = model_id or settings.default_video_model_id
    if not resolved_model_id:
        return VideoGenerationOptionsRead(
            provider="",
            model_id="",
            model_name="",
            allowed_ratios=["16:9"],
            default_ratio="16:9",
            supports_subject_image_reference=False,
            supports_subject_video_reference=False,
            supports_subject_reference_with_frame_reference=False,
        )

    model = await get_or_404(db, Model, resolved_model_id, detail=entity_not_found("Model"))
    provider = await get_or_404(db, Provider, model.provider_id, detail=entity_not_found("Provider"))
    provider_key = resolve_provider_key_from_name(provider.name)
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
        supports_subject_image_reference=capability.supports_subject_image_reference,
        supports_subject_video_reference=capability.supports_subject_video_reference,
        supports_subject_reference_with_frame_reference=capability.supports_subject_reference_with_frame_reference,
        max_subjects=capability.max_subjects,
        max_images_per_subject=capability.max_images_per_subject,
        max_videos_per_subject=capability.max_videos_per_subject,
        max_media_per_subject=capability.max_media_per_subject,
        max_total_subject_videos=capability.max_total_subject_videos,
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
    provider_key = resolve_provider_key_from_name(provider.name)
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
    provider_key = resolve_provider_key_from_name(provider.name)
    if not is_provider_category_supported(provider_key, normalized_category):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Provider {provider.name!r} does not support category={normalized_category.value}",
        )
