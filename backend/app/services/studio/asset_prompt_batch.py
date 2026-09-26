"""资产图片提示词的**批量保存**：四类资产同一个入口，全部检查在写库之前。

为什么要有这个入口
==================

资产准备页的"确认保存"此前是对每个资产各发一次
``PATCH /studio/entities/{type}/{id}``。这样有三个绕不过去的问题：

1. **看不到跨资产**：单个资产自己看自己，永远发现不了"两个角色拿到同一段提示词"
   ——而这正是线上最常见的坏结果（模型没按资产特征区分）；
2. **部分成功**：批量里第 3 个被拦，前 2 个已经落库，页面状态与库不一致；
3. **没有跨资产兜底**：前端漏传/漏判时，后端没有任何一处能拦住。

本模块把"批量保存资产图片提示词"收成一个**全有或全无**的事务操作，
四类资产（角色 / 场景 / 道具 / 服装）走完全同构的一条路：

===========================================  ==========================================
步骤                                          失败时
===========================================  ==========================================
1 资产存在且属于该项目                         404 / 400（中文）
2 逐资产质量拦截（空 / 空话 / 名字+通用词）     422 结构化中文错误（可照做修）
3 **跨资产查重**（不同资产逐字或高度重复）        409 结构化冲突
4 覆盖保护（已有提示词默认不动）                 409，需 ``confirm_replace_image_prompt``
5 只写出现变化的槽位（合并而不是整表替换）         同事务提交
===========================================  ==========================================

第 5 步刻意**合并**而不是整表替换：调用方只提交本次要保存的槽位，
其余槽位（人工写过的、上一轮生成的）原样保留 —— 这是"不许被自动覆盖"的另一半。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import ProjectCostumeLink, ProjectPropLink, ProjectSceneLink
from app.services.studio.asset_prompt_quality import (
    check_cross_asset_duplicates,
    ensure_image_prompts_not_silently_replaced,
    raise_for_quality,
    validate_asset_image_prompts,
)
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.product_guardrails import reject_placeholder_text

#: 允许在本入口保存提示词的资产类型（演员不在其中：演员形象走另一条链路）
SUPPORTED_ASSET_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume")

_LINK_MODELS: dict[str, tuple[type, str]] = {
    "scene": (ProjectSceneLink, "scene_id"),
    "prop": (ProjectPropLink, "prop_id"),
    "costume": (ProjectCostumeLink, "costume_id"),
}


@dataclass(slots=True)
class _Target:
    asset_type: str
    asset_id: str
    row: Any
    incoming: dict[str, str]


async def _load_project_asset(db: AsyncSession, *, asset_type: str, asset_id: str, project_id: str) -> Any:
    """取项目内的资产行；不在项目内/不存在都要给出可解释的中文错误。"""
    spec = entity_spec(asset_type)
    row = await db.get(spec.model, asset_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"资产不存在：{asset_type}/{asset_id}")
    if asset_type == "character":
        if str(getattr(row, "project_id", "")) != project_id:
            raise HTTPException(
                status_code=400,
                detail=f"角色「{getattr(row, 'name', asset_id)}」不属于项目 {project_id}",
            )
        return row
    link_model, link_field = _LINK_MODELS[asset_type]
    linked = (
        (
            await db.execute(
                select(link_model.id)
                .where(link_model.project_id == project_id)
                .where(getattr(link_model, link_field) == asset_id)
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if linked is None:
        raise HTTPException(
            status_code=400,
            detail=f"资产「{getattr(row, 'name', asset_id)}」（{asset_type}）尚未关联到项目 {project_id}",
        )
    return row


async def _collect_targets(
    db: AsyncSession,
    *,
    project_id: str,
    items: list[Mapping[str, Any]],
) -> list[_Target]:
    """形状检查 + 取资产行（任何一项不合规都整批拒绝）。"""
    targets: list[_Target] = []
    seen: set[tuple[str, str]] = set()
    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, Mapping):
            raise HTTPException(status_code=422, detail=f"第 {index} 项不是对象。")
        raw_type = str(raw.get("asset_type") or "").strip().lower()
        if raw_type not in SUPPORTED_ASSET_TYPES:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"第 {index} 项的 asset_type「{raw.get('asset_type') or '空'}」不支持："
                    f"本入口只处理 {list(SUPPORTED_ASSET_TYPES)}（演员形象走另一条链路）。"
                ),
            )
        asset_type = normalize_entity_type(raw_type)
        asset_id = str(raw.get("asset_id") or "").strip()
        if not asset_id:
            raise HTTPException(status_code=422, detail=f"第 {index} 项缺少 asset_id。")
        key = (asset_type, asset_id)
        if key in seen:
            raise HTTPException(
                status_code=422,
                detail=f"第 {index} 项的资产（{asset_type}/{asset_id}）重复出现：同一资产在一次请求里只能出现一次。",
            )
        seen.add(key)
        prompts = raw.get("image_prompts")
        if not isinstance(prompts, Mapping) or not prompts:
            raise HTTPException(
                status_code=422,
                detail=f"第 {index} 项（{asset_type}/{asset_id}）没有提交任何图片提示词槽位。",
            )
        row = await _load_project_asset(db, asset_type=asset_type, asset_id=asset_id, project_id=project_id)
        targets.append(
            _Target(
                asset_type=asset_type,
                asset_id=asset_id,
                row=row,
                incoming={str(slot): str(text or "") for slot, text in prompts.items()},
            )
        )
    return targets


def _cross_asset_items(targets: list[_Target]) -> list[tuple[str, str, str]]:
    """把待写入内容摊平成查重输入：``(资产键, 展示名, 文本)``。"""
    items: list[tuple[str, str, str]] = []
    for target in targets:
        name = str(getattr(target.row, "name", "") or target.asset_id)
        for slot, text in target.incoming.items():
            items.append((f"{target.asset_type}:{target.asset_id}", f"{name}（{slot}）", text))
    return items


async def save_asset_image_prompts(
    db: AsyncSession,
    *,
    project_id: str,
    items: list[Mapping[str, Any]],
    raw_body: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """批量保存资产图片提示词（**全有或全无**）。

    ``items`` 每项形如::

        {"asset_type": "character", "asset_id": "char-1",
         "image_prompts": {"character_image_front": "…"}}

    成功返回 ``{"saved": [...], "summary": {...}}``；任何一项不合规整批拒绝、库里零改动。
    """
    if not items:
        raise HTTPException(status_code=400, detail="items 不能为空：请至少提交一项资产的图片提示词。")

    targets = await _collect_targets(db, project_id=project_id, items=items)

    # ---- 2 逐资产质量拦截（含演练占位）----
    for target in targets:
        name = str(getattr(target.row, "name", "") or target.asset_id)
        reject_placeholder_text(target.incoming, field="image_prompts")
        validate_asset_image_prompts(
            target.incoming,
            asset_key=f"{target.asset_type}:{target.asset_id}",
            asset_name=name,
            asset_type=target.asset_type,
        )

    # ---- 3 跨资产查重 ----
    raise_for_quality(check_cross_asset_duplicates(_cross_asset_items(targets)))

    # ---- 4 覆盖保护 ----
    for target in targets:
        ensure_image_prompts_not_silently_replaced(
            getattr(target.row, "image_prompts", None),
            target.incoming,
            raw_body=raw_body,
            asset_name=str(getattr(target.row, "name", "") or target.asset_id),
        )

    # ---- 5 合并写入（只动提交过的槽位）----
    saved: list[dict[str, Any]] = []
    for target in targets:
        merged = dict(getattr(target.row, "image_prompts", None) or {})
        changed: list[str] = []
        for slot, text in target.incoming.items():
            value = str(text or "").strip()
            if merged.get(slot) != value:
                changed.append(slot)
            merged[slot] = value
        target.row.image_prompts = merged
        saved.append(
            {
                "asset_type": target.asset_type,
                "asset_id": target.asset_id,
                "name": str(getattr(target.row, "name", "") or ""),
                "unchanged": not changed,
                "saved_slots": sorted(changed),
                "prompt_slot_count": len([v for v in merged.values() if str(v or "").strip()]),
            }
        )

    await db.flush()

    return {
        "project_id": project_id,
        "saved": saved,
        "summary": {
            "asset_total": len(saved),
            "asset_changed": len([item for item in saved if not item["unchanged"]]),
            "slot_saved": sum(len(item["saved_slots"]) for item in saved),
        },
        "note": (
            "已保存到各资产的 image_prompts（只写入本次提交的槽位，其它槽位原样保留）。"
            "生产区读同一份数据（GET /studio/projects/{project_id}/asset-readiness），无需再次同步。"
        ),
    }


__all__ = [
    "SUPPORTED_ASSET_TYPES",
    "save_asset_image_prompts",
]
