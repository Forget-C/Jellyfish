"""Project CRUD。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.studio import Project
from app.models.types import ProjectVisualStyle
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.schemas.studio.projects import (
    ProjectCreate,
    ProjectRead,
    ProjectStyleOptionsRead,
    ProjectUpdate,
    StyleOption,
)
from app.services.common import (
    create_and_refresh,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    get_or_404,
)
from app.services.studio.project_settings import (
    build_project_style_options, remove_project, save_project, validate_project_style_combo,
)
from app.services.studio.project_listing import list_project_page

router = APIRouter()


@router.get(
    "/style-options",
    response_model=ApiResponse[ProjectStyleOptionsRead],
    summary="获取项目风格候选项",
)
async def get_project_style_options(
) -> ApiResponse[ProjectStyleOptionsRead]:
    mapping, defaults = build_project_style_options()
    data = ProjectStyleOptionsRead(
        visual_styles=[StyleOption(value=x.value, label=x.value) for x in ProjectVisualStyle],
        styles_by_visual_style={
            visual.value: [StyleOption(value=style.value, label=style.value) for style in styles]
            for visual, styles in mapping.items()
        },
        default_style_by_visual_style={visual.value: style.value for visual, style in defaults.items()},
    )
    return success_response(data)


@router.get(
    "",
    response_model=ApiResponse[PaginatedData[ProjectRead]],
    summary="项目列表（分页）",
)
async def list_projects(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="关键字，过滤 name/description"),
    stage: Literal["edit_raw"] | None = Query(None, description="待补原文：无章节，或至少一章原文为空"),
    order: str | None = Query(None, description="排序字段，支持 chapter_count（章节数量）"),
    is_desc: bool = Query(False, description="是否倒序"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[ProjectRead]]:
    items, total = await list_project_page(
        db, q=q, order=order, is_desc=is_desc, missing_source=stage == "edit_raw",
        page=page, page_size=page_size,
    )
    return paginated_response([ProjectRead.model_validate(x) for x in items], page=page, page_size=page_size, total=total)


@router.post(
    "",
    response_model=ApiResponse[ProjectRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目",
)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectRead]:
    await ensure_not_exists(
        db,
        Project,
        body.id,
        detail=entity_already_exists("Project"),
    )
    try:
        validate_project_style_combo(visual_style=body.visual_style, style=body.style)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    obj = await create_and_refresh(db, Project(**body.model_dump()))
    return created_response(ProjectRead.model_validate(obj))


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectRead],
    summary="获取项目",
)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectRead]:
    obj = await get_or_404(db, Project, project_id, detail=entity_not_found("Project"))
    return success_response(ProjectRead.model_validate(obj))


@router.patch(
    "/{project_id}",
    response_model=ApiResponse[ProjectRead],
    summary="更新项目",
)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ApiResponse[ProjectRead]:
    return success_response(ProjectRead.model_validate(await save_project(db, project_id, body)))


@router.patch(
    "/{project_id}/cover-upload",
    response_model=ApiResponse[ProjectRead],
    summary="上传项目封面并保存项目设置",
)
async def update_project_with_cover_upload(
    project_id: str,
    file: UploadFile = File(...),
    settings: str = Form("{}", description="ProjectUpdate 的 JSON，封面由上传文件提供"),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ApiResponse[ProjectRead]:
    """在单次保存中提交图片和其他项目字段。"""
    try:
        body = ProjectUpdate.model_validate_json(settings)
    except ValidationError as exc:
        raise HTTPException(422, "项目设置格式无效") from exc
    if "cover_file_id" in body.model_fields_set:
        raise HTTPException(422, "上传封面时请省略 cover_file_id")
    return success_response(ProjectRead.model_validate(await save_project(db, project_id, body, file)))


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[None],
    summary="删除项目",
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ApiResponse[None]:
    await remove_project(db, project_id)
    return empty_response()
