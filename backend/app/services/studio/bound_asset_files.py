"""把「镜头 ↔ 资产」绑定解析成**实际使用的文件**。

对应用户要求：**"关联资产名称不算完成，必须明确实际使用的文件。"**

绑定表（``shot_character_links`` / ``project_{scene,prop,costume}_links``）只记录
"这个镜头用到角色X"，并不指明用哪张图。真正可用的文件按以下优先级解析：

1. 该资产 **``is_primary=True`` 的定版图**（步骤 3 里人工确认过的那张）；
2. 退回"正面视角"的图；
3. 再退回任意一张有 file_id 的图。

解析结果同时带 ``file_id`` 与可访问地址，供：
- **交付导出**：把实际文件写进交付内容（而不是只写资产名）；
- **帧图生成**：把这些文件作为参考图传入生成请求。

复用 ``image_pipeline.reference_resolver``（它已处理 ``is_primary`` 与
"storage_key 本身就是完整 URL" 两种形态），避免两套解析逻辑漂移。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    Character,
    Costume,
    Product,
    ProjectCostumeLink,
    ProjectProductLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    Scene,
    ShotCharacterLink,
)
from app.services.studio.image_pipeline.reference_resolver import resolve_file_url, resolve_references

# 槽位名与交付文本里的中文标签一致
SLOT_LABELS: dict[str, str] = {
    "characters": "角色",
    "scene": "场景",
    "props": "道具",
    "costumes": "服装",
    "products": "商品",
    # 声音不是"资产"，而是镜头级音频文件（files.type=audio），单列一个槽位
    "audio": "声音",
}

# 槽位 → 资产类型（reference_resolver 用的是资产类型）
SLOT_ASSET_TYPE: dict[str, str] = {
    "characters": "character",
    "scene": "scene",
    "props": "prop",
    "costumes": "costume",
    "products": "product",
}


@dataclass(slots=True)
class BoundAssetFile:
    """一个绑定资产实际使用的文件。"""

    slot: str
    asset_id: str
    asset_type: str
    asset_name: str
    file_id: str = ""
    url: str = ""
    is_primary: bool = False
    resolved_from: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        """是否真的拿到可用文件（两者都为空表示只有名称、没有文件）。"""
        return bool(self.file_id or self.url)

    def to_read(self) -> dict[str, object]:
        return {
            "slot": self.slot,
            "slot_label": SLOT_LABELS.get(self.slot, self.slot),
            "asset_id": self.asset_id,
            "asset_type": self.asset_type,
            "asset_name": self.asset_name,
            "file_id": self.file_id,
            "url": self.url,
            "is_primary": self.is_primary,
            "resolved_from": self.resolved_from,
            "usable": self.usable,
            "warnings": list(self.warnings),
        }


async def _bound_asset_ids(db: AsyncSession, *, shot_id: str) -> dict[str, dict[str, str]]:
    """取该镜头绑定的资产：``{slot: {asset_id: asset_name}}``。"""
    result: dict[str, dict[str, str]] = {slot: {} for slot in SLOT_LABELS}

    rows = (
        await db.execute(
            select(ShotCharacterLink.character_id, Character.name)
            .join(Character, Character.id == ShotCharacterLink.character_id)
            .where(ShotCharacterLink.shot_id == shot_id)
        )
    ).all()
    for asset_id, name in rows:
        result["characters"][str(asset_id)] = str(name or "")

    rows = (
        await db.execute(
            select(ProjectSceneLink.scene_id, Scene.name)
            .join(Scene, Scene.id == ProjectSceneLink.scene_id)
            .where(ProjectSceneLink.shot_id == shot_id)
        )
    ).all()
    for asset_id, name in rows:
        result["scene"][str(asset_id)] = str(name or "")

    rows = (
        await db.execute(
            select(ProjectPropLink.prop_id, Prop.name)
            .join(Prop, Prop.id == ProjectPropLink.prop_id)
            .where(ProjectPropLink.shot_id == shot_id)
        )
    ).all()
    for asset_id, name in rows:
        result["props"][str(asset_id)] = str(name or "")

    rows = (
        await db.execute(
            select(ProjectCostumeLink.costume_id, Costume.name)
            .join(Costume, Costume.id == ProjectCostumeLink.costume_id)
            .where(ProjectCostumeLink.shot_id == shot_id)
        )
    ).all()
    for asset_id, name in rows:
        result["costumes"][str(asset_id)] = str(name or "")

    rows = (
        await db.execute(
            select(ProjectProductLink.product_id, Product.name)
            .join(Product, Product.id == ProjectProductLink.product_id)
            .where(ProjectProductLink.shot_id == shot_id)
        )
    ).all()
    for asset_id, name in rows:
        result["products"][str(asset_id)] = str(name or "")

    return result


async def bound_asset_ids_for_shot(db: AsyncSession, *, shot_id: str) -> dict[str, dict[str, str]]:
    """**公开入口**：该镜头绑定的资产 ``{slot: {asset_id: asset_name}}``。

    为什么单独开一个公开函数、而不是让调用方直接用 ``_bound_asset_ids``：
    "这一镜绑了哪些资产"这个问题的答案必须**只有一份**（声音带出、绑定面板、
    交付导出都读它）。否则两边各写一条 join，迟早会在
    "产品算不算资产""服装算不算"这类细节上悄悄分叉。
    """
    return await _bound_asset_ids(db, shot_id=shot_id)


async def resolve_shot_audio_file(db: AsyncSession, *, shot_id: str) -> BoundAssetFile | None:
    """解析镜头级音频文件（``shot_details.audio_file_id`` → ``files``）。

    声音绑定的落点就是这一列（用户授权新增）。没有绑定时返回 None，不产生条目。
    """
    from app.models.studio import FileItem, ShotDetail

    detail = await db.get(ShotDetail, shot_id)
    file_id = str(getattr(detail, "audio_file_id", "") or "").strip()
    if not file_id:
        # 「本镜明确无需声音」：只靠 audio_file_id 为空无法区分"还没绑"和"这镜就是不需要"，
        # 会让就绪判定与导出把它当成漏绑。这里显式产出一条**不可用但已表态**的声音条目。
        if bool(getattr(detail, "audio_opt_out", False)):
            return BoundAssetFile(
                slot="audio",
                asset_id=f"audio-opt-out:{shot_id}",
                asset_type="audio",
                asset_name="本镜明确标记：无需声音",
                resolved_from="audio_opt_out",
            )
        return None
    file_item = await db.get(FileItem, file_id)
    if file_item is None:
        return BoundAssetFile(
            slot="audio",
            asset_id=file_id,
            asset_type="audio",
            asset_name=f"音频 {file_id}",
            warnings=[f"files 表里找不到 audio_file_id={file_id}。"],
        )
    url, warning = await resolve_file_url(db, file_id=str(file_item.id))
    warnings = [warning] if warning else []
    file_type = str(getattr(file_item, "type", "") or "")
    if file_type and file_type != "audio":
        warnings.append(f"该文件 type={file_type}，不是 audio，请确认绑定是否正确。")
    return BoundAssetFile(
        slot="audio",
        asset_id=str(file_item.id),
        asset_type="audio",
        asset_name=str(getattr(file_item, "name", "") or file_item.id),
        file_id=str(file_item.id),
        url=url,
        is_primary=False,
        resolved_from="shot_detail.audio_file_id",
        warnings=warnings,
    )


async def resolve_shot_bound_files(db: AsyncSession, *, shot_id: str) -> list[BoundAssetFile]:
    """解析单个镜头绑定资产实际使用的文件（定版优先），外加镜头级音频。"""
    bound = await _bound_asset_ids(db, shot_id=shot_id)
    resolved: list[BoundAssetFile] = []

    for slot, asset_type in SLOT_ASSET_TYPE.items():
        assets = bound.get(slot) or {}
        if not assets:
            continue
        references = await resolve_references(
            db, asset_type=asset_type, asset_ids=list(assets.keys())
        )
        for asset_id, asset_name in assets.items():
            reference = references.get(asset_id)
            if reference is None:
                resolved.append(
                    BoundAssetFile(
                        slot=slot,
                        asset_id=asset_id,
                        asset_type=asset_type,
                        asset_name=asset_name,
                        warnings=["解析不到该资产的图片记录。"],
                    )
                )
                continue
            resolved.append(
                BoundAssetFile(
                    slot=slot,
                    asset_id=asset_id,
                    asset_type=asset_type,
                    asset_name=asset_name,
                    file_id=reference.file_id,
                    url=reference.url,
                    is_primary=reference.is_primary,
                    resolved_from=reference.resolved_from,
                    warnings=list(reference.warnings),
                )
            )

    # 镜头级音频（声音绑定）挂在同一个结果里，交付与生成都从这一份读取
    audio = await resolve_shot_audio_file(db, shot_id=shot_id)
    if audio is not None:
        resolved.append(audio)
    return resolved


async def resolve_bound_files_for_shots(
    db: AsyncSession, *, shot_ids: list[str]
) -> dict[str, list[BoundAssetFile]]:
    """批量解析（逐镜头；镜头数通常很小，避免过早优化）。"""
    result: dict[str, list[BoundAssetFile]] = {}
    for shot_id in shot_ids:
        result[shot_id] = await resolve_shot_bound_files(db, shot_id=shot_id)
    return result



def to_shot_linked_asset_items(files: list[BoundAssetFile]) -> list[Any]:
    """转成 ``ShotLinkedAssetItem``，供分镜帧的参考图入参使用。

    ``frame.build_context`` 期望的是带 ``type/id/name/file_id`` 的条目，
    而不是 file_id 字符串列表 —— 这里做一次显式转换，避免调用方各自拼错。
    只有真正解析到文件的条目才会产出（``usable`` 为假的不参与参考图）。

    **音频必须排除在外**：``ShotLinkedAssetItem.type`` 只认 character/prop/scene/costume，
    而语音（``asset_type='audio'``）不是画面参考图。此前不过滤，绑上声音之后
    帧图生成会直接 500（pydantic Literal 校验失败）。
    """
    from app.schemas.studio.shots import ShotLinkedAssetItem

    items: list[Any] = []
    for item in files:
        if item.asset_type not in SLOT_ASSET_TYPE.values():
            continue
        if not item.usable:
            continue
        items.append(
            ShotLinkedAssetItem(
                type=item.asset_type,  # type: ignore[arg-type]
                id=item.asset_id,
                image_id=None,
                file_id=item.file_id or None,
                name=item.asset_name or item.asset_id,
                thumbnail=item.url or "",
            )
        )
    return items


def usable_file_ids(files: list[BoundAssetFile]) -> list[str]:
    """取出可用的 file_id 列表（去重、保持顺序，供生成请求当参考图用）。"""
    seen: set[str] = set()
    ordered: list[str] = []
    for item in files:
        if item.file_id and item.file_id not in seen:
            seen.add(item.file_id)
            ordered.append(item.file_id)
    return ordered


def render_bound_file_lines(files: list[BoundAssetFile]) -> list[str]:
    """交付文本用的行：明确到 file_id（用户要求"实际使用的文件"）。"""
    if not files:
        return []
    lines: list[str] = []
    for slot, slot_label in SLOT_LABELS.items():
        slot_files = [item for item in files if item.slot == slot]
        if not slot_files:
            continue
        parts: list[str] = []
        for item in slot_files:
            if item.resolved_from == "audio_opt_out":
                # 明确表态的镜头：导出里要写清楚，而不是留空让人以为是漏绑
                parts.append("本镜明确标记：无需声音")
                continue
            mark = "定版" if item.is_primary else (item.resolved_from or "非定版")
            if item.usable:
                parts.append(f"{item.asset_name}[{mark}] file_id={item.file_id or '—'}")
            else:
                parts.append(f"{item.asset_name}[{mark}] 无可用文件")
        lines.append(f"{slot_label}：" + "；".join(parts))
    return lines


__all__ = [
    "SLOT_LABELS",
    "SLOT_ASSET_TYPE",
    "BoundAssetFile",
    "render_bound_file_lines",
    "resolve_bound_files_for_shots",
    "resolve_shot_audio_file",
    "resolve_shot_bound_files",
    "to_shot_linked_asset_items",
    "usable_file_ids",
]
