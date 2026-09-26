"""定版参考图解析：把 Jellyfish 里的"定版主图"解析成出图服务可用的参考图地址。

定版语义（**零表结构变更**，全部复用既有列）：
- 每个资产图片表（CharacterImage / SceneImage / PropImage / CostumeImage）都有
  ``file_id`` + ``is_primary`` + ``view_angle`` 列；
- ``is_primary=True`` 即"人工定版"的主图（写入侧由 ``entity_images.create_entity_image``
  维护"同一资产至多一张主图"）；
- ``file_id`` → ``files.storage_key`` → 对象存储公共 URL。

按 AGENTS.md V0 #10：长期资产地址优先用 OSS URL，所以这里解析的是存储层公共地址，
而不是 ``/images/...`` 之类的本地路径。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.models.studio import (
    CharacterImage,
    CostumeImage,
    FileItem,
    ProductImage,
    PropImage,
    SceneImage,
)
from app.models.types import AssetViewAngle

IMAGE_MODEL_BY_ASSET_TYPE: dict[str, type] = {
    "character": CharacterImage,
    "scene": SceneImage,
    "prop": PropImage,
    "costume": CostumeImage,
    "product": ProductImage,
}

PARENT_FIELD_BY_ASSET_TYPE: dict[str, str] = {
    "character": "character_id",
    "scene": "scene_id",
    "prop": "prop_id",
    "costume": "costume_id",
    "product": "product_id",
}


@dataclass(slots=True)
class ReferenceImage:
    """一个资产的定版参考图。"""

    asset_id: str
    asset_type: str
    file_id: str = ""
    url: str = ""
    view_angle: str = ""
    quality_level: str = ""
    is_primary: bool = False
    resolved_from: str = ""
    warnings: list[str] = field(default_factory=list)


def _image_model_for(asset_type: str) -> tuple[type, str] | None:
    model = IMAGE_MODEL_BY_ASSET_TYPE.get(str(asset_type or "").strip().lower())
    field_name = PARENT_FIELD_BY_ASSET_TYPE.get(str(asset_type or "").strip().lower())
    if model is None or field_name is None:
        return None
    return model, field_name


def _is_absolute_url(value: str) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith("http://") or text.startswith("https://")


async def resolve_file_url(db: AsyncSession, *, file_id: str) -> tuple[str, str]:
    """``files.id`` → ``(可访问地址, warning)``。公开入口，供非图片素材（如音频）复用。"""
    return await _resolve_url_for_file(db, file_id=file_id)


async def _resolve_url_for_file(db: AsyncSession, *, file_id: str) -> tuple[str, str]:
    """``files.storage_key`` → 可访问地址。

    返回 ``(url, warning)``。**任何解析失败都降级成 warning，不往上抛**：
    参考图只是增强项，缺一张图不该让整个出图计划 500。

    三种 storage_key 形态都要支持（实测库里都有）：

    1. **已经是完整 URL**（如 OSS 地址）——直接用。这本身就是长期资产地址，
       也正是参考图需要的形态（AGENTS.md V0 #10：长期资产优先用 OSS URL）。
    2. **相对 key**——先按**唯一正确的公网口径**拼 OSS 地址（``storage.public_url_for_key``，
       即 ``{s3_public_base_url}/{base_path}/{key}``），再照旧向对象存储确认这个对象真的在。
       为什么不能只信 ``get_file_info().url``：没配 ``s3_public_base_url`` 时它**不再**退回
       path-style ``{endpoint}/{bucket}/{key}``（那在阿里云 OSS 上是**错误地址**，匿名 404，
       而 404 的地址发给上游就是「无法获取输入媒体 URL（404/410）」这条真实故障的成因），
       而是返回空串 → 这里给出"没有公网地址"的中文修法。
    3. **本地驱动**——没有公网基址时退回 ``get_file_info().url``（``/files/{key}`` 形式）。
       这种地址上游**取不到**，由提交前的可达性预检（``reference_preflight``）拦下并给出修法。
    """
    file_obj = await db.get(FileItem, file_id) if file_id else None
    if file_obj is None:
        return "", (f"files 表里找不到 file_id={file_id}。" if file_id else "该图片没有关联 file_id。")
    storage_key = str(file_obj.storage_key or "").strip()
    if not storage_key:
        return "", f"file_id={file_id} 没有 storage_key。"

    if _is_absolute_url(storage_key):
        return storage_key, ""

    # 相对 key：先按**唯一**的地址口径拼（``public_url_for_key``），只有拿到**公网**
    # 地址才用它；本地驱动的 /files/... 回放地址不算公网地址（上游取不到）。
    public_url = storage.public_url_for_key(storage_key)
    if not storage.is_public_url(public_url):
        public_url = ""
    try:
        info = await storage.get_file_info(key=storage_key)
    except Exception as exc:  # noqa: BLE001 - 对象缺失/权限/后端异常都降级
        return "", f"对象存储读取失败（key={storage_key}）：{exc}"
    url = public_url or str(info.url or "")
    if not url:
        # 连一个地址都拿不到（典型：S3 驱动没配 s3_public_base_url）：直接用存储层
        # 那份可操作说明，避免这个配置缺口在几处写出几种说法。
        return "", storage.PUBLIC_BASE_MISSING_REASON
    return url, ""


async def resolve_references(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_ids: list[str],
) -> dict[str, ReferenceImage]:
    """批量解析定版参考图。

    选择顺序：``is_primary=True`` 优先；没有主图时退回"正面视角"；再没有就取任意一张。
    解析不到时返回带 warning 的条目，由调用方决定是否阻止提交。
    """
    clean_ids = [str(x) for x in asset_ids if str(x).strip()]
    if not clean_ids:
        return {}

    spec = _image_model_for(asset_type)
    if spec is None:
        return {
            asset_id: ReferenceImage(
                asset_id=asset_id,
                asset_type=asset_type,
                warnings=[f"不支持的资产类型：{asset_type or '空'}"],
            )
            for asset_id in clean_ids
        }

    model, field_name = spec
    parent_field = getattr(model, field_name)
    rows = (
        (await db.execute(select(model).where(parent_field.in_(clean_ids), model.file_id.is_not(None))))
        .scalars()
        .all()
    )

    # 排序优先级：is_primary > 正面视角 > 创建时间新 > 行 ID 大
    ranked: dict[str, list[tuple[tuple[int, int, int, int], object]]] = {asset_id: [] for asset_id in clean_ids}
    for row in rows:
        parent_id = str(getattr(row, field_name))
        created = int(row.created_at.timestamp()) if getattr(row, "created_at", None) else -1
        score = (
            1 if getattr(row, "is_primary", False) else 0,
            1 if getattr(row, "view_angle", "") == AssetViewAngle.front else 0,
            created,
            int(row.id or 0),
        )
        ranked.setdefault(parent_id, []).append((score, row))

    result: dict[str, ReferenceImage] = {}
    for asset_id in clean_ids:
        candidates = ranked.get(asset_id) or []
        if not candidates:
            result[asset_id] = ReferenceImage(
                asset_id=asset_id,
                asset_type=asset_type,
                warnings=[f"{asset_type} {asset_id} 还没有图片，无法作为参考图使用。"],
            )
            continue

        candidates.sort(key=lambda item: item[0], reverse=True)
        _score, row = candidates[0]
        file_id = str(row.file_id or "")
        url, url_warning = await _resolve_url_for_file(db, file_id=file_id)
        warnings: list[str] = []
        if url_warning:
            warnings.append(f"{asset_type} {asset_id}：{url_warning}")
        if not getattr(row, "is_primary", False):
            warnings.append(
                f"{asset_type} {asset_id} 没有定版主图（is_primary），已退回"
                f"{getattr(row, 'view_angle', '') or '任意视角'}的图片作参考图，建议先人工定版。"
            )
        result[asset_id] = ReferenceImage(
            asset_id=asset_id,
            asset_type=asset_type,
            file_id=file_id,
            url=url,
            view_angle=str(getattr(row, "view_angle", "") or ""),
            quality_level=str(getattr(row, "quality_level", "") or ""),
            is_primary=bool(getattr(row, "is_primary", False)),
            resolved_from="is_primary" if getattr(row, "is_primary", False) else "fallback",
            warnings=warnings,
        )
    return result
