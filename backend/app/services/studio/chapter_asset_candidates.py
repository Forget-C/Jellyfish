"""集级资产清单：把一章内各镜头的提取候选聚合成"本集要建哪些资产"。

对应六步流程的**步骤 2（提取资产）**：
"从当前剧本提取人物、道具、场景，合并重复项，确认资产清单，支持选用已有资产。"

现有能力的缺口与复用：
- 提取：``POST /api/v1/script-processing/extract``（已有，按镜头，写 ``shot_extracted_candidates``）；
- 合并：``POST /api/v1/script-processing/merge-entities``（已有真 LLM agent，但此前无前端入口）；
- 建/绑：``POST /api/v1/studio/entities/{type}`` 与既有 link 端点（已有）；
- **缺的**：把"这一集提取到的所有候选"按名称/类型聚合成一张可确认的清单，
  并告诉用户**同名资产是否已存在**（用于"选用已有资产"而不是重复创建）。

本模块只做聚合与存在性提示，**不建资产、不写库**——确认动作仍由用户触发既有端点。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Shot, ShotExtractedCandidate
from app.models.types import ShotCandidateStatus
from app.services.common import entity_not_found
from app.services.studio.entity_existence import check_names_existence
from app.services.studio.llm_orchestration.json_utils import normalize_name

CANDIDATE_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume")

# 候选类型 → existence-check 的**入参**字段名（注意：返回值里是复数桶名，见下）
_EXISTENCE_INPUT: dict[str, str] = {
    "character": "character_names",
    "scene": "scene_names",
    "prop": "prop_names",
    "costume": "costume_names",
}

# 候选类型 → existence-check 的**返回**桶名（实测为 characters/props/scenes/costumes）
_EXISTENCE_OUTPUT: dict[str, str] = {
    "character": "characters",
    "scene": "scenes",
    "prop": "props",
    "costume": "costumes",
}

# 候选类型 → 交付/界面用的中文标签
TYPE_LABELS: dict[str, str] = {
    "character": "人物",
    "scene": "场景",
    "prop": "道具",
    "costume": "服装",
}


def _type_of(raw: Any) -> str:
    return str(getattr(raw, "value", raw) or "").strip().lower()


def _status_of(raw: Any) -> str:
    return str(getattr(raw, "value", raw) or "").strip().lower()


def _clip(text: Any, limit: int = 120) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else value[:limit].rstrip() + "…"


async def build_chapter_asset_candidates(
    db: AsyncSession,
    *,
    chapter_id: str,
    include_ignored: bool = False,
) -> dict[str, Any]:
    """聚合一章的提取候选，并标注是否已有同名资产。

    返回::

        {
          "chapter_id", "project_id", "chapter_title",
          "shot_total", "shot_with_candidates",
          "summary": {"total_candidates", "merged_groups", "by_type": {...}, "by_status": {...}},
          "items": [
            {"candidate_type", "type_label", "name", "aliases",
             "shot_count", "shot_ids", "statuses", "linked_entity_id",
             "existing_asset_id", "existing_asset_name",
             "linked_to_project", "linked_to_shot",
             "recommendation": "link_existing" | "create_new"}
          ]
        }
    """
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))
    project_id = chapter.project_id

    shot_rows = (
        (await db.execute(select(Shot).where(Shot.chapter_id == chapter_id).order_by(Shot.index))).scalars().all()
    )
    shot_index_by_id = {shot.id: shot.index for shot in shot_rows}

    stmt = (
        select(ShotExtractedCandidate)
        .where(ShotExtractedCandidate.shot_id.in_([shot.id for shot in shot_rows] or [""]))
        .order_by(ShotExtractedCandidate.candidate_type, ShotExtractedCandidate.candidate_name)
    )
    rows = (await db.execute(stmt)).scalars().all()

    # 按 (类型, 归一化名称) 聚合：这一步就是"合并重复项"
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    display_names: dict[tuple[str, str], str] = {}
    for row in rows:
        ctype = _type_of(row.candidate_type)
        if ctype not in CANDIDATE_TYPES:
            continue
        status_value = _status_of(row.candidate_status)
        if status_value == ShotCandidateStatus.ignored.value and not include_ignored:
            continue
        name = str(row.candidate_name or "").strip()
        key = (ctype, normalize_name(name))
        if not key[1]:
            continue
        entry = groups.get(key)
        if entry is None:
            entry = {
                "candidate_type": ctype,
                "type_label": TYPE_LABELS.get(ctype, ctype),
                "name": name,
                "aliases": set(),
                "shot_ids": set(),
                "statuses": defaultdict(int),
                "linked_entity_id": None,
            }
            groups[key] = entry
            display_names[key] = name
        else:
            # 同类型下名称不同写法（空格/全半角差异）也算别名
            if normalize_name(name) != normalize_name(entry["name"]) and name != entry["name"]:
                entry["aliases"].add(name)
        entry["shot_ids"].add(str(row.shot_id))
        entry["statuses"][status_value] += 1
        if row.linked_entity_id and not entry["linked_entity_id"]:
            entry["linked_entity_id"] = str(row.linked_entity_id)

    # 名称存在性：告诉用户"已有同名资产"，支持"选用已有资产"
    names_by_bucket: dict[str, list[str]] = {bucket: [] for bucket in _EXISTENCE_INPUT.values()}
    for entry in groups.values():
        bucket = _EXISTENCE_INPUT.get(entry["candidate_type"])
        if bucket:
            names_by_bucket[bucket].append(entry["name"])

    existing: dict[tuple[str, str], dict[str, Any]] = {}
    if any(names_by_bucket.values()):
        try:
            checked = await check_names_existence(
                db,
                project_id=project_id,
                shot_id=None,
                character_names=names_by_bucket["character_names"],
                prop_names=names_by_bucket["prop_names"],
                scene_names=names_by_bucket["scene_names"],
                costume_names=names_by_bucket["costume_names"],
            )
        except HTTPException:
            checked = {}
        for ctype, bucket in _EXISTENCE_OUTPUT.items():
            for item in checked.get(bucket) or []:
                if not isinstance(item, dict):
                    continue
                existing[(ctype, normalize_name(item.get("name")))] = item

    items: list[dict[str, Any]] = []
    by_type: dict[str, int] = defaultdict(int)
    by_status: dict[str, int] = defaultdict(int)
    for (ctype, key_name), entry in groups.items():
        hit = existing.get((ctype, key_name)) or {}
        exists = bool(hit.get("exists"))
        shot_ids = sorted(entry["shot_ids"], key=lambda sid: shot_index_by_id.get(sid, 10**6))
        items.append(
            {
                "candidate_type": ctype,
                "type_label": entry["type_label"],
                "name": entry["name"],
                "aliases": sorted(entry["aliases"]),
                "shot_count": len(shot_ids),
                "shot_ids": shot_ids,
                "statuses": dict(entry["statuses"]),
                "linked_entity_id": entry["linked_entity_id"],
                "existing_asset_id": hit.get("asset_id"),
                "linked_to_project": bool(hit.get("linked_to_project")),
                "linked_to_shot": bool(hit.get("linked_to_shot")),
                # 已有同名资产 → 建议"选用已有"；否则建议"新建"
                "recommendation": "link_existing" if exists else "create_new",
            }
        )
        by_type[ctype] += 1
        for status_value, count in entry["statuses"].items():
            by_status[status_value] += count

    items.sort(key=lambda item: (CANDIDATE_TYPES.index(item["candidate_type"]), -item["shot_count"], item["name"]))
    shots_with = len({sid for item in items for sid in item["shot_ids"]})

    return {
        "chapter_id": chapter_id,
        "project_id": project_id,
        "chapter_title": chapter.title or "",
        "shot_total": len(shot_rows),
        "shot_with_candidates": shots_with,
        "summary": {
            "total_candidates": sum(item["shot_count"] for item in items),
            "merged_groups": len(items),
            "by_type": dict(by_type),
            "by_status": dict(by_status),
            "link_existing_count": len([item for item in items if item["recommendation"] == "link_existing"]),
            "create_new_count": len([item for item in items if item["recommendation"] == "create_new"]),
        },
        "items": items,
        "notes": [
            "本接口只聚合与提示，不创建资产、不写库；确认时请调用 /api/v1/studio/entities/{type}"
            "（新建）或既有 link 端点（选用已有）。",
            "「合并重复项」在此按类型+归一化名称聚合；如需大模型跨镜合并画像，请调用"
            " /api/v1/script-processing/merge-entities。",
        ],
    }


__all__ = ["build_chapter_asset_candidates", "CANDIDATE_TYPES", "TYPE_LABELS"]
