"""统一实体 CRUD：actor/character/scene/prop/costume。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import error_envelope
from app.dependencies import get_db
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.schemas.studio.entity_existence import (
    EntityNameExistenceCheckRequest,
    EntityNameExistenceCheckResponse,
)
from app.services.studio import StudioEntitiesService
from app.services.studio.entity_images import EntityImageSlotConflict
from app.services.studio.primary_protection import PrimaryImageReplaceRequired

router = APIRouter()


@router.post(
    "/existence-check",
    response_model=ApiResponse[EntityNameExistenceCheckResponse],
    summary="批量检测资产名称是否存在（模糊匹配，不分页）",
)
async def check_entity_names_existence(
    body: EntityNameExistenceCheckRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[EntityNameExistenceCheckResponse]:
    service = StudioEntitiesService(db)
    data = await service.check_names_existence(
        project_id=body.project_id,
        shot_id=body.shot_id,
        character_names=body.character_names,
        prop_names=body.prop_names,
        scene_names=body.scene_names,
        costume_names=body.costume_names,
    )
    return success_response(EntityNameExistenceCheckResponse.model_validate(data))


@router.get("/{entity_type}", response_model=ApiResponse[PaginatedData[dict[str, Any]]], summary="统一实体列表（分页）")
async def list_entities(
    entity_type: str,
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="关键字，过滤 name/description"),
    style: str | None = Query(None, description="题材/风格（单值）"),
    visual_style: str | None = Query(None, description="画面表现形式（单值：真人/动漫）"),
    order: str | None = Query(None),
    is_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[dict[str, Any]]]:
    service = StudioEntitiesService(db)
    payload, total = await service.list_entities(
        entity_type=entity_type,
        q=q,
        style=style,
        visual_style=visual_style,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
    )
    return paginated_response(payload, page=page, page_size=page_size, total=total)


@router.post("/{entity_type}", response_model=ApiResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED, summary="统一创建实体")
async def create_entity(
    entity_type: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    service = StudioEntitiesService(db)
    payload = await service.create_entity(entity_type=entity_type, body=body)
    return created_response(payload)


@router.get("/{entity_type}/{entity_id}", response_model=ApiResponse[dict[str, Any]], summary="统一获取实体")
async def get_entity(entity_type: str, entity_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[dict[str, Any]]:
    service = StudioEntitiesService(db)
    payload = await service.get_entity(entity_type=entity_type, entity_id=entity_id)
    return success_response(payload)


@router.patch("/{entity_type}/{entity_id}", response_model=ApiResponse[dict[str, Any]], summary="统一更新实体")
async def update_entity(
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    service = StudioEntitiesService(db)
    payload = await service.update_entity(entity_type=entity_type, entity_id=entity_id, body=body)
    return success_response(payload)


@router.delete("/{entity_type}/{entity_id}", response_model=ApiResponse[None], summary="统一删除实体")
async def delete_entity(entity_type: str, entity_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[None]:
    service = StudioEntitiesService(db)
    await service.delete_entity(entity_type=entity_type, entity_id=entity_id)
    return empty_response()


@router.get(
    "/{entity_type}/{entity_id}/images",
    response_model=ApiResponse[PaginatedData[dict[str, Any]]],
    summary="统一实体图片列表（分页）",
)
async def list_entity_images(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    order: str | None = Query(None),
    is_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[dict[str, Any]]]:
    service = StudioEntitiesService(db)
    payload, total = await service.list_entity_images(
        entity_type=entity_type,
        entity_id=entity_id,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
    )
    return paginated_response(payload, page=page, page_size=page_size, total=total)


@router.post(
    "/{entity_type}/{entity_id}/images",
    response_model=ApiResponse[dict[str, Any]],
    status_code=status.HTTP_201_CREATED,
    summary="统一创建实体图片",
)
async def create_entity_image(
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]] | JSONResponse:
    service = StudioEntitiesService(db)
    try:
        payload = await service.create_entity_image(entity_type=entity_type, entity_id=entity_id, body=body)
    except PrimaryImageReplaceRequired as exc:
        # 定版保护的 409：结构化明细进 meta.error（与 /image-pipeline/adopt 同形）。
        # 其余 HTTPException 照旧走全局处理器，响应形状不变。
        return error_envelope(code=exc.status_code, detail=exc.detail)
    except EntityImageSlotConflict as exc:
        # 同槽位重复建图（唯一约束 (资产ID, quality_level, view_angle)）：
        # 以前是 IntegrityError 穿透成 500，现在是同一形制的结构化 409。
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return created_response(payload)


@router.patch(
    "/{entity_type}/{entity_id}/images/{image_id}",
    response_model=ApiResponse[dict[str, Any]],
    summary="统一更新实体图片",
)
async def update_entity_image(
    entity_type: str,
    entity_id: str,
    image_id: int,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]] | JSONResponse:
    service = StudioEntitiesService(db)
    try:
        payload = await service.update_entity_image(
            entity_type=entity_type,
            entity_id=entity_id,
            image_id=image_id,
            body=body,
        )
    except PrimaryImageReplaceRequired as exc:
        # 同上：给这条写入路径同一个结构化 409（改 file_id / 设版顶掉既有定版时）
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(payload)


@router.delete(
    "/{entity_type}/{entity_id}/images/{image_id}",
    response_model=ApiResponse[None],
    summary="统一删除实体图片",
)
async def delete_entity_image(
    entity_type: str,
    entity_id: str,
    image_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    service = StudioEntitiesService(db)
    await service.delete_entity_image(entity_type=entity_type, entity_id=entity_id, image_id=image_id)
    return empty_response()
