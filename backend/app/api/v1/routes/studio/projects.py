"""Project CRUD。"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, error_envelope, paginate
from app.dependencies import get_db
from app.models.studio import Chapter, ChapterStatus, Project
from app.models.types import ProjectStartMode, ProjectStyle, ProjectVisualStyle
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    flush_and_refresh,
    get_or_404,
    patch_model,
)
from app.schemas.studio.projects import (
    ProjectCreate,
    ProjectRead,
    ProjectStyleOptionsRead,
    ProjectUpdate,
    StyleOption,
)
from app.schemas.studio.assets import ProjectAssetReadinessRead
from app.services.studio.asset_prompt_batch import save_asset_image_prompts
from app.services.studio.project_asset_readiness import build_project_asset_readiness

router = APIRouter()


class ProjectAssetImagePromptItem(BaseModel):
    """批量保存里的一项：资产 + 本次要保存的槽位提示词。"""

    asset_type: str = Field(..., description="character / scene / prop / costume")
    asset_id: str = Field(..., description="资产 ID")
    image_prompts: dict[str, str] = Field(
        ...,
        description="按槽位类别提交的提示词（例如 character_image_front / prop_image_front）；只需提交要变更的槽位",
    )


class ProjectAssetImagePromptSaveRequest(BaseModel):
    """批量保存资产图片提示词的请求（全有或全无）。"""

    items: list[ProjectAssetImagePromptItem] = Field(..., description="要保存的资产与提示词")
    confirm_replace_image_prompt: bool = Field(
        False,
        description="已有提示词槽位默认**不被覆盖**；确实要覆盖时置 true",
    )

PROJECT_ORDER_FIELDS = {"name", "created_at", "updated_at", "progress"}

#: 「从视频提示词开始」的项目自动创建的默认章节标题。
DEFAULT_PROMPT_START_CHAPTER_TITLE = "默认章节"


async def _next_chapter_index(db: AsyncSession, *, project_id: str) -> int:
    """项目内下一个可用章节序号：现有最大 index + 1（不是数量 + 1）。"""
    rows = (await db.execute(select(Chapter.index).where(Chapter.project_id == project_id))).scalars().all()
    indexes = [int(value) for value in rows if value is not None and str(value).isdigit()]
    return (max(indexes) if indexes else 0) + 1


async def _ensure_default_chapter(db: AsyncSession, *, project_id: str) -> bool:
    """确保项目至少有一个章节；已有章节时什么都不做。

    为什么「从视频提示词开始」必须自动建章节：整集提示词看板是按章节承载镜头的
    （`shot_details.video_prompt` 挂在镜头上），没有章节就没有承载物，导入预览与
    确认写入都会被挡住。这里只补一个空章节，不写入任何剧本或提示词。
    """
    has_chapter = (
        await db.execute(select(Chapter.id).where(Chapter.project_id == project_id).limit(1))
    ).scalars().first()
    if has_chapter:
        return False
    index = await _next_chapter_index(db, project_id=project_id)
    chapter_id = f"{project_id}::EP{index:02d}"
    if await db.get(Chapter, chapter_id) is not None:  # 极端情况下的 id 冲突兜底
        chapter_id = f"{project_id}::EP{index:02d}-{uuid.uuid4().hex[:6]}"
    await create_and_refresh(
        db,
        Chapter(
            id=chapter_id,
            project_id=project_id,
            index=index,
            title=DEFAULT_PROMPT_START_CHAPTER_TITLE,
            summary="",
            raw_text="",
            storyboard_count=0,
            status=ChapterStatus.draft,
        ),
    )
    return True


def _build_project_style_options() -> tuple[dict[ProjectVisualStyle, list[ProjectStyle]], dict[ProjectVisualStyle, ProjectStyle]]:
    mapping: dict[ProjectVisualStyle, list[ProjectStyle]] = {key: [] for key in ProjectVisualStyle}
    for item in ProjectStyle:
        if item.name.startswith("real_people_"):
            mapping[ProjectVisualStyle.live_action].append(item)
            continue
        if item.name.startswith("anime_") or item.name in {"guoman", "ink_wash"}:
            mapping[ProjectVisualStyle.anime].append(item)
            continue
    defaults: dict[ProjectVisualStyle, ProjectStyle] = {
        visual: styles[0]
        for visual, styles in mapping.items()
        if styles
    }
    return mapping, defaults


def _validate_project_style_combo(*, visual_style: ProjectVisualStyle, style: ProjectStyle | str) -> None:
    """校验「画面表现形式 × 题材风格」的组合。

    预设风格（ProjectStyle 里的值）仍然要求与 visual_style 匹配；
    不在预设内的字符串视为用户自定义风格，直接放行——这样前端可以自由输入，
    同时不放弃对既有预设值的约束力。
    """
    try:
        style_enum = ProjectStyle(style)
    except ValueError:
        # 自定义风格：长度与空白由 schema 层把关，这里不再限制组合
        return

    mapping, _defaults = _build_project_style_options()
    allowed = mapping.get(visual_style, [])
    if style_enum not in allowed:
        raise ValueError(
            f"style is not allowed for visual_style: visual_style={visual_style}, "
            f"style={style_enum}, allowed={[item.value for item in allowed]}"
        )


@router.get(
    "/style-options",
    response_model=ApiResponse[ProjectStyleOptionsRead],
    summary="获取项目风格候选项",
)
async def get_project_style_options(
) -> ApiResponse[ProjectStyleOptionsRead]:
    mapping, defaults = _build_project_style_options()
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
    order: str | None = Query(None, description="排序字段"),
    # 默认倒序：项目列表要「最新创建的在最上面」。以前默认 ASC，最新项目被排到最后，
    # 前端又拿从不写入的 stats.updated_at 兜底成「当前时间」，导致本地排序完全失效。
    is_desc: bool = Query(True, description="是否倒序（默认按创建时间倒序：最新项目在最上面）"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[ProjectRead]]:
    stmt = select(Project)
    stmt = apply_keyword_filter(stmt, q=q, fields=[Project.name, Project.description])
    stmt = apply_order(stmt, model=Project, order=order, is_desc=is_desc, allow_fields=PROJECT_ORDER_FIELDS, default="created_at")
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
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
        _validate_project_style_combo(visual_style=body.visual_style, style=body.style)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    obj = await create_and_refresh(db, Project(**body.model_dump()))

    # 「从视频提示词开始」：创建后必须能直接进整集提示词看板，因此补一个默认章节。
    if obj.start_mode == ProjectStartMode.prompts.value:
        await _ensure_default_chapter(db, project_id=obj.id)
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


@router.get(
    "/{project_id}/asset-readiness",
    response_model=ApiResponse[ProjectAssetReadinessRead],
    summary="项目资产准备清单（角色/场景/道具/服装同一口径）",
)
async def get_project_asset_readiness(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectAssetReadinessRead]:
    """第 2 步「资产准备」的**唯一数据源**。

    资产表格、顶部统计与步骤判定都读这一份清单，不再各自去看
    `project_scene_links` / `project_prop_links` 之类关联行的读模型里
    是否**偶然**带了 `image_prompts` —— 那正是「保存了提示词仍显示待完善」的根因。
    """
    await get_or_404(db, Project, project_id, detail=entity_not_found("Project"))
    payload = await build_project_asset_readiness(db, project_id=project_id)
    return success_response(ProjectAssetReadinessRead.model_validate(payload))


@router.post(
    "/{project_id}/asset-image-prompts",
    response_model=ApiResponse[dict[str, Any]],
    summary="批量保存资产图片提示词（后端质量拦截 + 跨资产查重 + 覆盖保护）",
)
async def save_project_asset_image_prompts(
    project_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """资产准备页「确认保存」的**唯一批量入口**（一次请求一个事务，全有或全无）。

    为什么必须放在后端而不是各页面各写一遍：

    - **质量拦截**（422，结构化中文错误、可照做修）：空提示词、
      含「外观信息不足 / 需人工补充」这类空话、只有资产名 + 通用摄影词
      （去掉资产名与景别/机位/背景/画质词后没有任何该资产的特征）；
    - **跨资产查重**（409）：两个**不同**资产生成了逐字相同或高度重复的内容
      （同一资产的正面/侧面不在此列）——这正是"一段文本给两个角色"的线上症状；
    - **覆盖保护**（409）：已有提示词槽位默认不动，要覆盖必须显式传
      ``confirm_replace_image_prompt=true``；
    - **合并写入**：只写本次提交的槽位，其它槽位原样保留。

    任何一项不合规 → 整批拒绝、库里零改动；成功返回里带每项实际写入的槽位。
    请求体用原始 ``dict``：这样 ``confirm_replace_image_prompt`` 这类开关字段
    与既有 ``primary_protection`` 的口径一致（未知字段照旧被忽略，向后兼容）。
    """
    await get_or_404(db, Project, project_id, detail=entity_not_found("Project"))
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, list):
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_body", "message": "items 必须是数组。", "fix": "请按文档传入 items 数组。"},
        )
    try:
        payload = await save_asset_image_prompts(
            db,
            project_id=project_id,
            items=items,
            raw_body=body,
        )
    except HTTPException as exc:
        # 质量拦截 / 跨资产查重 / 覆盖保护都是**结构化中文错误**，
        # 必须原样进 meta.error，不能被全局处理器压成一行字符串。
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(payload)


@router.patch(
    "/{project_id}",
    response_model=ApiResponse[ProjectRead],
    summary="更新项目",
)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ProjectRead]:
    obj = await get_or_404(db, Project, project_id, detail=entity_not_found("Project"))
    update_data = body.model_dump(exclude_unset=True)
    visual_style = update_data.get("visual_style", obj.visual_style)
    style = update_data.get("style", obj.style)
    if visual_style is not None and style is not None:
        try:
            _validate_project_style_combo(visual_style=visual_style, style=style)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    patch_model(obj, update_data)
    await flush_and_refresh(db, obj)
    return success_response(ProjectRead.model_validate(obj))


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[None],
    summary="删除项目",
)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_if_exists(db, Project, project_id)
    return empty_response()
