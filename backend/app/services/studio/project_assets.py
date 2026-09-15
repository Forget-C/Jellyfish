"""项目资产服务：按项目和可选章节管理资产关联。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, paginate
from app.models.studio import Actor, Costume, ProjectActorLink, ProjectCostumeLink, ProjectPropLink, ProjectSceneLink, Prop, Scene
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio.project_assets import ProjectAssetLinkCreate, ProjectActorLinkRead, ProjectCostumeLinkRead, ProjectPropLinkRead, ProjectSceneLinkRead
from app.services.common import delete_if_exists, entity_not_found, invalid_choice, require_entity
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.entity_thumbnails import resolve_thumbnails
from app.utils.project_links import upsert_project_link


def _link_spec(entity_type: str) -> dict[str, Any]:
    t = normalize_entity_type(entity_type)
    if t == "actor":
        return {
            "model": ProjectActorLink,
            "field": "actor_id",
            "read_model": ProjectActorLinkRead,
            "asset_model": Actor,
            "not_found": entity_not_found("Actor"),
        }
    if t == "scene":
        return {
            "model": ProjectSceneLink,
            "field": "scene_id",
            "read_model": ProjectSceneLinkRead,
            "asset_model": Scene,
            "not_found": entity_not_found("Scene"),
        }
    if t == "prop":
        return {
            "model": ProjectPropLink,
            "field": "prop_id",
            "read_model": ProjectPropLinkRead,
            "asset_model": Prop,
            "not_found": entity_not_found("Prop"),
        }
    if t == "costume":
        return {
            "model": ProjectCostumeLink,
            "field": "costume_id",
            "read_model": ProjectCostumeLinkRead,
            "asset_model": Costume,
            "not_found": entity_not_found("Costume"),
        }
    raise HTTPException(status_code=400, detail=invalid_choice("entity_type", ["actor", "scene", "prop", "costume"]))


async def create_project_asset_link(
    db: AsyncSession,
    *,
    entity_type: str,
    body: ProjectAssetLinkCreate,
) -> Any:
    """创建或补全项目-章节-资产关联。"""
    spec = _link_spec(entity_type)
    await require_entity(
        db,
        spec["asset_model"],
        body.asset_id,
        detail=spec["not_found"],
        status_code=400,
    )
    row = await upsert_project_link(
        db,
        model=spec["model"],
        asset_field=spec["field"],
        asset_id=body.asset_id,
        project_id=body.project_id,
        chapter_id=body.chapter_id,
    )
    return row


async def delete_project_asset_link(
    db: AsyncSession,
    *,
    entity_type: str,
    link_id: int,
) -> None:
    """删除项目-章节-资产关联。"""
    spec = _link_spec(entity_type)
    row = await db.get(spec["model"], link_id)
    if row is None:
        return
    await delete_if_exists(db, spec["model"], link_id)


async def list_project_asset_links_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    project_id: str | None,
    chapter_id: str | None,
    asset_id: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    allow_fields: set[str],
) -> ApiResponse[PaginatedData[Any]]:
    """查询项目-章节-实体关联列表（分页）。"""
    spec = _link_spec(entity_type)
    model = spec["model"]
    field_name = spec["field"]

    stmt = select(model)
    if project_id is not None:
        stmt = stmt.where(model.project_id == project_id)
    if chapter_id is not None:
        stmt = stmt.where(model.chapter_id == chapter_id)
    if asset_id is not None:
        stmt = stmt.where(getattr(model, field_name) == asset_id)
    stmt = apply_order(
        stmt,
        model=model,
        order=order,
        is_desc=is_desc,
        allow_fields=allow_fields,
        default="id",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    es = entity_spec(entity_type)
    ids = [getattr(x, field_name) for x in items if getattr(x, field_name, None)]
    thumbnails = await resolve_thumbnails(
        db,
        image_model=es.image_model,
        parent_field_name=es.id_field,
        parent_ids=ids,
    )
    read_model = spec["read_model"]
    payload = [
        read_model.model_validate(x).model_copy(update={"thumbnail": thumbnails.get(getattr(x, field_name), "")})
        for x in items
    ]
    return paginated_response(payload, page=page, page_size=page_size, total=total)
