"""项目资产关联 API；场次设计独立消费已关联资产。"""
from typing import Any
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.dependencies import get_db
from app.services.studio.project_assets import (
    create_project_asset_link as create_project_asset_link_service,
    delete_project_asset_link as delete_project_asset_link_service,
    list_project_asset_links_paginated,
)
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response
from app.schemas.studio.project_assets import (
    ProjectActorLinkRead, ProjectAssetLinkCreate, ProjectCostumeLinkRead,
    ProjectPropLinkRead, ProjectSceneLinkRead,
)

router = APIRouter()
LINK_ORDER_FIELDS = {"id", "created_at", "updated_at"}

@router.get(
    "/{entity_type}",
    response_model=ApiResponse[PaginatedData[Any]],
    summary="项目-章节-实体关联列表（分页）",
)
async def list_project_entity_links(
    entity_type: str,
    db: AsyncSession = Depends(get_db),
    project_id: str | None = Query(None),
    chapter_id: str | None = Query(None),
    asset_id: str | None = Query(None),
    order: str | None = Query(None),
    is_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[Any]]:
    return await list_project_asset_links_paginated(
        db=db,
        entity_type=entity_type,
        project_id=project_id,
        chapter_id=chapter_id,
        asset_id=asset_id,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
        allow_fields=LINK_ORDER_FIELDS,
    )


@router.post(
    "/actor",
    response_model=ApiResponse[ProjectActorLinkRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目-章节-演员关联",
)
async def create_project_actor_link(
    body: ProjectAssetLinkCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectActorLinkRead]:
    obj = await create_project_asset_link_service(db, entity_type="actor", body=body)
    return created_response(ProjectActorLinkRead.model_validate(obj))



@router.delete(
    "/actor/{link_id}",
    response_model=ApiResponse[None],
    summary="删除项目-章节-演员关联",
)
async def delete_project_actor_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_project_asset_link_service(db, entity_type="actor", link_id=link_id)
    return empty_response()


@router.post(
    "/scene",
    response_model=ApiResponse[ProjectSceneLinkRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目-章节-场景关联",
)
async def create_project_scene_link(
    body: ProjectAssetLinkCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectSceneLinkRead]:
    obj = await create_project_asset_link_service(db, entity_type="scene", body=body)
    return created_response(ProjectSceneLinkRead.model_validate(obj))



@router.delete(
    "/scene/{link_id}",
    response_model=ApiResponse[None],
    summary="删除项目-章节-场景关联",
)
async def delete_project_scene_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_project_asset_link_service(db, entity_type="scene", link_id=link_id)
    return empty_response()


@router.post(
    "/prop",
    response_model=ApiResponse[ProjectPropLinkRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目-章节-道具关联",
)
async def create_project_prop_link(
    body: ProjectAssetLinkCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectPropLinkRead]:
    obj = await create_project_asset_link_service(db, entity_type="prop", body=body)
    return created_response(ProjectPropLinkRead.model_validate(obj))



@router.delete(
    "/prop/{link_id}",
    response_model=ApiResponse[None],
    summary="删除项目-章节-道具关联",
)
async def delete_project_prop_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_project_asset_link_service(db, entity_type="prop", link_id=link_id)
    return empty_response()


@router.post(
    "/costume",
    response_model=ApiResponse[ProjectCostumeLinkRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目-章节-服装关联",
)
async def create_project_costume_link(
    body: ProjectAssetLinkCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectCostumeLinkRead]:
    obj = await create_project_asset_link_service(db, entity_type="costume", body=body)
    return created_response(ProjectCostumeLinkRead.model_validate(obj))


@router.delete(
    "/costume/{link_id}",
    response_model=ApiResponse[None],
    summary="删除项目-章节-服装关联",
)
async def delete_project_costume_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_project_asset_link_service(db, entity_type="costume", link_id=link_id)
    return empty_response()
