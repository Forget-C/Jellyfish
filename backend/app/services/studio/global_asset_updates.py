"""全局资产的**显式更新**：先给差异，再由用户确认，绝不默认写回。

用户口径（2026-09 补充）
========================

> 场景 / 道具 / 服装属于**全局资产**时，本章提取出的剧情身份、出场依据、临时补充
> 必须按项目/章节隔离保存，**不得静默覆盖全局资产的通用资料或图片提示词**；
> 若确实要更新全局资产，必须**明确展示差异并由用户确认**。

本模块只做两件事，**都不自动执行**：

1. :func:`preview_global_updates`——算出"如果把本章资料里**属于通用资料**的那部分
   合并进全局资产，会变成什么样"，并按「；」分段给出 added / removed / unchanged；
2. :func:`apply_global_updates`——**必须**带 ``confirm: true`` 且逐项列出
   ``asset_type + asset_id + apply[]`` 才会写；没带确认就直接结构化 409（含差异摘要）。

字段边界（刻意收窄，避免"顺手把本章剧情写进全局"）：

- **通用资料字段**（``general_field_keys``）→ 允许合并进全局 ``description``；
- **本章特有字段**（``CHAPTER_TEMPORAL_FIELDS``：场景的时间天气/光线色调/相关事件、
  道具的状态/剧情作用、服装的使用场合、角色的相关剧情）→ **永远不进全局**，
  只留在章节 overlay 里；
- ``image_prompts`` → 默认**完全不动**；要动必须同时带
  ``confirm_replace_image_prompt: true``（沿用 ``asset_prompt_quality`` 的既有保护）；
  并且只允许写本次显式提交的槽位。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter
from app.services.common import entity_not_found
from app.services.studio.asset_overlays import (
    diff_segments,
    general_field_keys,
    is_global_asset,
    load_chapter_overlays,
    overlay_to_profile_text,
    temporal_field_keys,
)
from app.services.studio.asset_profiles import field_label, normalize_asset_type
from app.services.studio.asset_prompt_quality import (
    IMAGE_PROMPT_CONFIRM_FIELD,
    confirm_image_prompt_replace_requested,
    ensure_image_prompts_not_silently_replaced,
    validate_asset_image_prompts,
)
from app.services.studio.entity_specs import entity_spec

#: 允许写回全局的字段（白名单，有序，便于错误提示里照抄）
APPLICABLE_FIELDS: tuple[str, ...] = ("description", "image_prompts")

#: 确认开关字段名
GLOBAL_UPDATE_CONFIRM_FIELD = "confirm"

GLOBAL_UPDATE_CODE = "global_asset_update_required"


async def _load_chapter(db: AsyncSession, *, chapter_id: str) -> Chapter:
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))
    return chapter


async def _load_asset_row(db: AsyncSession, *, asset_type: str, asset_id: str) -> Any:  # noqa: ANN401
    spec = entity_spec(asset_type)
    row = await db.get(spec.model, asset_id)
    if row is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "global_asset_not_found",
                "message": f"全局资产不存在：{asset_type}/{asset_id}",
                "fix": "请先重新生成本章清单，确认该资产 id 仍然有效。",
            },
        )
    return row


def _proposed_description(*, current: str, chapter_general_text: str) -> str:
    """把"本章通用资料"合并进全局描述（逐段去重、保序，不改写已有措辞）。"""
    parts: list[str] = []
    for source in (current, chapter_general_text):
        for segment in str(source or "").split("；"):
            seg = segment.strip()
            if seg and seg not in parts:
                parts.append(seg)
    return "；".join(parts)


async def preview_global_updates(
    db: AsyncSession,
    *,
    chapter_id: str,
    asset_types: list[str] | None = None,
) -> dict[str, Any]:
    """算出"要不要把本章资料合并进全局资产"，并给出可读差异（**只读，不写库**）。"""
    chapter = await _load_chapter(db, chapter_id=chapter_id)
    overlays = await load_chapter_overlays(db, chapter_id=chapter_id)
    wanted = {str(item).strip().lower() for item in (asset_types or []) if str(item).strip()}

    items: list[dict[str, Any]] = []
    for overlay in overlays:
        asset_type = normalize_asset_type(overlay.get("asset_type")) or ""
        if not is_global_asset(asset_type):
            continue
        if wanted and asset_type not in wanted:
            continue
        asset_id = str(overlay.get("asset_id") or overlay.get("linked_entity_id") or "")
        if not asset_id:
            items.append(
                {
                    "asset_type": asset_type,
                    "name": overlay.get("name"),
                    "asset_id": "",
                    "applicable": False,
                    "reason": "本章资料还没有关联到具体全局资产，无从比较。",
                }
            )
            continue
        row = await _load_asset_row(db, asset_type=asset_type, asset_id=asset_id)
        current_description = str(getattr(row, "description", "") or "").strip()
        chapter_general_text = overlay_to_profile_text(overlay, include_temporal=False)
        proposed = _proposed_description(current=current_description, chapter_general_text=chapter_general_text)
        existing_prompts = {
            str(key): str(value)
            for key, value in (dict(getattr(row, "image_prompts", None) or {})).items()
            if str(value or "").strip()
        }
        items.append(
            {
                "asset_type": asset_type,
                "name": overlay.get("name"),
                "asset_id": asset_id,
                "global_asset": True,
                "scope_note": (
                    "全局资产：本章的剧情身份 / 出场依据 / 本章特有字段已按章节隔离保存，"
                    "这里只是在回答「要不要把**通用资料**也合并进全局」。"
                ),
                "chapter_scope": {
                    "plot_identity": overlay.get("plot_identity"),
                    "temporary_notes": overlay.get("temporary_notes"),
                    "shot_refs": overlay.get("shot_refs"),
                    "evidence": overlay.get("evidence"),
                    "chapter_only_fields": [
                        field_label(asset_type, key) for key in temporal_field_keys(asset_type)
                    ],
                },
                "diff": {
                    "description": {
                        "before": current_description,
                        "proposed": proposed,
                        **diff_segments(current_description, proposed),
                    },
                    "image_prompts": {
                        "changed": False,
                        "existing_slots": sorted(existing_prompts),
                        "note": (
                            "本接口**不会**改动图片提示词；确实要改需在 apply 里显式列上 "
                            f"\"{IMAGE_PROMPT_CONFIRM_FIELD}\": true 与要写的槽位。"
                        ),
                    },
                },
                "general_fields": [field_label(asset_type, key) for key in general_field_keys(asset_type)],
                "applicable": bool(diff_segments(current_description, proposed)["changed"]),
                "requires_confirmation": True,
            }
        )

    return {
        "chapter_id": chapter_id,
        "project_id": chapter.project_id,
        "items": items,
        "summary": {
            "total": len(items),
            "with_diff": len([item for item in items if item.get("applicable")]),
            "chapter_scoped": len([item for item in items if item.get("asset_id")]),
        },
        "apply_endpoint": f"POST /api/v1/studio/chapters/{chapter_id}/asset-profiles/global-updates/apply",
        "note": (
            "这是**差异预览**：不写库、不改全局资产、不动图片提示词。"
            "要写回全局，必须调用 apply 并在请求体里带 "
            f"\"{GLOBAL_UPDATE_CONFIRM_FIELD}\": true 且逐项列出 asset_type/asset_id/apply[]。"
        ),
    }


def _requested_items(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "global_update_items_required",
                "message": "apply 必须先逐项列出要更新的全局资产（asset_type / asset_id / apply[]）。",
                "fix": "请先调用 global-updates/preview 查看差异，再按它返回的 asset_id 提交 items。",
            },
        )
    items: list[dict[str, Any]] = []
    for index, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail=f"items 第 {index} 项不是对象。")
        asset_type = normalize_asset_type(entry.get("asset_type"))
        if asset_type is None:
            raise HTTPException(
                status_code=422,
                detail=f"items 第 {index} 项的 asset_type 非法（只能是 character/scene/prop/costume）。",
            )
        asset_id = str(entry.get("asset_id") or "").strip()
        if not asset_id:
            raise HTTPException(status_code=422, detail=f"items 第 {index} 项缺少 asset_id。")
        apply_fields = [str(value).strip() for value in (entry.get("apply") or []) if str(value).strip()]
        unknown = sorted(set(apply_fields) - set(APPLICABLE_FIELDS))
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"items 第 {index} 项的 apply 里有不支持的字段 {unknown}："
                    f"只允许 {list(APPLICABLE_FIELDS)}（全局资产更新是白名单操作）。"
                ),
            )
        items.append({"asset_type": asset_type, "asset_id": asset_id, "apply": apply_fields})
    return items


async def apply_global_updates(
    db: AsyncSession,
    *,
    chapter_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """把本章**通用资料**合并进指定的全局资产（**必须显式确认**）。

    写库前会做三件事，并且**全有或全无**：

    1. 校验 ``confirm: true``（没带 → 结构化 409，并把差异摘要一起返回，用户看着差异决定）；
    2. 校验白名单字段（``apply`` 只能含 ``description`` / ``image_prompts``）；
    3. ``image_prompts`` 走既有覆盖保护（``confirm_replace_image_prompt``）。
    """
    preview = await preview_global_updates(db, chapter_id=chapter_id)
    by_id = {(str(item.get("asset_type")), str(item.get("asset_id"))): item for item in preview["items"]}
    items = _requested_items(body.get("items"))

    if not isinstance(body, dict) or not body.get(GLOBAL_UPDATE_CONFIRM_FIELD):
        raise HTTPException(
            status_code=409,
            detail={
                "code": GLOBAL_UPDATE_CODE,
                "message": (
                    "更新全局资产需要**显式确认**：全局资产的通用资料会被所有项目共用，"
                    "本次不会自动写回。"
                ),
                "fix": (
                    "请先看差异（global-updates/preview），确认无误后在请求体里带上 "
                    f'"{GLOBAL_UPDATE_CONFIRM_FIELD}": true 再提交。'
                ),
                "confirm_field": GLOBAL_UPDATE_CONFIRM_FIELD,
                "requested": [
                    {"asset_type": item["asset_type"], "asset_id": item["asset_id"], "apply": item["apply"]}
                    for item in items
                ],
                "diff": [
                    {
                        "asset_type": entry.get("asset_type"),
                        "asset_id": entry.get("asset_id"),
                        "name": entry.get("name"),
                        "description": (entry.get("diff") or {}).get("description", {}),
                    }
                    for entry in preview["items"]
                    if (str(entry.get("asset_type")), str(entry.get("asset_id")))
                    in {(item["asset_type"], item["asset_id"]) for item in items}
                ],
            },
        )

    results: list[dict[str, Any]] = []
    for item in items:
        entry = by_id.get((item["asset_type"], item["asset_id"]))
        if entry is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "global_update_target_unknown",
                    "message": (
                        f"本章资料里没有 {item['asset_type']}/{item['asset_id']} 对应的条目，"
                        "不能凭 asset_id 直接改全局资产。"
                    ),
                    "fix": "请用 preview 返回的 asset_id；若资产换了，请重新生成本章清单。",
                },
            )
        row = await _load_asset_row(db, asset_type=item["asset_type"], asset_id=item["asset_id"])
        applied: list[str] = []
        if "description" in item["apply"]:
            proposed = str(((entry.get("diff") or {}).get("description") or {}).get("proposed") or "")
            if proposed and proposed != str(getattr(row, "description", "") or "").strip():
                row.description = proposed
                applied.append("description")
        if "image_prompts" in item["apply"]:
            incoming = body.get("image_prompts") or {}
            ensure_image_prompts_not_silently_replaced(
                getattr(row, "image_prompts", None),
                incoming,
                raw_body=body,
                asset_name=str(entry.get("name") or item["asset_id"]),
            )
            validate_asset_image_prompts(
                incoming,
                asset_key=f"{item['asset_type']}:{item['asset_id']}",
                asset_name=str(entry.get("name") or item["asset_id"]),
                asset_type=item["asset_type"],
            )
            merged = dict(getattr(row, "image_prompts", None) or {})
            for slot, text in incoming.items():
                merged[str(slot)] = str(text or "").strip()
            row.image_prompts = merged
            applied.append("image_prompts")
        results.append(
            {
                "asset_type": item["asset_type"],
                "asset_id": item["asset_id"],
                "name": entry.get("name"),
                "requested": item["apply"],
                "applied": applied,
                "unchanged": not applied,
            }
        )

    await db.flush()
    return {
        "chapter_id": chapter_id,
        "results": results,
        "summary": {
            "requested": len(results),
            "applied": len([item for item in results if not item["unchanged"]]),
        },
        "note": (
            "只写入了显式列出的白名单字段；本章特有字段（时间天气/光线色调/状态/场合/相关剧情）"
            "仍然只保留在章节 overlay 里，符合「按章节隔离」的边界。"
        ),
    }


__all__ = [
    "APPLICABLE_FIELDS",
    "GLOBAL_UPDATE_CODE",
    "GLOBAL_UPDATE_CONFIRM_FIELD",
    "apply_global_updates",
    "preview_global_updates",
]
