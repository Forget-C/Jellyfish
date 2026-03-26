"""提示词模板相关路由：CRUD。

业务规则：
- is_system=True 的记录禁止修改和删除（403）。
- is_default=True 的记录禁止删除（403）。
- 同一 category 下至多一条 is_default=True：创建/更新时将同 category 其余记录置为 False。
- id 由后端自动生成 UUID；is_system 不接受客户端传入（固定为 False）。
"""

from __future__ import annotations

import uuid
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.dependencies import get_db
from app.models.studio import PromptCategory, PromptTemplate
from app.schemas.common import ApiResponse, PaginatedData, paginated_response, success_response
from app.schemas.studio.prompts import (
    PromptCategoryOptionRead,
    PromptTemplateCreate,
    PromptTemplateRead,
    PromptTemplateUpdate,
)

router = APIRouter()

_ORDER_FIELDS = {"name", "category", "created_at", "updated_at"}
_PROMPT_CATEGORY_ZH: dict[PromptCategory, tuple[str, str]] = {
    # 用于提交给图片模型的提示词
    PromptCategory.frame_head_image: ("首帧图片", "用于生成首帧图片的提示词"),
    PromptCategory.frame_tail_image: ("尾帧图片", "用于生成尾帧图片的提示词"),
    PromptCategory.frame_key_image: ("关键帧图片", "用于生成关键帧图片的提示词"),
    PromptCategory.character_image_front: ("角色正面图片", "用于生成角色正面图片的提示词"),
    PromptCategory.character_image_other: ("角色侧面/背面图片", "用于生成角色侧面或背面图片的提示词"),
    PromptCategory.actor_image_front: ("演员正面图片", "用于生成演员正面图片的提示词"),
    PromptCategory.actor_image_other: ("演员侧面/背面图片", "用于生成演员侧面或背面图片的提示词"),
    PromptCategory.prop_image_front: ("道具正面图片", "用于生成道具正面图片的提示词"),
    PromptCategory.prop_image_other: ("道具侧面/背面图片", "用于生成道具侧面或背面图片的提示词"),
    PromptCategory.scene_image_front: ("场景正面图片", "用于生成场景正面图片的提示词"),
    PromptCategory.scene_image_other: ("场景侧面/背面图片", "用于生成场景侧面或背面图片的提示词"),
    PromptCategory.costume_image_front: ("服装正面图片", "用于生成服装正面图片的提示词"),
    PromptCategory.costume_image_other: ("服装侧面/背面图片", "用于生成服装侧面或背面图片的提示词"),
    # 用于提交给文本模型的提示词
    PromptCategory.frame_head_prompt: ("首帧图片提示词", "用于生成首帧图片文案的提示词"),
    PromptCategory.frame_tail_prompt: ("尾帧图片提示词", "用于生成尾帧图片文案的提示词"),
    PromptCategory.frame_key_prompt: ("关键帧图片提示词", "用于生成关键帧图片文案的提示词"),
    PromptCategory.video_prompt: ("视频提示词", "用于视频生成的整体提示词"),
    PromptCategory.storyboard_prompt: ("分镜提示词", "用于分镜拆解与描述的提示词"),
    # 暂不启用
    # PromptCategory.combined: ("组合提示词", "用于组合多段提示词的模板"),
    # PromptCategory.bgm: ("背景音乐提示词", "用于生成背景音乐描述的提示词"),
    # PromptCategory.sfx: ("音效提示词", "用于生成音效描述的提示词"),
}


async def _clear_category_default(
    db: AsyncSession,
    *,
    category: PromptCategory,
    exclude_id: str | None = None,
) -> None:
    """将同 category 下所有记录的 is_default 置为 False（排除 exclude_id）。"""
    stmt = (
        update(PromptTemplate)
        .where(PromptTemplate.category == category, PromptTemplate.is_default.is_(True))
    )
    if exclude_id:
        stmt = stmt.where(PromptTemplate.id != exclude_id)
    await db.execute(stmt)


# ---------- 列表 ----------

