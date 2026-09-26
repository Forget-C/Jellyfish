"""定版主图（``is_primary``）保护：**只有一份**判定实现。

用户要求：「**不得静默替换定版**」。改动前两条写入路径都会无条件顶掉定版图：

- ``POST /studio/image-pipeline/adopt``：``set_primary`` 在请求 schema 里默认 ``true``，
  且不传 ``image_id`` 时复用该资产的**第一个槽位**（``id asc``）——第二次采纳会把原定版
  那一行的 ``file_id`` 直接换掉，界面上看不出任何确认；
- ``POST/PATCH /studio/entities/{type}/{id}/images``：写 ``is_primary=True`` 的路径会
  **无条件**把同资产其它行的 ``is_primary`` 清掉，没有一处拒绝覆盖。

本模块提供唯一的判定与只读摘要实现，三条写入路径共用（``adopt`` / ``entity_images``）：

- :func:`find_primary_image`：读该资产「**已定版且已绑定图片**」的槽位
  （``is_primary=True`` 且 ``file_id`` 非空）；
- :func:`ensure_primary_not_silently_replaced`：判断本次写入会不会顶掉这张定版图；
  会顶掉而调用方没有显式传 ``confirm_replace_primary=true`` → 抛结构化 **409**，
  ``detail`` 里带**将被替换那张图的只读摘要**。

**调用时机是硬约束**：必须在任何下载 / 建行 / 写入**之前**调用——这样 409 时库里一行都没改
（``/adopt`` 会先把远端图片下载入库，所以它必须把槽位解析与本次判定提到下载之前）。

摘要口径（脱敏）：只给「槽位 id / 文件名 / 是否 OSS 公网地址」三样，**不出现**任何凭证或密钥、
**不出现**本机绝对路径、**不出现**对象存储的完整（可能带签名的）地址。

只读侧（``project_asset_readiness.has_primary`` 等）**保持原有宽容口径**，本模块不改它。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import FileItem

#: 结构化错误码：已有定版图、调用方没有显式确认替换
PRIMARY_REPLACE_REQUIRED_CODE = "primary_image_replace_required"

#: 调用方显式确认替换定版的请求字段名（``/adopt`` 走 schema，实体图片走原始 body）
CONFIRM_FIELD = "confirm_replace_primary"

#: 文件名摘要的长度上限（只用于展示，避免超长名字把响应撑爆）
_MAX_FILE_NAME_LENGTH = 120


@dataclass(frozen=True, slots=True)
class PrimaryImageSummary:
    """一张定版图的**只读摘要**（给用户看「即将被替换的是哪张」）。

    ``file_id`` 只在本进程内部用（测试断言、定位），``to_read()`` 里**不输出**它：
    对外只需要「槽位 id / 文件名 / 是否 OSS 公网地址」。
    """

    image_id: int
    file_id: str = ""
    file_name: str = ""
    url_is_public: bool = False

    def to_read(self) -> dict[str, Any]:
        """对外摘要（脱敏）：不含 file_id、不含凭证、不含本机绝对路径。"""
        return {
            "image_id": self.image_id,
            "file_name": self.file_name,
            "url_is_public": self.url_is_public,
        }


class PrimaryImageReplaceRequired(HTTPException):
    """已有定版图、调用方没有显式确认替换 → 结构化 409。

    作为 ``HTTPException`` 子类，未特别处理的调用方（例如 ``/adopt`` 路由的
    ``except HTTPException``）拿到的仍是同一个 409 与 ``exc.detail``；
    需要把明细放进 ``meta.error`` 的路由可以单独 catch 这个类型。
    """

    def __init__(self, detail: dict[str, Any]) -> None:
        super().__init__(status_code=409, detail=detail)


def confirm_replace_requested(body: Mapping[str, Any] | None) -> bool:
    """从**原始请求体**读「确认替换定版」开关。

    为什么不写进 ``AssetImageCreate/Update``：那两个 schema 的 ``model_dump()`` 会被直接拿去
    构造 ORM 行（``spec.image_model(**parsed)``），多一个字段就会变成非法关键字参数。
    这里是显式读取，未知字段照旧被 pydantic 忽略，**向后兼容**。
    字符串 ``"true"`` / ``"1"`` / ``"yes"`` / ``"on"`` 也认（表单/前端拼串时不至于静默失效）。
    """
    if not isinstance(body, Mapping):
        return False
    value = body.get(CONFIRM_FIELD)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _safe_file_name(name: Any) -> str:
    """文件名摘要：只保留最后一段（名字里不该出现本机绝对路径）。"""
    text = str(name or "").strip()
    if not text:
        return ""
    for separator in ("/", "\\"):
        if separator in text:
            text = text.rsplit(separator, 1)[-1]
    return text[:_MAX_FILE_NAME_LENGTH]


def _is_public_oss_address(*candidates: Any) -> bool:
    """是否为**匿名公网可取**的 http(s) 地址（本机 / 内网 / 本地相对路径都不算）。

    判定只有一份：复用 ``reference_preflight.is_loopback_or_private_url``（延迟导入，
    避免 studio 通用模块在导入期牵出整条出图管线包）。异常安全：解析不了就按「不是公网」处理，
    这里只用于展示，宁可否认也不要谎报。
    """
    from app.services.studio.image_pipeline.reference_preflight import (  # noqa: PLC0415
        is_loopback_or_private_url,
    )

    for value in candidates:
        text = str(value or "").strip()
        if not text.lower().startswith(("http://", "https://")):
            continue
        try:
            if not is_loopback_or_private_url(text):
                return True
        except Exception:  # noqa: BLE001 - 只用于摘要展示，判不出来就当不是公网
            continue
    return False


async def summarize_slot(db: AsyncSession, *, slot: Any) -> PrimaryImageSummary:
    """把一个图片槽位行整理成定版图只读摘要（文件名取自它绑定的 ``files`` 行）。"""
    file_id = str(getattr(slot, "file_id", "") or "").strip()
    file_name = ""
    url_is_public = False
    if file_id:
        file_row = await db.get(FileItem, file_id)
        if file_row is not None:
            file_name = _safe_file_name(getattr(file_row, "name", ""))
            url_is_public = _is_public_oss_address(
                getattr(file_row, "thumbnail", ""),
                getattr(file_row, "storage_key", ""),
            )
    return PrimaryImageSummary(
        image_id=int(getattr(slot, "id")),
        file_id=file_id,
        file_name=file_name,
        url_is_public=url_is_public,
    )


async def find_primary_image(
    db: AsyncSession,
    *,
    image_model: Any,
    id_field: str,
    entity_id: str,
) -> PrimaryImageSummary | None:
    """该资产当前**已定版且已绑定图片**的槽位（``is_primary=True`` 且 ``file_id`` 非空）。

    口径与用户要求一致：「有定版图」＝ ``is_primary=true`` **且** ``file_id`` 非空。
    只有 ``is_primary=True`` 而没绑图的空槽位不算定版图（不能拿来说明「要替换哪张」）。
    """
    parent_field = getattr(image_model, id_field)
    stmt = (
        select(image_model)
        .where(parent_field == entity_id)
        .where(getattr(image_model, "is_primary").is_(True))
        .order_by(image_model.id.asc())
    )
    for slot in (await db.execute(stmt)).scalars().all():
        if str(getattr(slot, "file_id", "") or "").strip():
            return await summarize_slot(db, slot=slot)
    return None


def build_replace_required_detail(
    *,
    entity_type: str,
    entity_id: str,
    existing: PrimaryImageSummary,
    target_image_id: int | None,
) -> dict[str, Any]:
    """409 的结构化明细（``meta.error`` 的形状）。"""
    label = existing.file_name or "未命名图片"
    return {
        "code": PRIMARY_REPLACE_REQUIRED_CODE,
        "message": (
            f"该资产已有定版图（槽位 #{existing.image_id}「{label}」），要替换请显式确认："
            f"在同一次请求里带上 {CONFIRM_FIELD}=true。本次未做任何修改。"
        ),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "existing_primary": existing.to_read(),
        "target_image_id": target_image_id,
        "confirm_field": CONFIRM_FIELD,
        "how_to_confirm": (
            f"确要替换：重发同一次请求并带上 {CONFIRM_FIELD}=true"
            "（旧定版图对应的文件记录不会被删除，只是不再作为该资产的定版）。"
            "不想动定版：把 image_id 指向另一个槽位，并保持 set_primary=false。"
        ),
        "note": "拒绝发生在任何写入之前：这一次请求没有改动数据库里的任何一行。",
    }


async def ensure_primary_not_silently_replaced(
    db: AsyncSession,
    *,
    image_model: Any,
    id_field: str,
    entity_type: str,
    entity_id: str,
    target_image_id: int | None = None,
    becomes_primary: bool = False,
    replaces_target_file: bool = False,
    confirm_replace_primary: bool = False,
) -> PrimaryImageSummary | None:
    """**唯一**的「已有定版图能否被顶掉」判定。三条写入路径共用这一处。

    判定（``existing`` = 该资产当前的定版图，可能为 ``None``）：

    - ``existing`` 为空 → 没有定版图可顶，直接放行（返回 ``None``）；
    - ``becomes_primary=True`` 且目标槽位**不是** ``existing`` → 本次会把定版换成另一张 → 要确认；
    - 目标槽位**就是** ``existing`` 且 ``replaces_target_file=True``（会用新图覆盖它）
      → 等于把定版图本身换掉 → 要确认
      （即使 ``becomes_primary=False`` 也要确认：否则就是「静默把定版图换成新图、顺手把定版标记抹掉」）；
    - 其余（没设版 / 覆盖的是一张非定版图 / 对同一张定版图重复设版）→ 放行，返回 ``None``。

    确认过 → 返回被替换的旧定版摘要（调用方据此回显「替换了哪张」）；
    没确认 → 抛 :class:`PrimaryImageReplaceRequired`（409，``detail`` 为结构化中文明细）。
    """
    existing = await find_primary_image(
        db, image_model=image_model, id_field=id_field, entity_id=entity_id
    )
    if existing is None:
        return None

    same_slot = target_image_id is not None and existing.image_id == int(target_image_id)
    replaced = (becomes_primary and not same_slot) or (same_slot and replaces_target_file)
    if not replaced:
        return None
    if confirm_replace_primary:
        return existing
    raise PrimaryImageReplaceRequired(
        build_replace_required_detail(
            entity_type=entity_type,
            entity_id=entity_id,
            existing=existing,
            target_image_id=target_image_id,
        )
    )


__all__ = [
    "CONFIRM_FIELD",
    "PRIMARY_REPLACE_REQUIRED_CODE",
    "PrimaryImageReplaceRequired",
    "PrimaryImageSummary",
    "build_replace_required_detail",
    "confirm_replace_requested",
    "ensure_primary_not_silently_replaced",
    "find_primary_image",
    "summarize_slot",
]
