"""资产级声音绑定：**声音直接绑到资产**（需求清单第 6 条）。

为什么要这一层
==============

改前的声音是**逐镜**的：``shot_details.audio_file_id`` 只回答"这一镜用哪条音频"。
用户的口径是：**声音应该绑在资产上**（这个角色就是这个声音），
镜头只要绑定了带声音的资产，视频生成就自动带出它的声音 ——
工作室里不再需要一处一处地给每个镜头配声音。

存储走**复用**而不是新增列（已与用户确认）
==========================================

资产级声音记在既有的 ``file_usages`` 上：

- ``usage_kind = "asset_voice"``（``FileUsageKind`` 的新成员；
  该列在库中是 ``String(32)``，**加成员不需要改表结构**）；
- ``source_ref = "<asset_type>:<asset_id>"``（形如 ``character:char-1``）。

**为什么这个复用是安全的**（不是拍脑袋）：``file_usages`` 的唯一约束是
``(file_id, usage_kind, source_ref)`` **三元组**，所以：

1. ``asset_voice`` 与其它 kind 天然隔离，别的用途的幂等键语义一个字都不变；
2. 白得一条幂等约束：同一个音频文件对同一个资产不会被重复绑两行；
3. 查询规模：资产级绑定是全项目几十行量级，只在"绑定展示 + 视频生成解析"两处低频读取，
   字符串匹配没有任何压力。

应用层不变式（①）
=================

三元组约束**允许**"同一资产挂多个不同音频文件"（file_id 不同就都能插进去），
那会让"这个资产的声音是哪个"变得不确定。所以这里在**同一事务**里保证：

    一个资产在同一时刻**只有一个生效的 asset_voice 行**。

绑定实现为「先删该资产的旧 asset_voice 行 → 再插新行」，删除与插入在同一个 session
事务里，任何一步失败都不会留下两个生效声音。这条不变式有接口级测试钉住
（``tests/test_asset_voice_binding.py``）。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Character, Costume, FileItem, Prop, Scene
from app.models.studio_file_usages import FileUsage
from app.models.types import FileType, FileUsageKind
from app.services.studio.asset_profiles import normalize_asset_type, type_label
from app.services.studio.file_usages import (
    first_project_id_for_costume,
    first_project_id_for_prop,
    first_project_id_for_scene,
    upsert_file_usage,
)

#: 允许绑定声音的资产类型。
#:
#: 刻意**只写四类**、不用 ``asset_profiles.ASSET_TYPES``：那张表里还有 ``product``（商品，
#: 供剧情策划用），而"商品的声音"不是本需求要的东西 —— 名单写在这里，避免上游扩表时
#: 这个接口静默地跟着变宽。
ASSET_VOICE_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume")

#: 资产引用在 ``source_ref`` 里的前缀分隔符（``character:char-1``）。
_SOURCE_REF_SEP = ":"


@dataclass(frozen=True, slots=True)
class AssetVoiceBinding:
    """一条资产级声音绑定（只读视图，供页面与视频生成解析使用）。"""

    asset_type: str
    asset_id: str
    file_id: str
    #: 可直接使用的地址（``files.storage_key``；既可能是 OSS URL 也可能是本机相对路径，
    #: 是否**真的能进供应商请求**由 ``video_audio_input`` 的准入口径判定，这里不预判）。
    url: str
    file_name: str
    project_id: str

    @property
    def asset_label(self) -> str:
        """资产类型的中文名（进文案，不出现内部类型码）。"""
        return type_label(self.asset_type)


def asset_voice_source_ref(asset_type: str, asset_id: str) -> str:
    """资产在 ``source_ref`` 上的引用形态（唯一事实来源，别处不许自己拼）。"""
    return f"{normalize_asset_type(asset_type) or str(asset_type).strip().lower()}{_SOURCE_REF_SEP}{asset_id}"


def _split_source_ref(source_ref: str) -> tuple[str, str] | None:
    """把 ``source_ref`` 拆回 ``(asset_type, asset_id)``；不是资产引用时返回 None。"""
    text = str(source_ref or "")
    if _SOURCE_REF_SEP not in text:
        return None
    asset_type, _, asset_id = text.partition(_SOURCE_REF_SEP)
    normalized = normalize_asset_type(asset_type)
    if normalized is None or not asset_id:
        return None
    return normalized, asset_id


async def _project_id_for_asset(db: AsyncSession, *, asset_type: str, asset_id: str) -> str | None:
    """该资产所属项目（角色的项目在行上；场景/道具/服装是全局资产，看项目关联）。"""
    if asset_type == "character":
        row = await db.get(Character, asset_id)
        return str(row.project_id) if row is not None else None
    if asset_type == "scene":
        return await first_project_id_for_scene(db, asset_id)
    if asset_type == "prop":
        return await first_project_id_for_prop(db, asset_id)
    if asset_type == "costume":
        return await first_project_id_for_costume(db, asset_id)
    return None


async def _asset_exists(db: AsyncSession, *, asset_type: str, asset_id: str) -> bool:
    """资产是否真的存在（不存在就明确报错，不写一条指向空气的绑定）。"""
    if asset_type == "character":
        return (await db.get(Character, asset_id)) is not None
    if asset_type == "scene":
        return (await db.get(Scene, asset_id)) is not None
    if asset_type == "prop":
        return (await db.get(Prop, asset_id)) is not None
    if asset_type == "costume":
        return (await db.get(Costume, asset_id)) is not None
    return False


def normalize_voice_asset_type(raw: Any) -> str:
    """归一化资产类型；不在四类里就给出结构化中文拒绝（不猜、不按角色处理）。"""
    asset_type = normalize_asset_type(raw)
    if asset_type is None or asset_type not in ASSET_VOICE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_asset_type",
                "message": (
                    f"不支持的资产类型「{raw or '空'}」：资产声音只支持 "
                    f"{'、'.join(type_label(item) for item in ASSET_VOICE_TYPES)}。"
                ),
            },
        )
    return asset_type


async def _load_audio_file(db: AsyncSession, file_id: str) -> FileItem:
    """取出并校验音频文件（``files.type`` 必须是 audio）。"""
    file_row = await db.get(FileItem, file_id)
    if file_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "file_not_found", "message": "要绑定的音频文件不存在，请重新选择。"},
        )
    file_type = str(getattr(file_row.type, "value", file_row.type))
    if file_type != FileType.audio.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "not_an_audio_file",
                "message": "只能把**音频**文件绑成资产声音；请选择 mp3 / wav / m4a 这类音频文件。",
            },
        )
    return file_row


async def _clear_asset_voice_rows(
    db: AsyncSession, *, asset_type: str, asset_id: str
) -> int:
    """删掉该资产**所有**旧的 asset_voice 行（不变式①的第一步）。"""
    ref = asset_voice_source_ref(asset_type, asset_id)
    result = await db.execute(
        delete(FileUsage).where(
            FileUsage.usage_kind == FileUsageKind.asset_voice.value,
            FileUsage.source_ref == ref,
        )
    )
    return int(result.rowcount or 0)


async def bind_asset_voice(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_id: str,
    file_id: str,
) -> AssetVoiceBinding:
    """给一个资产绑定声音（**同一事务**内保证只有一个生效声音）。

    步骤：校验资产与音频文件 → 删掉该资产的旧 ``asset_voice`` 行 → 写入新行。
    调用方负责事务边界（路由层一个请求一个事务），因此"删旧 + 插新"不会只做一半。
    """
    kind = normalize_voice_asset_type(asset_type)
    clean_asset_id = str(asset_id or "").strip()
    if not clean_asset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "asset_id_required", "message": "要绑定声音的资产没有指定，请重新打开这一项。"},
        )
    if not await _asset_exists(db, asset_type=kind, asset_id=clean_asset_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "asset_not_found", "message": "要绑定声音的资产不存在，请刷新后重试。"},
        )
    project_id = await _project_id_for_asset(db, asset_type=kind, asset_id=clean_asset_id)
    if not project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "asset_without_project",
                "message": "这一项还没有关联到任何项目，无法绑定声音；请先把它加进项目。",
            },
        )
    file_row = await _load_audio_file(db, file_id)
    # 旧声音先删：这条删除是"一个资产只有一个生效声音"（不变式①）的落地。
    await _clear_asset_voice_rows(db, asset_type=kind, asset_id=clean_asset_id)
    await upsert_file_usage(
        db,
        file_id=str(file_row.id),
        project_id=project_id,
        # 资产级绑定是**项目级**的（一个角色的声音跨集共用），所以不带章节
        chapter_id=None,
        shot_id=None,
        usage_kind=FileUsageKind.asset_voice,
        source_ref=asset_voice_source_ref(kind, clean_asset_id),
    )
    return AssetVoiceBinding(
        asset_type=kind,
        asset_id=clean_asset_id,
        file_id=str(file_row.id),
        url=str(file_row.storage_key or ""),
        file_name=str(file_row.name or ""),
        project_id=project_id,
    )


async def clear_asset_voice(db: AsyncSession, *, asset_type: str, asset_id: str) -> int:
    """解绑该资产的资产声音；返回删掉的行数（0 表示本来就没绑）。"""
    kind = normalize_voice_asset_type(asset_type)
    return await _clear_asset_voice_rows(db, asset_type=kind, asset_id=str(asset_id or "").strip())


async def read_asset_voice(
    db: AsyncSession, *, asset_type: str, asset_id: str
) -> AssetVoiceBinding | None:
    """读一个资产的资产声音；没绑返回 None。"""
    kind = normalize_asset_type(asset_type)
    if kind is None:
        return None
    ref = asset_voice_source_ref(kind, str(asset_id or "").strip())
    row = (
        await db.execute(
            select(FileUsage, FileItem)
            .join(FileItem, FileItem.id == FileUsage.file_id)
            .where(
                FileUsage.usage_kind == FileUsageKind.asset_voice.value,
                FileUsage.source_ref == ref,
            )
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    usage, file_row = row
    return AssetVoiceBinding(
        asset_type=kind,
        asset_id=str(asset_id or "").strip(),
        file_id=str(file_row.id),
        url=str(file_row.storage_key or ""),
        file_name=str(file_row.name or ""),
        project_id=str(usage.project_id),
    )


async def read_asset_voices(
    db: AsyncSession,
    *,
    asset_ids_by_type: Mapping[str, Sequence[str]],
) -> dict[tuple[str, str], AssetVoiceBinding]:
    """**批量**读资产声音：``{(asset_type, asset_id): 绑定}``。

    为什么批量：资产准备页一屏就是几十项，逐项查会变成 N 次查询。
    这里一次查询取回全部命中的行，再按 ``source_ref`` 拆回资产键。
    """
    wanted: set[str] = set()
    type_by_ref: dict[str, tuple[str, str]] = {}
    for raw_type, ids in asset_ids_by_type.items():
        kind = normalize_asset_type(raw_type)
        if kind is None:
            continue
        for asset_id in ids:
            clean = str(asset_id or "").strip()
            if not clean:
                continue
            ref = asset_voice_source_ref(kind, clean)
            wanted.add(ref)
            type_by_ref[ref] = (kind, clean)
    if not wanted:
        return {}

    rows = (
        await db.execute(
            select(FileUsage, FileItem)
            .join(FileItem, FileItem.id == FileUsage.file_id)
            .where(
                FileUsage.usage_kind == FileUsageKind.asset_voice.value,
                FileUsage.source_ref.in_(sorted(wanted)),
            )
        )
    ).all()
    result: dict[tuple[str, str], AssetVoiceBinding] = {}
    for usage, file_row in rows:
        pair = type_by_ref.get(str(usage.source_ref))
        if pair is None:
            continue
        asset_type, asset_id = pair
        result[(asset_type, asset_id)] = AssetVoiceBinding(
            asset_type=asset_type,
            asset_id=asset_id,
            file_id=str(file_row.id),
            url=str(file_row.storage_key or ""),
            file_name=str(file_row.name or ""),
            project_id=str(usage.project_id),
        )
    return result


async def list_project_asset_voices(
    db: AsyncSession, *, project_id: str
) -> list[AssetVoiceBinding]:
    """列出某个项目下**全部**资产声音绑定（诊断/审计用；只读）。"""
    rows = (
        await db.execute(
            select(FileUsage, FileItem)
            .join(FileItem, FileItem.id == FileUsage.file_id)
            .where(
                FileUsage.usage_kind == FileUsageKind.asset_voice.value,
                FileUsage.project_id == project_id,
            )
            .order_by(FileUsage.source_ref)
        )
    ).all()
    result: list[AssetVoiceBinding] = []
    for usage, file_row in rows:
        pair = _split_source_ref(str(usage.source_ref))
        if pair is None:
            continue
        asset_type, asset_id = pair
        result.append(
            AssetVoiceBinding(
                asset_type=asset_type,
                asset_id=asset_id,
                file_id=str(file_row.id),
                url=str(file_row.storage_key or ""),
                file_name=str(file_row.name or ""),
                project_id=str(usage.project_id),
            )
        )
    return result


async def resolve_voices_for_assets(
    db: AsyncSession,
    *,
    assets: Iterable[tuple[str, str]],
) -> list[AssetVoiceBinding]:
    """按 ``[(asset_type, asset_id)]`` 取**已绑定**的声音（顺序去重，保持传入顺序）。

    B2b（视频生成自动带声音）用它把"这一镜绑定的资产"翻成"可用的声音"。
    """
    ordered: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    by_type: dict[str, list[str]] = {}
    for raw_type, raw_id in assets:
        kind = normalize_asset_type(raw_type)
        if kind is None:
            continue
        asset_id = str(raw_id or "").strip()
        if not asset_id:
            continue
        key = (kind, asset_id)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(key)
        by_type.setdefault(kind, []).append(asset_id)
    if not ordered:
        return []
    found = await read_asset_voices(db, asset_ids_by_type=by_type)
    return [found[key] for key in ordered if key in found]


__all__ = [
    "ASSET_VOICE_TYPES",
    "AssetVoiceBinding",
    "asset_voice_source_ref",
    "bind_asset_voice",
    "clear_asset_voice",
    "list_project_asset_voices",
    "normalize_voice_asset_type",
    "read_asset_voice",
    "read_asset_voices",
    "resolve_voices_for_assets",
]