@router.get(
    "",
    response_model=ApiResponse[PaginatedData[PromptTemplateRead]],
    summary="提示词模板列表（分页）",
)
async def list_prompt_templates(
    db: AsyncSession = Depends(get_db),
    category: PromptCategory | None = Query(None, description="按类别过滤"),
    q: str | None = Query(None, description="关键字，过滤 name"),
    is_default: bool | None = Query(None, description="过滤是否为默认"),
    is_system: bool | None = Query(None, description="过滤是否为系统预置"),
    order: str | None = Query(None),
    is_desc: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[PromptTemplateRead]]:
    stmt = select(PromptTemplate)
    if category is not None:
        stmt = stmt.where(PromptTemplate.category == category)
    if is_default is not None:
        stmt = stmt.where(PromptTemplate.is_default.is_(is_default))
    if is_system is not None:
        stmt = stmt.where(PromptTemplate.is_system.is_(is_system))
    stmt = apply_keyword_filter(stmt, q=q, fields=[PromptTemplate.name])
    stmt = apply_order(
        stmt,
        model=PromptTemplate,
        order=order,
        is_desc=is_desc,
        allow_fields=_ORDER_FIELDS,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    return paginated_response(
        [PromptTemplateRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get(
    "/categories",
    response_model=ApiResponse[list[PromptCategoryOptionRead]],
    summary="获取提示词类别枚举（含中文映射）",
)
async def list_prompt_categories() -> ApiResponse[list[PromptCategoryOptionRead]]:
    items: list[PromptCategoryOptionRead] = []
    for category in PromptCategory:
        label, description = _PROMPT_CATEGORY_ZH.get(category, (category.value, ""))
        items.append(PromptCategoryOptionRead(value=category, label=label, description=description))
    return success_response(items)


# ---------- 详情 ----------

@router.get(
    "/{template_id}",
    response_model=ApiResponse[PromptTemplateRead],
    summary="获取提示词模板详情",
)
async def get_prompt_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PromptTemplateRead]:
    obj = await db.get(PromptTemplate, template_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="PromptTemplate not found")
    return success_response(PromptTemplateRead.model_validate(obj))


# ---------- 创建 ----------

@router.post(
    "",
    response_model=ApiResponse[PromptTemplateRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建提示词模板",
)
async def create_prompt_template(
    body: PromptTemplateCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PromptTemplateRead]:
    # 若设为默认，先清除同类别其他默认
    if body.is_default:
        await _clear_category_default(db, category=body.category)

    obj = PromptTemplate(
        id=str(uuid.uuid4()),
        category=body.category,
        name=body.name,
        content=body.content,
        preview=body.preview,
        variables=body.variables,
        is_default=body.is_default,
        is_system=False,  # 客户端不可设置
    )
    db.add(obj)
    await db.flush()
    await db.refresh(obj)
    return success_response(PromptTemplateRead.model_validate(obj), code=201)


# ---------- 更新 ----------

@router.patch(
    "/{template_id}",
    response_model=ApiResponse[PromptTemplateRead],
    summary="局部更新提示词模板",
)
async def update_prompt_template(
    template_id: str,
    body: PromptTemplateUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[PromptTemplateRead]:
    obj = await db.get(PromptTemplate, template_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="PromptTemplate not found")
    if obj.is_system:
        raise HTTPException(status_code=403, detail="系统预置提示词不可修改")

    # 若将当前记录设为默认，先清除同类别其他默认
    if body.is_default is True:
        await _clear_category_default(db, category=cast(PromptCategory, cast(object, obj.category)), exclude_id=template_id)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(obj, field, value)

    await db.flush()
    await db.refresh(obj)
    return success_response(PromptTemplateRead.model_validate(obj))


# ---------- 删除 ----------

@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除提示词模板",
)
async def delete_prompt_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    obj = await db.get(PromptTemplate, template_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="PromptTemplate not found")
    if obj.is_system:
        raise HTTPException(status_code=403, detail="系统预置提示词不可删除")
    if obj.is_default:
        raise HTTPException(status_code=403, detail="默认提示词不可删除，请先将其他提示词设为默认")
    await db.delete(obj)

