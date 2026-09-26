"""项目资产准备状态：角色 / 场景 / 道具 / 服装的**唯一数据源**。

为什么要有这个模块
------------------

「资产准备」这一步此前把状态判定建立在**偶然暴露的字段**上：

- 角色走 `/studio/entities/character`，读模型的 `image_prompts` 一直在；
- 场景 / 道具 / 服装走 `project_scene_links` 之类的**关联行**，关联行的读模型里
  从来没有 `image_prompts`。

于是页面出现分裂：角色能判定「提示词是否已保存」，场景 / 道具 / 服装永远
显示「无法判定」（`has_image_prompt = null`）。最直接的后果是**在资产准备页
保存了场景提示词，返回后仍然显示「待完善提示词」**，后面「上传图片 → 设为定版」
两个状态也就推不动。

本模块把四类资产的准备状态收敛到**同一套口径**：每一项都由
「实体本身（名字 / image_prompts）+ 图片表（是否有图、是否有定版）+ 提取候选（是否还有未确认）」
算出来，与它挂在哪张关联表上无关：

===================  ==========================================================
``has_pending_candidate``  本项目内存在同类型、同名（归一化）且仍为 ``pending`` 的提取候选
``has_image_prompt``       实体 ``image_prompts`` 里有任意一个非空文本槽位
``has_image``              ``*_images`` 里存在 ``file_id`` 非空的图片行（空槽位不算图）
``has_primary``            上述图片行里有任意一条 ``is_primary``
===================  ==========================================================

硬约束：

- **不新增数据库列**：``image_prompts`` / ``is_primary`` / ``file_id`` 都是既有列；
- **不做 N+1**：每类资产固定 3 条查询（资产 / 候选名集合 / 图片），与资产数量无关；
- **不截断**：项目内每一类资产全部返回，就绪判定才不会漏掉第 N 个之后的资产。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    Chapter,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Shot,
    ShotCandidateStatus,
    ShotExtractedCandidate,
)
from app.services.studio.entity_specs import entity_spec
from app.services.studio.entity_thumbnails import resolve_thumbnail_infos
from app.services.studio.llm_orchestration.json_utils import normalize_name

#: 参与「资产准备」的资产类型（与页面标签、候选类型同名）。
ASSET_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume")


@dataclass(frozen=True)
class _AssetSpec:
    """一类资产的取数规格。

    ``link_model`` 为 ``None`` 表示这类资产自带 ``project_id`` 列（角色）；
    其余三类靠项目关联表挂在项目上。取数方式不同，但算出来的字段**完全一致**。
    """

    asset_type: str
    model: type
    image_model: type
    image_owner_field: str
    link_model: type | None
    link_asset_field: str | None


def _build_specs() -> tuple[_AssetSpec, ...]:
    """用实体的既有规格（`entity_spec`）拼出四类规格，避免重复声明表/字段名。"""
    specs: list[_AssetSpec] = []
    link_models: dict[str, tuple[type, str]] = {
        "scene": (ProjectSceneLink, "scene_id"),
        "prop": (ProjectPropLink, "prop_id"),
        "costume": (ProjectCostumeLink, "costume_id"),
    }
    for asset_type in ASSET_TYPES:
        spec = entity_spec(asset_type)
        link_model, link_field = link_models.get(asset_type, (None, None))
        specs.append(
            _AssetSpec(
                asset_type=asset_type,
                model=spec.model,
                image_model=spec.image_model,
                image_owner_field=spec.id_field,
                link_model=link_model,
                link_asset_field=link_field,
            )
        )
    return tuple(specs)


_ASSET_SPECS: tuple[_AssetSpec, ...] = _build_specs()


def _has_image_prompt(row: Any) -> bool:  # noqa: ANN401
    """``image_prompts`` 里是否有任意一个非空槽位。

    与前端 `imagePromptCount` 同口径：值需要是非空文本，只有键不算「已保存」。
    """
    prompts = getattr(row, "image_prompts", None)
    if not isinstance(prompts, dict):
        return False
    return any(str(value or "").strip() != "" for value in prompts.values())


async def _pending_candidate_keys(db: AsyncSession, *, project_id: str) -> set[tuple[str, str]]:
    """项目内**仍未确认**的提取候选：``{(候选类型, 归一化名称)}``。

    只算 ``candidate_status = pending`` 的：已关联（linked）/ 已忽略（ignored）
    都不该再把对应资产推回「待确认」。
    """
    stmt = (
        select(ShotExtractedCandidate.candidate_type, ShotExtractedCandidate.candidate_name)
        .join(Shot, Shot.id == ShotExtractedCandidate.shot_id)
        .join(Chapter, Chapter.id == Shot.chapter_id)
        .where(
            Chapter.project_id == project_id,
            ShotExtractedCandidate.candidate_status == ShotCandidateStatus.pending,
        )
    )
    rows = (await db.execute(stmt)).all()
    keys: set[tuple[str, str]] = set()
    for candidate_type, candidate_name in rows:
        name_key = normalize_name(str(candidate_name or ""))
        if not name_key:
            continue
        keys.add((str(getattr(candidate_type, "value", candidate_type)), name_key))
    return keys


async def _project_assets(db: AsyncSession, *, spec: _AssetSpec, project_id: str) -> list[Any]:
    """项目内的该类资产（全部，不截断）。"""
    stmt = select(spec.model)
    if spec.link_model is None:
        stmt = stmt.where(spec.model.project_id == project_id)
    else:
        assert spec.link_asset_field is not None  # noqa: S101 - 规格自检
        linked_ids = select(getattr(spec.link_model, spec.link_asset_field)).where(
            spec.link_model.project_id == project_id
        )
        stmt = stmt.where(spec.model.id.in_(linked_ids))
    stmt = stmt.order_by(spec.model.created_at, spec.model.id)
    return list((await db.execute(stmt)).scalars().all())


async def _primary_parent_ids(db: AsyncSession, *, spec: _AssetSpec, parent_ids: list[str]) -> set[str]:
    """有 ``file_id`` 且 ``is_primary`` 的资产 id 集合。

    必须先要求 ``file_id`` 非空：资产编辑页会自动补出**空槽位行**（没有文件），
    空槽位上的 ``is_primary`` 不代表「已定版」，否则页面会跳过「上传图片」直接说已定版。
    """
    if not parent_ids:
        return set()
    owner_field = getattr(spec.image_model, spec.image_owner_field)
    stmt = select(owner_field).where(
        owner_field.in_(parent_ids),
        spec.image_model.file_id.is_not(None),
        spec.image_model.file_id != "",
        spec.image_model.is_primary.is_(True),
    )
    return {str(value) for value in (await db.execute(stmt)).scalars().all() if value}


def summarize_readiness(items: list[dict[str, Any]]) -> dict[str, Any]:
    """按同一批标志汇总（顶部统计与后端自测共用这一处口径）。"""
    asset_counts = {asset_type: 0 for asset_type in ASSET_TYPES}
    with_image_prompt = with_image = with_primary = done = 0
    for item in items:
        asset_type = str(item.get("asset_type") or "")
        if asset_type in asset_counts:
            asset_counts[asset_type] += 1
        if item.get("has_image_prompt"):
            with_image_prompt += 1
        if item.get("has_image"):
            with_image += 1
        if item.get("has_primary"):
            with_primary += 1
        if (
            item.get("has_image_prompt")
            and item.get("has_image")
            and item.get("has_primary")
            and not item.get("has_pending_candidate")
        ):
            done += 1
    total = len(items)
    return {
        "total": total,
        "asset_counts": asset_counts,
        "with_image_prompt": with_image_prompt,
        "with_image": with_image,
        "with_primary": with_primary,
        "done": done,
        "all_done": total > 0 and done == total,
    }


async def build_project_asset_readiness(db: AsyncSession, *, project_id: str) -> dict[str, Any]:
    """项目资产准备清单（四类资产同一口径，供表格 / 顶部统计 / 步骤判定共用）。"""
    pending_keys = await _pending_candidate_keys(db, project_id=project_id)
    items: list[dict[str, Any]] = []

    for spec in _ASSET_SPECS:
        assets = await _project_assets(db, spec=spec, project_id=project_id)
        parent_ids = [str(asset.id) for asset in assets]
        # 图片信息与 `resolve_thumbnails` 共用同一套「首选图」打分（正面优先 → 创建时间 → id），
        # 所以这里拿到的 image_id 就是页面缩略图展示的那张，也就是「设为定版」的默认目标。
        image_infos = await resolve_thumbnail_infos(
            db,
            image_model=spec.image_model,
            parent_field_name=spec.image_owner_field,
            parent_ids=parent_ids,
        )
        primary_ids = await _primary_parent_ids(db, spec=spec, parent_ids=parent_ids)

        for asset in assets:
            asset_id = str(asset.id)
            name = str(asset.name or "")
            info = image_infos.get(asset_id) or {}
            items.append(
                {
                    "asset_type": spec.asset_type,
                    "asset_id": asset_id,
                    "name": name,
                    "has_pending_candidate": (spec.asset_type, normalize_name(name)) in pending_keys,
                    "has_image_prompt": _has_image_prompt(asset),
                    "has_image": asset_id in image_infos,
                    "has_primary": asset_id in primary_ids,
                    "thumbnail": str(info.get("thumbnail") or ""),
                    "image_id": info.get("image_id"),
                }
            )

    return {
        "project_id": project_id,
        "items": items,
        "summary": summarize_readiness(items),
    }


__all__ = [
    "ASSET_TYPES",
    "build_project_asset_readiness",
    "summarize_readiness",
]
