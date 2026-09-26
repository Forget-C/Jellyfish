"""Studio 实体主资源 CRUD。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, paginate
from app.models.studio import Actor, Chapter, Costume, Project, ProjectActorLink, Shot, ShotCharacterLink
from app.schemas.studio.cast import ShotCharacterLinkCreate
from app.services.studio.asset_prompt_quality import (
    ensure_image_prompts_not_silently_replaced,
    validate_asset_image_prompts,
)
from app.services.studio.product_guardrails import validate_product_text_fields
from app.services.common import entity_already_exists, entity_not_found
from app.services.studio.entity_specs import DEFAULT_VIEW_ANGLES, LINK_MODEL_BY_ENTITY, entity_spec, normalize_entity_type
from app.services.studio.entity_thumbnails import resolve_thumbnails
from app.services.studio.shot_character_links import upsert as upsert_shot_character_link
from app.services.studio.shot_extracted_candidates import mark_linked_by_name
from app.utils.project_links import upsert_project_link

ENTITY_ORDER_FIELDS = {"name", "style", "visual_style", "created_at", "updated_at"}


def _asset_read_payload(obj: Any, thumbnail: str) -> dict[str, Any]:
    """场景/道具/服装/演员的读模型。

    这里显式下发 `image_prompts`：角色（`character_read_payload`）本来就有这一列，
    但资产类此前没有，导致「资产准备」的状态判定在场景/道具/服装上永远读不到
    图片提示词（只能显示「无法判定」）。补上之后，四类资产的
    `has_image_prompt / has_image / has_primary` 可以走**同一套数据源**。
    """
    return {
        "id": obj.id,
        "name": obj.name,
        "description": obj.description,
        "tags": obj.tags or [],
        "prompt_template_id": obj.prompt_template_id,
        "view_count": obj.view_count,
        "style": obj.style,
        "visual_style": obj.visual_style,
        "thumbnail": thumbnail,
        "image_prompts": dict(getattr(obj, "image_prompts", None) or {}),
    }



async def _ensure_character_actor_link(db: AsyncSession, *, obj: Any) -> None:
    """角色引用演员时，**在同一事务内**幂等确保「演员 ↔ 本项目」的项目关联存在。

    为什么要放在后端：前端「从演员库选择」只应把 `actor_id` 写进角色，
    不能提前写关联（用户可能只是看看、或随后取消创建）。角色一旦落库，
    它引用的演员就必须真的属于本项目，否则后续按项目取演员/形象的地方会拿不到。
    因此这里在创建/更新的同一事务里补 `ProjectActorLink`：
      - 幂等：`upsert_project_link` 会先精确匹配、再补全 NULL 维度、最后才新建；
      - 事务性：这里只 flush，真正的 commit 在请求层（`get_db`）；
        任何异常都会让整个请求回滚，角色与关联要么都成功、要么都不落库。
    """
    actor_id = getattr(obj, "actor_id", None)
    project_id = getattr(obj, "project_id", None)
    if not actor_id or not project_id:
        return
    await upsert_project_link(
        db,
        model=ProjectActorLink,
        asset_field="actor_id",
        asset_id=actor_id,
        project_id=project_id,
        chapter_id=None,
        shot_id=None,
    )

async def list_entities_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    q: str | None,
    style: str | None,
    visual_style: str | None,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    stmt = select(spec.model)
    stmt = apply_keyword_filter(stmt, q=q, fields=[spec.model.name, spec.model.description])
    if style:
        stmt = stmt.where(getattr(spec.model, "style") == style)
    if visual_style:
        stmt = stmt.where(getattr(spec.model, "visual_style") == visual_style)
    stmt = apply_order(
        stmt,
        model=spec.model,
        order=order,
        is_desc=is_desc,
        allow_fields=ENTITY_ORDER_FIELDS,
        default="created_at",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    thumbnails = await resolve_thumbnails(
        db,
        image_model=spec.image_model,
        parent_field_name=spec.id_field,
        parent_ids=[item.id for item in items],
    )
    payload: list[dict[str, Any]] = []
    for item in items:
        thumbnail = thumbnails.get(item.id, "")
        if entity_type_norm in {"actor", "character"}:
            read_model = spec.read_model
            payload.append(read_model.model_validate(item).model_copy(update={"thumbnail": thumbnail}).model_dump())
        else:
            payload.append(_asset_read_payload(item, thumbnail))
    return payload, total


async def create_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    parsed = spec.create_model.model_validate(body)
    data = parsed.model_dump()
    # 资产级图片提示词属于正式产物字段：禁止把演练占位文本写进去
    validate_product_text_fields(data)
    # 再拦"空话 / 空提示词 / 只有资产名+通用摄影词"：这类内容不得被保存成「提示词已就绪」，
    # 更不得进入批量出图（见 asset_prompt_quality 的模块说明）。
    validate_asset_image_prompts(
        data.get("image_prompts"),
        asset_key=str(data.get("id") or ""),
        asset_name=str(data.get("name") or ""),
        asset_type=entity_type_norm,
    )

    link_project_id: str | None = None
    link_chapter_id: str | None = None
    link_shot_id: str | None = None
    if entity_type_norm in LINK_MODEL_BY_ENTITY:
        link_project_id = data.pop("project_id", None)
        link_chapter_id = data.pop("chapter_id", None)
        link_shot_id = data.pop("shot_id", None)
    elif entity_type_norm == "character":
        link_project_id = data.get("project_id")
        link_chapter_id = data.pop("chapter_id", None)
        link_shot_id = data.pop("shot_id", None)

    exists = await db.get(spec.model, data["id"])
    if exists is not None:
        raise HTTPException(status_code=400, detail=entity_already_exists(spec.model.__name__))

    if entity_type_norm == "character":
        if await db.get(Project, data["project_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Project"))
        if data.get("actor_id") and await db.get(Actor, data["actor_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Actor"))
        if data.get("costume_id") and await db.get(Costume, data["costume_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Costume"))
        chapter: Chapter | None = None
        shot: Shot | None = None
        if link_chapter_id is not None:
            chapter = await db.get(Chapter, link_chapter_id)
            if chapter is None:
                raise HTTPException(status_code=400, detail=entity_not_found("Chapter"))
            if chapter.project_id != data["project_id"]:
                raise HTTPException(status_code=400, detail="Chapter does not belong to the same project")
        if link_shot_id is not None:
            shot = await db.get(Shot, link_shot_id)
            if shot is None:
                raise HTTPException(status_code=400, detail=entity_not_found("Shot"))
            shot_chapter = await db.get(Chapter, shot.chapter_id)
            if shot_chapter is None:
                raise HTTPException(status_code=400, detail=f"{entity_not_found('Chapter')} for shot")
            if shot_chapter.project_id != data["project_id"]:
                raise HTTPException(status_code=400, detail="Shot does not belong to the same project")
            if chapter is not None and shot.chapter_id != chapter.id:
                raise HTTPException(status_code=400, detail="Shot does not belong to the specified chapter")

    obj = spec.model(**data)
    db.add(obj)
    await db.flush()
    await db.refresh(obj)

    if entity_type_norm in {"actor", "scene", "prop", "costume", "product"}:
        count = int(getattr(obj, "view_count", 1) or 1)
        angles = list(DEFAULT_VIEW_ANGLES[: min(max(count, 0), len(DEFAULT_VIEW_ANGLES))])
        for angle in angles:
            db.add(spec.image_model(**{spec.id_field: obj.id, "view_angle": angle}))
        if angles:
            await db.flush()

    if entity_type_norm == "character":
        # 角色引用演员 → 同一事务内幂等确保项目关联（失败整体回滚）
        await _ensure_character_actor_link(db, obj=obj)

    if link_project_id is not None and entity_type_norm in LINK_MODEL_BY_ENTITY:
        link_model, asset_field = LINK_MODEL_BY_ENTITY[entity_type_norm]
        await upsert_project_link(
            db,
            model=link_model,
            asset_field=asset_field,  # type: ignore[arg-type]
            asset_id=obj.id,
            project_id=link_project_id,
            chapter_id=link_chapter_id,
            shot_id=link_shot_id,
        )

    if link_shot_id is not None and entity_type_norm in {"scene", "prop", "costume", "product"}:
        # 就地新建（带 shot_id）也要把提取候选回写为 linked：
        # character 走 upsert_shot_character_link → 内部已回写；scene/prop/costume 走的是通用
        # upsert_project_link（纯业务关联，不管候选），于是"新建并关联"之后候选仍是 pending，
        # 镜头就永远 ready 不了。
        await mark_linked_by_name(
            db,
            shot_id=link_shot_id,
            candidate_type=entity_type_norm,
            candidate_name=str(getattr(obj, "name", "") or ""),
            linked_entity_id=str(obj.id),
        )

    if entity_type_norm == "character" and link_shot_id is not None:
        existing_indexes_stmt = (
            select(ShotCharacterLink.index)
            .where(ShotCharacterLink.shot_id == link_shot_id)
            .order_by(ShotCharacterLink.index.desc())
            .limit(1)
        )
        max_index = (await db.execute(existing_indexes_stmt)).scalars().first()
        await upsert_shot_character_link(
            db,
            body=ShotCharacterLinkCreate(
                shot_id=link_shot_id,
                character_id=obj.id,
                index=(max_index if isinstance(max_index, int) else -1) + 1,
                note="",
            ),
        )

    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        payload = read_model.model_validate(obj).model_dump()
        payload["thumbnail"] = ""
        return payload
    return _asset_read_payload(obj, "")


async def get_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    thumbnails = await resolve_thumbnails(
        db,
        image_model=spec.image_model,
        parent_field_name=spec.id_field,
        parent_ids=[entity_id],
    )
    thumbnail = thumbnails.get(entity_id, "")
    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        return read_model.model_validate(obj).model_copy(update={"thumbnail": thumbnail}).model_dump()
    return _asset_read_payload(obj, thumbnail)


async def update_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    update_data = spec.update_model.model_validate(body).model_dump(exclude_unset=True)
    # 资产级图片提示词属于正式产物字段：禁止把演练占位文本写进去
    validate_product_text_fields(update_data)
    if "image_prompts" in update_data:
        # 「不许自动覆盖」+「质量拦截」：两条都必须在 setattr 之前判定，
        # 这样 409/422 时库里一行都没改。
        ensure_image_prompts_not_silently_replaced(
            getattr(obj, "image_prompts", None),
            update_data.get("image_prompts"),
            raw_body=body,
            asset_name=str(getattr(obj, "name", "") or ""),
        )
        validate_asset_image_prompts(
            update_data.get("image_prompts"),
            asset_key=str(entity_id),
            asset_name=str(getattr(obj, "name", "") or ""),
            asset_type=entity_type_norm,
        )
    if entity_type_norm == "character":
        if "project_id" in update_data and await db.get(Project, update_data["project_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Project"))
        if "actor_id" in update_data and update_data["actor_id"] is not None and await db.get(Actor, update_data["actor_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Actor"))
        if "costume_id" in update_data and update_data["costume_id"] is not None and await db.get(Costume, update_data["costume_id"]) is None:
            raise HTTPException(status_code=400, detail=entity_not_found("Costume"))

    for key, value in update_data.items():
        setattr(obj, key, value)
    await db.flush()
    await db.refresh(obj)

    if entity_type_norm == "character":
        # 改角色时同样确保关联（幂等；不会删除其它演员的历史关联）
        await _ensure_character_actor_link(db, obj=obj)

    if entity_type_norm in {"actor", "character"}:
        read_model = spec.read_model
        payload = read_model.model_validate(obj).model_dump()
        payload["thumbnail"] = ""
        return payload
    return _asset_read_payload(obj, "")


async def delete_entity(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
) -> None:
    spec = entity_spec(entity_type)
    obj = await db.get(spec.model, entity_id)
    if obj is None:
        return
    await db.delete(obj)
    await db.flush()
