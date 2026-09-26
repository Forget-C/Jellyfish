"""镜头细节服务：ShotDetail 的分页查询与 CRUD。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, paginate
from app.models.studio import Scene, Shot, ShotDetail
from app.models.types import CameraAngle, CameraMovement, CameraShotType, VFXType
from app.schemas.common import ApiResponse, PaginatedData, paginated_response
from app.schemas.studio.shots import ShotDetailCreate, ShotDetailRead, ShotDetailUpdate
from app.services.studio.product_guardrails import (
    validate_product_text_fields,
    validate_video_prompt_source,
)
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    flush_and_refresh,
    get_or_404,
    patch_model,
    require_entity,
    require_optional_entity,
)
from app.services.studio.shot_extracted_candidates import mark_linked_by_name, mark_pending_by_linked_entity


async def list_paginated(
    db: AsyncSession,
    *,
    shot_id: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
    allow_fields: set[str],
) -> ApiResponse[PaginatedData[ShotDetailRead]]:
    """分页查询镜头细节。"""
    stmt = select(ShotDetail)
    if shot_id is not None:
        stmt = stmt.where(ShotDetail.id == shot_id)
    stmt = apply_order(
        stmt,
        model=ShotDetail,
        order=order,
        is_desc=is_desc,
        allow_fields=allow_fields,
        default="id",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    return paginated_response(
        [ShotDetailRead.model_validate(x) for x in items],
        page=page,
        page_size=page_size,
        total=total,
    )


def build_default_detail(shot_id: str) -> ShotDetail:
    """给新建镜头配一份默认细节行（与「AI 拆分镜」写入时的取值保持一致）。

    为什么必须有这一步：`ShotDetail` 与 `Shot` 是 1:1 共享主键，但
    `POST /studio/shots`（页面「创建分镜」）此前**只写 Shot**，于是手工建的镜头
    永远没有细节行 —— 后续整条链路（PATCH 提示词、音频绑定、参考帧创建、
    就绪判定）全部 404 / 400，而页面上看不出原因。默认值与
    `script_division` 里拆分镜时的取值相同，保证两条入口产物一致。
    """
    return ShotDetail(
        id=shot_id,
        camera_shot=CameraShotType.ms,
        angle=CameraAngle.eye_level,
        movement=CameraMovement.static,
        follow_atmosphere=True,
        vfx_type=VFXType.none,
        duration=4,
    )


async def create(
    db: AsyncSession,
    *,
    body: ShotDetailCreate,
) -> ShotDetail:
    """创建镜头细节。"""
    await ensure_not_exists(db, ShotDetail, body.id, detail=entity_already_exists("ShotDetail"))
    await require_entity(db, Shot, body.id, detail=entity_not_found("Shot"), status_code=400)
    await require_optional_entity(db, Scene, body.scene_id, detail=entity_not_found("Scene"), status_code=400)
    return await create_and_refresh(db, ShotDetail(**body.model_dump()))


async def get(
    db: AsyncSession,
    *,
    shot_id: str,
) -> ShotDetail:
    """获取镜头细节。"""
    return await get_or_404(db, ShotDetail, shot_id, detail=entity_not_found("ShotDetail"))


async def update(
    db: AsyncSession,
    *,
    shot_id: str,
    body: ShotDetailUpdate,
) -> ShotDetail:
    """更新镜头细节。"""
    obj = await get_or_404(db, ShotDetail, shot_id, detail=entity_not_found("ShotDetail"))
    update_data = body.model_dump(exclude_unset=True)

    # 产物护栏（见 product_guardrails）：
    # 1) 来源必须是真实来源，模板拼装不得冒用 llm；
    # 2) 演练占位文本不得写入正式产物字段。
    if "video_prompt_source" in update_data:
        update_data["video_prompt_source"] = validate_video_prompt_source(update_data.get("video_prompt_source"))
    validate_product_text_fields(update_data)

    # 声音两个字段互斥（用户要求"无需声音的镜头允许明确选择"）：
    # - 绑定/更换音频 → 自动把"无需声音"标记清掉；
    # - 明确标记"无需声音" → 自动解绑音频。
    # 只在一侧被显式修改时动手，避免 PATCH 其它字段时误改声音状态。
    if "audio_opt_out" in update_data and update_data.get("audio_opt_out"):
        update_data["audio_file_id"] = None
    elif "audio_file_id" in update_data and update_data.get("audio_file_id"):
        update_data["audio_opt_out"] = False

    old_scene_id = obj.scene_id
    scene_obj = None
    if "scene_id" in update_data:
        scene_obj = await require_optional_entity(
            db,
            Scene,
            update_data["scene_id"],
            detail=entity_not_found("Scene"),
            status_code=400,
        )
    patch_model(obj, update_data)
    obj = await flush_and_refresh(db, obj)
    if "scene_id" in update_data and old_scene_id and old_scene_id != obj.scene_id:
        await mark_pending_by_linked_entity(
            db,
            shot_id=shot_id,
            candidate_type="scene",
            linked_entity_id=old_scene_id,
        )
    if scene_obj is not None:
        await mark_linked_by_name(
            db,
            shot_id=shot_id,
            candidate_type="scene",
            candidate_name=scene_obj.name,
            linked_entity_id=scene_obj.id,
        )
    return obj


async def delete(
    db: AsyncSession,
    *,
    shot_id: str,
) -> None:
    """删除镜头细节。"""
    await delete_if_exists(db, ShotDetail, shot_id)
