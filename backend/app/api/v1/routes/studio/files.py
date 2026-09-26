"""文件素材相关路由：上传 / 下载 / 列表 / 详情。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.schemas.studio import FileDetailRead, FileRead, FileUpdate, FileUploadRead
from app.services.studio.file_usages import list_files_by_scope_paginated
from app.services.studio.files import (
    build_download_response,
    delete_file,
    get_file_detail as get_file_detail_service,
    get_storage_info,
    list_files_paginated,
    register_external_file,
    update_file_meta as update_file_meta_service,
    upload_file,
)
router = APIRouter()


@router.get(
    "",
    response_model=ApiResponse[PaginatedData[FileRead]],
    summary="文件列表（分页）",
)
async def list_files_api(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="关键字，过滤 name"),
    order: str | None = Query(None),
    is_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    project_id: str | None = Query(None, description="按 file_usages 限定项目；提供后仅返回该项目下有关联记录的文件"),
    chapter_title: str | None = Query(None, description="章节标题（精确匹配，与 project_id 联用）"),
    shot_title: str | None = Query(None, description="镜头标题（精确匹配，与 project_id 联用）"),
) -> ApiResponse[PaginatedData[FileRead]]:
    if chapter_title is not None or shot_title is not None:
        if not project_id:
            raise HTTPException(
                status_code=400,
                detail="project_id is required when chapter_title or shot_title is set",
            )

    if project_id is not None:
        items, total = await list_files_by_scope_paginated(
            db,
            project_id=project_id,
            chapter_title=chapter_title,
            shot_title=shot_title,
            q=q,
            order=order,
            is_desc=is_desc,
            page=page,
            page_size=page_size,
        )
        return paginated_response(
            [FileRead.model_validate(x) for x in items],
            page=page,
            page_size=page_size,
            total=total,
        )
    return await list_files_paginated(
        db,
        q=q,
        order=order,
        is_desc=is_desc,
        page=page,
        page_size=page_size,
    )


class ExternalFileCreate(BaseModel):
    """登记外部公网素材（不下载、不存副本）。"""

    url: str = Field(..., min_length=1, description="公网可访问地址（http/https）")
    name: str | None = Field(None, description="显示名（缺省取 URL 文件名）")
    type: str | None = Field(None, description="素材类型：image / video / audio（缺省按后缀推断）")
    project_id: str | None = Field(None, description="与 usage_kind 同时提供时写入 file_usages")
    chapter_id: str | None = None
    shot_id: str | None = None
    usage_kind: str | None = None
    source_ref: str | None = None


@router.post(
    "/external",
    response_model=ApiResponse[FileRead],
    status_code=status.HTTP_201_CREATED,
    summary="登记外部公网素材（外链，不下载）",
    description=(
        "把外部公网地址登记成素材记录。用于「供应商要求公网可达」的场景（例如 APIMart 的 "
        "audio_urls 只收公网 URL）；不下载内容、不在本地存储副本。"
    ),
)
async def register_external_file_api(
    body: ExternalFileCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[FileRead]:
    obj = await register_external_file(
        db,
        url=body.url,
        name=body.name,
        file_type=body.type,
        project_id=body.project_id,
        chapter_id=body.chapter_id,
        shot_id=body.shot_id,
        usage_kind=body.usage_kind,
        source_ref=body.source_ref,
    )
    return created_response(FileRead.model_validate(obj))


@router.post(
    "/upload",
    response_model=ApiResponse[FileUploadRead],
    status_code=status.HTTP_201_CREATED,
    summary="上传文件并创建 FileItem 记录（响应附带地址匿名可达性）",
    description=(
        "上传文件到对象存储并落库。响应在原有文件字段之外，**新增** "
        "``url`` / ``url_reachable`` / ``url_probe`` / ``warnings``：说明这个地址"
        "**上游能不能匿名取到**（真实故障 A：本机可读、公网 404 的地址交给上游 → 上游任务失败）。"
        "不可达**不阻断上传**（文件已落库），但会如实告警并给出修法。"
    ),
)
async def upload_file_api(
    file: UploadFile = File(..., description="要上传的二进制文件"),
    name: str | None = None,
    db: AsyncSession = Depends(get_db),
    project_id: str | None = Form(None, description="可选：写入 file_usages 的项目 ID"),
    chapter_id: str | None = Form(None),
    shot_id: str | None = Form(None),
    usage_kind: str | None = Form(None, description="与 project_id 同时提供时写入 file_usages"),
    source_ref: str | None = Form(None),
) -> ApiResponse[FileUploadRead]:
    outcome = await upload_file(
        db,
        file=file,
        name=name,
        project_id=project_id,
        chapter_id=chapter_id,
        shot_id=shot_id,
        usage_kind=usage_kind,
        source_ref=source_ref,
    )
    return created_response(FileUploadRead(**outcome.to_read()))


@router.get(
    "/{file_id}/download",
    summary="下载文件二进制内容（外链素材会 307 重定向到源地址）",
    response_class=Response,
)
async def download_file_api(
    file_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await build_download_response(db, file_id=file_id)


@router.get(
    "/{file_id}/storage-info",
    response_model=ApiResponse[dict],
    summary="获取对象存储详情（head_object）",
)
async def get_file_storage_info_api(
    file_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict]:
    return success_response(await get_storage_info(db, file_id=file_id))


@router.get(
    "/{file_id}",
    response_model=ApiResponse[FileDetailRead],
    summary="获取文件详情（元信息 + file_usages）",
)
async def get_file_detail(
    file_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[FileDetailRead]:
    return success_response(await get_file_detail_service(db, file_id=file_id))


@router.patch(
    "/{file_id}",
    response_model=ApiResponse[FileRead],
    summary="更新文件元信息",
)
async def update_file_meta(
    file_id: str,
    body: FileUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[FileRead]:
    obj = await update_file_meta_service(db, file_id=file_id, body=body)
    return success_response(FileRead.model_validate(obj))


@router.delete(
    "/{file_id}",
    response_model=ApiResponse[None],
    summary="删除文件（记录 + 存储对象）",
)
async def delete_file_api(
    file_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_file(db, file_id=file_id)
    return empty_response()
