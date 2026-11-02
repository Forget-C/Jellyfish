"""文件素材相关路由：上传 / 下载 / 列表 / 详情。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.schemas.studio import FileDetailRead, FileRead, FileUpdate
from app.services.studio.file_usages import list_files_by_scope_paginated
from app.services.studio.files import (
    build_download_response,
    delete_file,
    release_upload_retention,
    get_file_detail as get_file_detail_service,
    get_storage_info,
    list_files_paginated,
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

) -> ApiResponse[PaginatedData[FileRead]]:
    if chapter_title is not None:
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


@router.post(
    "/upload",
    response_model=ApiResponse[FileRead],
    status_code=status.HTTP_201_CREATED,
    summary="上传文件并创建 FileItem 记录",
)
async def upload_file_api(
    file: UploadFile = File(..., description="要上传的二进制文件"),
    name: str | None = None,
    db: AsyncSession = Depends(get_db, scope="function"),
    project_id: str | None = Form(None, description="可选：写入 file_usages 的项目 ID"),
    chapter_id: str | None = Form(None),

    usage_kind: str | None = Form(None, description="与 project_id 同时提供时写入 file_usages"),
    source_ref: str | None = Form(None),
) -> ApiResponse[FileRead]:
    obj = await upload_file(
        db,
        file=file,
        name=name,
        project_id=project_id,
        chapter_id=chapter_id,

        usage_kind=usage_kind,
        source_ref=source_ref,
    )
    return created_response(FileRead.model_validate(obj))


@router.get(
    "/{file_id}/download",
    summary="下载文件二进制内容",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def download_file_api(
    file_id: str,
    range_header: str | None = Header(default=None, alias="Range"),
    db: AsyncSession = Depends(get_db),
):
    """返回整文件或浏览器请求的单段字节。"""
    return await build_download_response(db, file_id=file_id, range_header=range_header)


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


@router.delete(
    "/{file_id}/upload-retention", response_model=ApiResponse[None],
    operation_id="release_upload_retention", summary="显式清理画布上传保留关系",
)
async def release_upload_retention_api(
    file_id: str, project_id: str = Query(...), db: AsyncSession = Depends(get_db, scope="function"),
) -> ApiResponse[None]:
    """仅清理指定项目的上传保留；有其他使用者时拒绝，不删除文件字节。"""
    await release_upload_retention(db, file_id=file_id, project_id=project_id)
    return empty_response()
