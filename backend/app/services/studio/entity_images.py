"""Studio 实体图片 CRUD。

写入侧**不静默替换定版**（用户明确要求）：两条写入路径（create / update）在会顶掉
既有定版图时必须由调用方显式确认（请求体里带 ``confirm_replace_primary=true``），
否则抛结构化 409。判定与摘要只有一份实现，见 ``app/services/studio/primary_protection.py``。

写入侧**也不返回 500 给「同槽位重复建图」**：五张资产图片表都有
``UNIQUE (资产ID, quality_level, view_angle)``（``uq_*_images_quality_angle``），
重复建同一槽位以前会让完整性错误穿透到全局处理器变成
``500 Internal server error``（实测日志：``IntegrityError: UNIQUE constraint failed:
character_images.character_id, quality_level, view_angle``）。这里把它就地转成
结构化 409（:class:`EntityImageSlotConflict`，中文说明「该槽位已存在」+ 改法），
**其它**完整性错误照旧原样抛出，绝不吞。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, paginate
from app.services.common import entity_not_found
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.primary_protection import (
    PrimaryImageSummary,
    confirm_replace_requested,
    ensure_primary_not_silently_replaced,
)

IMAGE_ORDER_FIELDS = {"id", "quality_level", "view_angle", "created_at", "updated_at"}

#: 同槽位冲突的结构化错误码（前端据此区分「换/更新槽位」而不是「重试」）。
SLOT_CONFLICT_CODE = "entity_image_slot_exists"

#: 图片槽位唯一约束的识别特征：五张表同构，命名约束里都带 ``quality_angle``；
#: SQLite 的报错文本则直接列出两列名。两条都认，避免不同后端只认一半。
_SLOT_CONSTRAINT_HINT = "quality_angle"
_SLOT_COLUMNS = ("quality_level", "view_angle")


class EntityImageSlotConflict(HTTPException):
    """同一资产下「精度等级 + 视角」槽位已存在 → 结构化 409。

    作为 ``HTTPException`` 子类，未特别处理的调用方拿到的仍是同一个 409 与
    ``exc.detail``；需要把明细放进 ``meta.error`` 的路由（``/studio/entities/...``）
    可以单独 catch 这个类型，与 ``PrimaryImageReplaceRequired`` 同一套做法。
    """

    def __init__(self, detail: dict[str, Any]) -> None:
        super().__init__(status_code=409, detail=detail)


def _is_slot_conflict(exc: IntegrityError) -> bool:
    """这个完整性错误是否为「同槽位重复建图」。

    只认唯一约束那一类：报错文本 / 约束名里出现槽位唯一约束的特征。
    不是（例如外键失败、非空约束、别的唯一约束）→ 调用方原样抛出。
    """
    origin = getattr(exc, "orig", None)
    diag = getattr(origin, "diag", None)
    parts = [
        str(origin or ""),
        str(exc),
        str(getattr(diag, "constraint_name", "") or ""),
    ]
    text = " ".join(parts).lower()
    if _SLOT_CONSTRAINT_HINT in text:
        return True
    return all(column in text for column in _SLOT_COLUMNS)


async def _find_slot_image_id(
    db: AsyncSession,
    *,
    spec: Any,
    entity_id: str,
    quality_level: str,
    view_angle: str,
) -> int | None:
    """查既有那一行的 id（查不到就返回 ``None``）；只用于给用户指路。"""
    id_field = getattr(spec.image_model, spec.id_field)
    stmt = select(spec.image_model.id).where(
        id_field == entity_id,
        spec.image_model.quality_level == quality_level,
        spec.image_model.view_angle == view_angle,
    )
    result = await db.execute(stmt)
    row = result.scalars().first()
    return int(row) if row is not None else None


def _slot_value(value: Any) -> str:
    """槽位字段 → 可读字符串。

    ``model_dump()`` 出来的是 ``str`` 混入的枚举成员，直接 ``str()`` 会得到
    ``AssetViewAngle.front`` 这种内部名（Python 3.11+ 的行为），用户看不懂；
    这里取枚举的 ``value``（``FRONT`` / ``LOW``）。
    """
    raw = getattr(value, "value", value)
    return str(raw).strip() if raw is not None else ""


async def _slot_conflict_detail(
    db: AsyncSession,
    *,
    spec: Any,
    entity_type: str,
    entity_id: str,
    parsed: dict[str, Any],
    entity_name: str = "",
) -> dict[str, Any]:
    """同槽位冲突 → 结构化 409 明细（中文、可操作、明确"没写任何一行"）。"""
    quality_level = _slot_value(parsed.get("quality_level"))
    view_angle = _slot_value(parsed.get("view_angle"))
    existing_id = await _find_slot_image_id(
        db,
        spec=spec,
        entity_id=entity_id,
        quality_level=quality_level,
        view_angle=view_angle,
    )
    label = f"{entity_name or entity_id}"
    where = f"{label}（{entity_type}/{entity_id}）"
    return {
        "code": SLOT_CONFLICT_CODE,
        "message": (
            f"该槽位已存在：{where} 的「{quality_level} / {view_angle}」槽位已经有一行图片记录，"
            "同一资产下「精度等级 + 视角」必须唯一，所以没有新建第二行。"
            "请改为**更新既有槽位**，或换一个精度 / 视角组合再建。"
        ),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "quality_level": quality_level,
        "view_angle": view_angle,
        "existing_image_id": existing_id,
        "how_to_fix": (
            f"① 更新既有槽位：PATCH /api/v1/studio/entities/{entity_type}/{entity_id}/images/"
            f"{existing_id if existing_id is not None else '{existing_image_id}'}"
            "（例如换 file_id / 改 is_primary）；"
            "② 或换一个槽位组合（quality_level × view_angle）再 POST 新建。"
        ),
        "note": "拒绝发生在写入之前：没有新建任何图片行，也没有改动既有槽位。",
        "paid_call_made": False,
    }


def _with_replaced_primary(
    payload: dict[str, Any], replaced: PrimaryImageSummary | None
) -> dict[str, Any]:
    """把「本次替换掉了哪张旧定版图」附到读模型结果上（**只增字段**，脱敏摘要）。

    与 ``/studio/image-pipeline/adopt`` 的 ``replaced_primary`` 同形，页面可以共用一套展示。
    """
    return {**payload, "replaced_primary": replaced.to_read() if replaced else None}


async def list_entity_images_paginated(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    order: str | None,
    is_desc: bool,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    spec = entity_spec(entity_type)
    parent = await db.get(spec.model, entity_id)
    if parent is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))

    id_field = getattr(spec.image_model, spec.id_field)
    stmt = select(spec.image_model).where(id_field == entity_id)
    stmt = apply_order(
        stmt,
        model=spec.image_model,
        order=order,
        is_desc=is_desc,
        allow_fields=IMAGE_ORDER_FIELDS,
        default="id",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)
    payload = [spec.image_read_model.model_validate(x).model_dump() for x in items]
    return payload, total


async def create_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    parent = await db.get(spec.model, entity_id)
    if parent is None:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.model.__name__))
    # 先把名字取成普通字符串：冲突分支要回滚到保存点，届时 ORM 实例可能已过期，
    # 在异步会话里再读属性会炸（MissingGreenlet）。
    entity_name = str(getattr(parent, "name", "") or "")

    parsed = spec.image_create_model.model_validate(body).model_dump()

    # 定版保护：新建的这一行若同时要设为定版，既有定版图就会被顶掉 → 必须显式确认。
    # 判定在 add/flush **之前**：未确认时库里一行都不改。
    replaced_primary = await ensure_primary_not_silently_replaced(
        db,
        image_model=spec.image_model,
        id_field=spec.id_field,
        entity_type=entity_type_norm,
        entity_id=entity_id,
        target_image_id=None,  # 本次会新建一行，不可能是既有定版那一行
        becomes_primary=parsed.get("is_primary") is True,
        replaces_target_file=False,
        confirm_replace_primary=confirm_replace_requested(body),
    )

    obj = spec.image_model(**{spec.id_field: entity_id, **parsed})
    try:
        # 写入放在 SAVEPOINT 里：唯一约束冲突时只回滚**这一次插入**，调用方在同一事务里
        # 已经做过的工作不受牵连；回到保存点之后会话仍然可用，才能回查「既有那一行」。
        async with db.begin_nested():
            db.add(obj)
            await db.flush()
    except IntegrityError as exc:
        # 同槽位重复建图：唯一约束 (资产ID, quality_level, view_angle) 冲突
        # （实测报错原文：UNIQUE constraint failed: character_images.character_id,
        # quality_level, view_angle）。转成结构化 409；**不是**这一种冲突就原样抛出。
        if not _is_slot_conflict(exc):
            raise
        raise EntityImageSlotConflict(
            await _slot_conflict_detail(
                db,
                spec=spec,
                entity_type=entity_type_norm,
                entity_id=entity_id,
                parsed=parsed,
                entity_name=entity_name,
            )
        ) from exc
    await db.refresh(obj)

    if getattr(obj, "is_primary", False):
        # 同一资产至多一张定版主图：把其余行清掉。对所有资产类型生效
        # （此前只对 character 生效，其他四类图片表当时还没有 is_primary 列）。
        parent_field = getattr(spec.image_model, spec.id_field)
        stmt = (
            spec.image_model.__table__.update()
            .where(parent_field == entity_id, spec.image_model.id != obj.id)
            .values(is_primary=False)
        )
        await db.execute(stmt)
        await db.refresh(obj)

    return _with_replaced_primary(
        spec.image_read_model.model_validate(obj).model_dump(), replaced_primary
    )


async def update_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    image_id: int,
    body: dict[str, Any],
) -> dict[str, Any]:
    entity_type_norm = normalize_entity_type(entity_type)
    spec = entity_spec(entity_type_norm)
    obj = await db.get(spec.image_model, image_id)
    if obj is None or getattr(obj, spec.id_field) != entity_id:
        raise HTTPException(status_code=404, detail=entity_not_found(spec.image_model.__name__))

    update_data = spec.image_update_model.model_validate(body).model_dump(exclude_unset=True)

    # 定版保护：两种情况会顶掉既有定版图 ——
    #   1) 把这一行设成定版（原定版被降级）；
    #   2) 直接改**定版那一行**的 file_id（把定版图换成另一张）。
    # 显式把 is_primary 关掉（不设新版）不算替换，照旧放行。
    # 判定在 setattr/flush **之前**：未确认时库里一行都不改。
    new_file_id = str(update_data.get("file_id") or "").strip()
    replaced_primary = await ensure_primary_not_silently_replaced(
        db,
        image_model=spec.image_model,
        id_field=spec.id_field,
        entity_type=entity_type_norm,
        entity_id=entity_id,
        target_image_id=obj.id,
        becomes_primary=update_data.get("is_primary") is True,
        replaces_target_file=bool(new_file_id)
        and new_file_id != str(getattr(obj, "file_id", "") or "").strip(),
        confirm_replace_primary=confirm_replace_requested(body),
    )

    for key, value in update_data.items():
        setattr(obj, key, value)
    await db.flush()
    await db.refresh(obj)

    if update_data.get("is_primary") is True:
        parent_field = getattr(spec.image_model, spec.id_field)
        stmt = (
            spec.image_model.__table__.update()
            .where(parent_field == entity_id, spec.image_model.id != obj.id)
            .values(is_primary=False)
        )
        await db.execute(stmt)
        await db.refresh(obj)
    elif update_data.get("is_primary") is False:
        await db.refresh(obj)

    return _with_replaced_primary(
        spec.image_read_model.model_validate(obj).model_dump(), replaced_primary
    )


async def delete_entity_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    image_id: int,
) -> None:
    spec = entity_spec(entity_type)
    obj = await db.get(spec.image_model, image_id)
    if obj is None or getattr(obj, spec.id_field) != entity_id:
        return
    await db.delete(obj)
    await db.flush()
