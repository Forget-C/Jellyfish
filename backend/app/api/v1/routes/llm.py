"""LLM 相关基础配置的 CRUD 接口：Provider / Model / ModelSettings。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.llm import ModelCategoryKey
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, success_response
from app.schemas.llm import (
    ImageGenerationOptionsRead,
    ModelChatTestRead,
    ModelChatTestRequest,
    ModelCreate,
    ModelRead,
    ModelSettingsRead,
    ModelSettingsUpdate,
    ModelUpdate,
    ModelVerifyRead,
    ProviderCreate,
    ProviderRead,
    ProviderSupportedRead,
    VideoGenerationOptionsRead,
    ProviderUpdate,
)
from app.services.llm.manage import (
    create_model as create_model_service,
    create_provider as create_provider_service,
    delete_model as delete_model_service,
    delete_provider as delete_provider_service,
    get_model as get_model_service,
    get_model_settings as get_model_settings_service,
    get_provider as get_provider_service,
    get_image_generation_options as get_image_generation_options_service,
    get_video_generation_options as get_video_generation_options_service,
    list_supported_providers as list_supported_providers_service,
    list_models_paginated,
    list_providers_paginated,
    update_model as update_model_service,
    update_model_settings as update_model_settings_service,
    update_provider as update_provider_service,
)
from app.services.llm.model_chat_test import chat_test_with_model as chat_test_with_model_service
from app.services.llm.model_verify import verify_model_config as verify_model_config_service

router = APIRouter()

# 列表排序允许的字段（避免注入）
PROVIDER_ORDER_FIELDS = {"name", "created_at", "updated_at"}
MODEL_ORDER_FIELDS = {"name", "category", "created_at", "updated_at"}
DEFAULT_PAGE_SIZE = 10
# 管理端列表可能一次拉较多供应商/模型（如筛选项、统计）；略高于通用列表上限 100。
MAX_PAGE_SIZE = 200


# ---------- Provider ----------


@router.get(
    "/providers",
    response_model=ApiResponse[PaginatedData[ProviderRead]],
    summary="列出模型供应商（分页）",
)
async def list_providers(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="关键字，过滤 name/description"),
    order: str | None = Query(None, description="排序字段：name, created_at, updated_at"),
    is_desc: bool = Query(False, description="是否倒序"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE, description="每页条数"),
) -> ApiResponse[PaginatedData[ProviderRead]]:
    return await list_providers_paginated(
        db,
        q=q,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
        allow_fields=PROVIDER_ORDER_FIELDS,
    )


@router.get(
    "/providers/supported",
    response_model=ApiResponse[list[ProviderSupportedRead]],
    summary="列出系统支持的供应商能力",
)
async def list_supported_providers(
    category: ModelCategoryKey | None = Query(None, description="按模型类别过滤：text/image/video"),
) -> ApiResponse[list[ProviderSupportedRead]]:
    items = list_supported_providers_service(category=category)
    return success_response(items)


@router.get(
    "/image-generation-options",
    response_model=ApiResponse[ImageGenerationOptionsRead],
    summary="获取当前默认图片模型的关键帧规格选项",
)
async def get_image_generation_options(
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ImageGenerationOptionsRead]:
    data = await get_image_generation_options_service(db)
    return success_response(data)


@router.get(
    "/video-generation-options",
    response_model=ApiResponse[VideoGenerationOptionsRead],
    summary="获取当前默认视频模型的动态比例选项",
)
async def get_video_generation_options(
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[VideoGenerationOptionsRead]:
    data = await get_video_generation_options_service(db)
    return success_response(data)


@router.post(
    "/providers",
    response_model=ApiResponse[ProviderRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建模型供应商",
)
async def create_provider(
    body: ProviderCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProviderRead]:
    provider = await create_provider_service(db, body=body)
    return created_response(ProviderRead.model_validate(provider))


@router.get(
    "/providers/{provider_id}",
    response_model=ApiResponse[ProviderRead],
    summary="获取单个模型供应商",
)
async def get_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProviderRead]:
    provider = await get_provider_service(db, provider_id=provider_id)
    return success_response(ProviderRead.model_validate(provider))


@router.patch(
    "/providers/{provider_id}",
    response_model=ApiResponse[ProviderRead],
    summary="更新模型供应商",
)
async def update_provider(
    provider_id: str,
    body: ProviderUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProviderRead]:
    provider = await update_provider_service(db, provider_id=provider_id, body=body)
    return success_response(ProviderRead.model_validate(provider))


@router.delete(
    "/providers/{provider_id}",
    response_model=ApiResponse[None],
    status_code=status.HTTP_200_OK,
    summary="删除模型供应商",
)
async def delete_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_provider_service(db, provider_id=provider_id)
    return empty_response()


# ---------- Model ----------


@router.get(
    "/models",
    response_model=ApiResponse[PaginatedData[ModelRead]],
    summary="列出模型（分页）",
)
async def list_models(
    db: AsyncSession = Depends(get_db),
    provider_id: str | None = Query(None, description="按供应商过滤"),
    category: ModelCategoryKey | None = Query(None, description="按模型类别过滤"),
    q: str | None = Query(None, description="关键字，过滤 name/description"),
    order: str | None = Query(None, description="排序字段：name, category, created_at, updated_at"),
    is_desc: bool = Query(False, description="是否倒序"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE, description="每页条数"),
) -> ApiResponse[PaginatedData[ModelRead]]:
    return await list_models_paginated(
        db,
        provider_id=provider_id,
        category=category,
        q=q,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
        allow_fields=MODEL_ORDER_FIELDS,
    )


@router.post(
    "/models",
    response_model=ApiResponse[ModelRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建模型",
)
async def create_model(
    body: ModelCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelRead]:
    model = await create_model_service(db, body=body)
    return created_response(ModelRead.model_validate(model))


@router.post(
    "/models/{model_id}/verify",
    response_model=ApiResponse[ModelVerifyRead],
    summary="验证模型配置（同步探测，不创建生成任务）",
)
async def verify_llm_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelVerifyRead]:
    """对已保存模型做一次短超时探测：文本走极小对话；图/视频走列表接口鉴权与模型名匹配。"""
    data = await verify_model_config_service(db, model_id=model_id)
    return success_response(data)


@router.post(
    "/models/{model_id}/chat-test",
    response_model=ApiResponse[ModelChatTestRead],
    summary="文本模型试聊（管理页调试发消息）",
)
async def chat_test_llm_model(
    model_id: str,
    body: ModelChatTestRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelChatTestRead]:
    """对已保存的文本模型发送一条用户消息并返回模型回复（不计入业务任务）。"""
    data = await chat_test_with_model_service(
        db,
        model_id=model_id,
        user_message=body.message,
    )
    return success_response(data)


@router.get(
    "/models/{model_id}",
    response_model=ApiResponse[ModelRead],
    summary="获取单个模型",
)
async def get_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelRead]:
    model = await get_model_service(db, model_id=model_id)
    return success_response(ModelRead.model_validate(model))


@router.patch(
    "/models/{model_id}",
    response_model=ApiResponse[ModelRead],
    summary="更新模型",
)
async def update_model(
    model_id: str,
    body: ModelUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelRead]:
    model = await update_model_service(db, model_id=model_id, body=body)
    return success_response(ModelRead.model_validate(model))


@router.delete(
    "/models/{model_id}",
    response_model=ApiResponse[None],
    status_code=status.HTTP_200_OK,
    summary="删除模型",
)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_model_service(db, model_id=model_id)
    return empty_response()


# ---------- ModelSettings（单例） ----------


@router.get(
    "/model-settings",
    response_model=ApiResponse[ModelSettingsRead],
    summary="获取模型全局设置（单例）",
)
async def get_model_settings(
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelSettingsRead]:
    settings = await get_model_settings_service(db)
    return success_response(ModelSettingsRead.model_validate(settings))


@router.put(
    "/model-settings",
    response_model=ApiResponse[ModelSettingsRead],
    summary="更新模型全局设置（单例）",
)
async def update_model_settings(
    body: ModelSettingsUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ModelSettingsRead]:
    settings = await update_model_settings_service(db, body=body)
    return success_response(ModelSettingsRead.model_validate(settings))
