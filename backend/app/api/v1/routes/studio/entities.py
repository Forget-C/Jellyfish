"""统一实体 CRUD：actor/character/scene/prop/costume。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.dependencies import get_db
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.schemas.studio.entity_existence import (
    EntityNameExistenceCheckRequest,
    EntityNameExistenceCheckResponse,
)
from app.schemas.studio.cast import ActorCreate, ActorUpdate, CharacterCreate, CharacterUpdate
from app.schemas.studio.assets import SceneCreate, SceneUpdate, PropCreate, PropUpdate, CostumeCreate, CostumeUpdate
from app.services.studio.entities import StudioEntitiesService
from app.core.contracts.asset_prompts import AssetPromptReference

router = APIRouter()


class UploadedAssetImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(min_length=1)
    view_angle: str = Field(pattern="^(FRONT|LEFT|TOP|BACK)$")


class ImageSourceRequest(BaseModel):
    """客户端身份用于重试；来源和权限只能由服务端决定。"""
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    project_id: str | None = Field(None, min_length=1, max_length=64)
    source_id: str | None = Field(None, min_length=1, max_length=64)
    images: list[UploadedAssetImage] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()

    @model_validator(mode="after")
    def require_one_source(self):
        if bool(self.source_id) == bool(self.images):
            raise ValueError("请选择来源或至少上传一张图片")
        return self


@router.post("/{entity_type}/image-source", response_model=ApiResponse[dict[str, Any]], status_code=201,
             summary="从上传图片或资产库创建独立图片来源对象")
async def create_image_source_entity(entity_type: str, body: ImageSourceRequest, db: AsyncSession = Depends(get_db)):
    from app.services.studio.image_sources import create_image_source
    return created_response(await create_image_source(db, entity_type=entity_type, request=body))


class LibraryCopyRequest(BaseModel):
    """独立入库时允许单独指定副本名称。"""

    name: str | None = Field(None, min_length=1, max_length=255)


class AdoptReferenceMainRequest(BaseModel):
    """明确采用一张参考图片作为独立主图。"""

    reference: AssetPromptReference


@router.post("/{entity_type}/{entity_id}/adopt-reference-main", response_model=ApiResponse[dict[str, Any]],
             summary="采用参考图的独立副本作为对象主图")
async def adopt_entity_reference_main(
    entity_type: str, entity_id: str, body: AdoptReferenceMainRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    from app.services.studio.resource_image_copies import adopt_reference_main
    return success_response(await adopt_reference_main(db, entity_type=entity_type, entity_id=entity_id,
        reference=body.reference.model_dump(exclude_none=True)))


@router.post("/{entity_type}/{entity_id}/publish-to-library", response_model=ApiResponse[dict[str, Any]],
             status_code=status.HTTP_201_CREATED, summary="将项目对象独立复制到资产库")
async def publish_entity_to_library(
    entity_type: str, entity_id: str, body: LibraryCopyRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    from app.services.studio.library_copies import publish_to_library
    payload = await publish_to_library(db, entity_type=entity_type, entity_id=entity_id, name=body.name)
    return created_response(payload)


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
    project_id: str | None = Query(None, description="所属项目；不传时仅查询共享资产"),
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
        project_id=project_id,
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
    body: ActorCreate | CharacterCreate | SceneCreate | PropCreate | CostumeCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """解析分类请求，交由业务服务验证路径类别并处理实体。"""
    service = StudioEntitiesService(db)
    payload = await service.create_entity(entity_type=entity_type, body=body.model_dump(exclude_unset=True))
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
    body: ActorUpdate | CharacterUpdate | SceneUpdate | PropUpdate | CostumeUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """解析分类请求，交由业务服务验证路径类别并处理实体。"""
    service = StudioEntitiesService(db)
    payload = await service.update_entity(entity_type=entity_type, entity_id=entity_id, body=body.model_dump(exclude_unset=True))
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
) -> ApiResponse[dict[str, Any]]:
    service = StudioEntitiesService(db)
    payload = await service.create_entity_image(entity_type=entity_type, entity_id=entity_id, body=body)
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
) -> ApiResponse[dict[str, Any]]:
    service = StudioEntitiesService(db)
    payload = await service.update_entity_image(
        entity_type=entity_type,
        entity_id=entity_id,
        image_id=image_id,
        body=body,
    )
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
