"""出口 A「任务交付 · 仅提示词」路由。

设计点：
  - **纯读端点**：不写库、不联网、不触发任何付费出口。
  - 模型就近定义在本路由文件里（遵循本项目路由层约定，不塞进共享 schemas）。
  - 交付文本格式的权威口径见 ``app.services.studio.prompt_delivery`` 的文件头。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.studio import prompt_delivery as svc

router = APIRouter()


class PromptDeliveryRowRead(BaseModel):
    """一行镜头在交付清单里的状态。"""

    shot_id: str = Field(description="镜头 ID")
    chapter_id: str = Field(description="章节 ID")
    chapter_label: str = Field(description="章节显示标签（迁移后的章节 id 带剧本前缀，这里取 :: 之后）")
    shot_code: str = Field(description="镜头编号 S%03d（集内顺序）")
    shot_title: str = Field(description="镜头标题")
    video_prompt: str = Field(description="视频提示词正文")
    video_prompt_source: str = Field(description="提示词来源标记")
    exportable: bool = Field(description="是否可进入「仅提示词」出口（来源在白名单内且有正文）")
    issue: str = Field(default="", description="不可交付时的原因")
    bound_assets: dict[str, list[str]] = Field(
        default_factory=dict, description="已绑定资产名称（characters/scene/props/costumes）"
    )
    bound_files: list[dict[str, Any]] = Field(
        default_factory=list,
        description="绑定资产实际使用的文件（定版优先）：file_id / url / is_primary / resolved_from",
    )


class PromptDeliveryRead(BaseModel):
    """出口 A 的清单与预览文本。"""

    project_id: str
    scope: str = Field(description="current_shot / episode / episodes")
    scope_label: str
    export_sources: list[str] = Field(default_factory=list, description="本次允许的提示词来源白名单")
    include_bindings: bool = Field(True, description="交付文本是否带出绑定资产")
    export_source: str = Field(description="本出口只认的来源值")
    exportable_count: int
    skipped_count: int
    has_content: bool = Field(description="交付文本是否非空")
    rows: list[PromptDeliveryRowRead]
    text: str = Field(description="实际交付文本（可直接复制粘贴到其他平台）")
    note: str = Field(default="", description="口径与限制说明")


_NOTE = (
    "本端点只做「仅提示词」出口：导出**来源在白名单内且有正文**的提示词"
    "（大模型生成 / 巨日禄导入 / 人工编辑 / 一键技能生成，以及库中已有的历史来源值）；"
    "模板拼装不算来源，不进导出。默认会带出绑定资产名称与**实际使用的文件**。"
    "「完整任务（含资产）」模式的 imported_size / imported_resolution / "
    "recommended_duration 元信息在 Jellyfish 侧没有等价列，因此未提供。"
)


def _parse_sources(raw: str | None) -> list[str] | None:
    """把逗号分隔的 sources 查询参数解析成列表；空值返回 None（走默认白名单）。"""
    if not raw or not raw.strip():
        return None
    parsed = [item.strip() for item in raw.split(",") if item.strip()]
    return parsed or None


def _parse_ids(raw: str | None) -> list[str] | None:
    """把逗号分隔的镜头 ID 解析成列表；空值返回 None（走别的范围口径）。"""
    if not raw or not raw.strip():
        return None
    parsed = [item.strip() for item in raw.split(",") if item.strip()]
    return parsed or None


async def _collect(
    db: AsyncSession,
    *,
    project_id: str,
    scope: str,
    chapter_id: str | None,
    shot_id: str | None,
    shot_ids: list[str] | None = None,
    sources: list[str] | None = None,
    include_bindings: bool = True,
) -> PromptDeliveryRead:
    result = await svc.build_prompt_only_delivery(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        shot_id=shot_id,
        shot_ids=shot_ids,
        scope=scope,
        sources=sources,
        include_bindings=include_bindings,
    )
    allowed_sources = tuple(result.get("export_sources") or svc.EXPORT_SOURCES)
    rows: list[PromptDeliveryRowRead] = []
    for row in result["rows"]:
        exportable = svc.has_exportable_prompt(row, sources=allowed_sources)
        rows.append(
            PromptDeliveryRowRead(
                shot_id=row["shot_id"],
                chapter_id=row["chapter_id"],
                chapter_label=svc.chapter_label(row["chapter_id"], row["chapter_title"]),
                shot_code=svc.shot_code(row["shot_index"]),
                shot_title=row["shot_title"],
                video_prompt=row["video_prompt"],
                video_prompt_source=row["video_prompt_source"],
                exportable=exportable,
                issue="" if exportable else "该镜头没有可交付的提示词（来源不在白名单内或正文为空）",
                bound_assets=row.get("bound_assets") or {},
                bound_files=list(row.get("bound_files") or []),
            )
        )
    return PromptDeliveryRead(
        project_id=result["project_id"],
        scope=result["scope"],
        scope_label=result["scope_label"],
        export_sources=list(result.get("export_sources") or []),
        include_bindings=bool(result.get("include_bindings", True)),
        export_source=result["export_source"],
        exportable_count=result["exportable_count"],
        skipped_count=result["skipped_count"],
        has_content=result["has_content"],
        rows=rows,
        text=result["text"],
        note=_NOTE,
    )


@router.get(
    "/{project_id}",
    response_model=ApiResponse[PromptDeliveryRead],
    summary="出口A 交付清单与预览（仅提示词）",
)
async def preview_prompt_delivery(
    project_id: str,
    scope: str = Query(svc.SCOPE_EPISODES, description="范围：current_shot / episode / episodes"),
    chapter_id: str | None = Query(None, description="当前集范围时的章节 ID"),
    shot_id: str | None = Query(None, description="当前镜头范围时的镜头 ID"),
    shot_ids: str | None = Query(
        None,
        description=(
            "选中镜头范围：逗号分隔的镜头 ID（优先于 chapter_id；"
            "用于「导出/判就绪只按勾选范围」）"
        ),
    ),
    sources: str | None = Query(
        None, description="提示词来源白名单（逗号分隔）；只给 jurilu 可与中控台逐字对齐"
    ),
    include_bindings: bool = Query(True, description="交付文本是否带出绑定资产"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PromptDeliveryRead]:
    return success_response(
        await _collect(
            db,
            project_id=project_id,
            scope=scope,
            chapter_id=chapter_id,
            shot_id=shot_id,
            shot_ids=_parse_ids(shot_ids),
            sources=_parse_sources(sources),
            include_bindings=include_bindings,
        )
    )


@router.get(
    "/{project_id}/export",
    summary="出口A 下载交付文本（TXT + UTF-8 BOM）",
    response_class=Response,
)
async def export_prompt_delivery(
    project_id: str,
    scope: str = Query(svc.SCOPE_EPISODES, description="范围：current_shot / episode / episodes"),
    chapter_id: str | None = Query(None, description="当前集范围时的章节 ID"),
    shot_id: str | None = Query(None, description="当前镜头范围时的镜头 ID"),
    shot_ids: str | None = Query(None, description="选中镜头范围：逗号分隔的镜头 ID"),
    sources: str | None = Query(None, description="提示词来源白名单（逗号分隔）"),
    include_bindings: bool = Query(True, description="交付文本是否带出绑定资产"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    payload = await _collect(
        db,
        project_id=project_id,
        scope=scope,
        chapter_id=chapter_id,
        shot_id=shot_id,
        shot_ids=_parse_ids(shot_ids),
        sources=_parse_sources(sources),
        include_bindings=include_bindings,
    )
    if not payload.has_content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="范围内没有可导出的提示词（来源不在白名单内，或正文为空）",
        )
    body = svc.encode_txt_download(payload.text)
    filename = svc.export_filename(project_id, payload.scope)
    return Response(
        content=body,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


__all__ = ["router"]
