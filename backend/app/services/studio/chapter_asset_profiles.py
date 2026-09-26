"""第 2 步「资产准备」的数据源：**基于本章完整剧本 + 分镜**生成规范化资产清单。

要解决的问题（一条数据链路，不是页面补丁）
==========================================

原先这一段的真实链路是：

    /script-processing/extract（按镜头提取）
      → shot_extracted_candidates（payload 只留 id/file_id/thumbnail/description）
      → 人工逐条确认 → characters/scenes/props/costumes.description（常常是空）
      → /studio/llm/image-prompt/preview 只读 description
      → 画像卡兜底成「外观信息不足，需人工补充」，并被要求**逐字**写进提示词

所以图片提示词拿不到剧本里的资产资料，不是页面少画了东西，而是**中间三层都把资料丢了**。

本模块补的就是中间这一层，并且**复用上游"整集剧本分析"的能力而不是另造一套**：

- 文本模型调用走既有编排层 ``llm_orchestration.client``（``resolve_text_llm_target`` +
  ``call_text_llm``，含 DRY_RUN 守卫），**不新建 Provider、不新建 client**；
- 章节原文读既有 ``llm_orchestration.context.load_chapter_source``；
- 候选聚合复用既有 ``chapter_asset_candidates.build_chapter_asset_candidates``
  （类型 + 归一化名称聚合、别名收集、已有同名资产检测）；
- 结构化字段规格来自 ``asset_profiles``（四类资产各一套），术语表与上游四个
  "信息缺失分析" agent（人物画像 / 场景 / 道具 / 服装）保持一致；
- 存在性判定复用既有 ``entity_existence.check_names_existence``。

产出结构（**用户主流程**与**技术详情**分开，前端默认收起后者）：

- ``user_flow``：一行一个资产 —— 类型、规范名、别名、结构化资料、缺什么、
  出场镜头与剧本原文依据、建议动作（新建 / 选用已有）、是否需要人工处理及原因；
- ``technical_detail``：原始候选、聚合组、内部匹配状态、别名合并过程、
  被丢弃的模型条目、大模型调用元信息。

**本模块只读 + 只预览，不建资产、不写库。** 确认动作在
``chapter_asset_profile_confirm`` 里，一事务内建/绑资产并保留全部来源证据。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Shot
from app.services.common import entity_not_found
from app.services.studio.asset_profiles import (
    ASSET_TYPES,
    all_asset_type_schemas_for_prompt,
    field_specs,
    normalize_asset_type,
    normalize_profile,
    profile_completeness,
    profile_missing_fields,
    render_profile_text,
    type_label,
)
from app.services.studio.chapter_asset_candidates import (
    build_chapter_asset_candidates,
)
from app.services.studio.chapter_asset_profile_cache import (
    build_chapter_profile_cache_key,
    build_chapter_source_hash,
    get_cached_chapter_profile,
    set_cached_chapter_profile,
)
from app.services.studio.entity_existence import check_names_existence
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import (
    LLMRequestError,
    TextLLMCaller,
    TextLLMTarget,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.context import load_chapter_source
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_str,
    coerce_str_list,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import CHAPTER_ASSET_PROFILE_TEMPLATE
from app.services.studio.llm_orchestration.support import build_run_meta, dry_run_warning

#: 参与本流程的资产类型（与候选类型一致）
CANDIDATE_TYPES: tuple[str, ...] = ASSET_TYPES

#: 出场镜头依据里，每段剧本原文保留的字符数上限（脱敏/控体积）
MAX_EVIDENCE_CHARS = 240
#: 单个资产的出场镜头证据条数上限
MAX_EVIDENCE_SHOTS = 12
#: 一次结构化提取返回的资产条数上限
MAX_ITEMS = 60

PLACEHOLDER_PREFIX = "[DRY_RUN 占位]"


# ---------------------------------------------------------------------------
# 组装 LLM 输入
# ---------------------------------------------------------------------------


def build_shot_list_text(shots: list[dict[str, Any]]) -> str:
    """把本章分镜渲染成提示词里的一段（带镜头 id 与序号，便于回填出场镜头）。"""
    lines: list[str] = []
    for shot in shots:
        excerpt = str(shot.get("script_excerpt") or "").strip() or "（本镜无剧本摘录）"
        lines.append(f"- 镜头 {shot.get('index')}（{shot.get('shot_id')}）｜{shot.get('title') or '未命名'}：{excerpt}")
    return "\n".join(lines) if lines else "（本章还没有分镜；请只依据剧本原文提取资产。）"


def build_candidate_list_text(groups: list[dict[str, Any]]) -> str:
    """把聚合后的候选组渲染出来（**告诉模型"已经有哪些资产"，避免自创新名字**）。"""
    if not groups:
        return "（本章还没有提取候选；请完全依据剧本原文提取。）"
    lines: list[str] = []
    for item in groups:
        aliases = "、".join(item.get("aliases") or []) or "无"
        lines.append(
            f"- [{item.get('candidate_type')}] {item.get('name')}（别名：{aliases}；"
            f"出现镜头数：{item.get('shot_count')}）"
        )
    return "\n".join(lines)


def build_chapter_asset_profile_prompt(
    *,
    chapter_title: str,
    chapter_text: str,
    shot_list_text: str,
    candidate_list_text: str,
    extra_instructions: str = "",
) -> str:
    """构造结构化资产清单的提示词（模板在 ``prompt_templates`` 里，字段表来自 asset_profiles）。"""
    return CHAPTER_ASSET_PROFILE_TEMPLATE.safe_substitute(
        chapter_title=chapter_title or "未命名章节",
        chapter_text=chapter_text,
        shot_list=shot_list_text,
        candidate_list=candidate_list_text,
        field_schemas=all_asset_type_schemas_for_prompt(),
        max_items=str(MAX_ITEMS),
        extra_instructions=str(extra_instructions or "").strip() or "无。",
    )


# ---------------------------------------------------------------------------
# 确定性后处理
# ---------------------------------------------------------------------------


def _clip(text: Any, limit: int = MAX_EVIDENCE_CHARS) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "…"


def extract_raw_asset_items(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """从模型 JSON 里取出资产数组（兼容几种常见顶层写法）。"""
    for key in ("assets", "items", "asset_list", "results"):
        value = parsed.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    for value in parsed.values():
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            return list(value)
    raise JSONParseError("模型返回的 JSON 里找不到资产数组（assets）。")


def shot_refs_for_name(
    name: str,
    aliases: list[str],
    shots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """该资产在哪些镜头出现（按归一化名/别名匹配剧本摘录），并带上原文依据。

    ``shot_refs`` 是"哪一段原文、哪个镜头 id/序号"的落地形式 —— 用户要求的
    "保留剧本片段/分镜依据"就是这一份数据，它同时进 ``user_flow``（可读）
    与候选表 ``payload``（可追溯）。
    """
    keys = [normalize_name(name), *(normalize_name(alias) for alias in aliases)]
    keys = [key for key in keys if key]
    refs: list[dict[str, Any]] = []
    for shot in shots:
        haystack = normalize_name(shot.get("script_excerpt") or "")
        matched = next((key for key in keys if key and key in haystack), "")
        if not matched:
            continue
        refs.append(
            {
                "shot_id": str(shot.get("shot_id") or ""),
                "shot_index": int(shot.get("index") or 0),
                "title": str(shot.get("title") or ""),
                "matched": matched,
                "script_excerpt": _clip(shot.get("script_excerpt")),
            }
        )
        if len(refs) >= MAX_EVIDENCE_SHOTS:
            break
    return refs


def _grounded_in_chapter(name: str, aliases: list[str], chapter_haystack: str) -> bool:
    """名称/别名是否能在**本章原文**里找到（不在原文里 = 幻觉，丢弃）。"""
    for value in (name, *aliases):
        key = normalize_name(value)
        if key and key in chapter_haystack:
            return True
    return False


def merge_model_items_into_groups(
    *,
    model_items: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    chapter_haystack: str,
) -> tuple[dict[tuple[str, str], dict[str, Any]], list[dict[str, Any]]]:
    """把模型返回的资产条目并进聚合组；返回 ``(并入结果, 被丢弃的条目)``。

    并入规则（**别名与重复候选在这里合成一组**）：

    1. 归一化名称与某个组的名称/别名一致 → 并进该组（组里的别名集合被扩充）；
    2. 名称在原文里，但不在任何组里 → 建一个新的 ``llm_new`` 组
       （说明提取候选漏了它，不能白丢）；
    3. 名称在**另一类**资产里已经用过同名 → 并入那一组（类型以候选表为准，
       并记一条冲突说明给人工看）；
    4. 名称在原文里找不到，或类型不在四类之内 → 丢弃并给中文原因。

    "保留所有来源证据"体现在：并进同一组的每个模型条目都会在
    ``sources`` 里留下自己的原始名称 + 原始字段，别名集合是并集而不是覆盖。
    """
    by_key: dict[tuple[str, str], dict[str, Any]] = {
        (str(group["candidate_type"]), normalize_name(group["name"])): {
            **group,
            "aliases": list(group.get("aliases") or []),
            "sources": [],
            "model_fields": {},
            "model_names": [],
        }
        for group in groups
    }
    dropped: list[dict[str, Any]] = []

    for raw in model_items:
        name = coerce_str(raw.get("name"))
        if not name:
            dropped.append({"name": "", "asset_type": "", "reason": "模型返回的条目没有 name，已丢弃。"})
            continue
        aliases = [alias for alias in coerce_str_list(raw.get("aliases")) if alias and alias != name]
        asset_type = normalize_asset_type(raw.get("asset_type") or raw.get("type"))
        if asset_type is None:
            dropped.append(
                {
                    "name": name,
                    "asset_type": str(raw.get("asset_type") or raw.get("type") or ""),
                    "reason": (
                        "资产类型不在本次支持范围内（只能是 character/scene/prop/costume），"
                        "已丢弃，不猜类型。"
                    ),
                }
            )
            continue
        if not _grounded_in_chapter(name, aliases, chapter_haystack):
            dropped.append(
                {
                    "name": name,
                    "asset_type": asset_type,
                    "reason": "名称与别名都无法在本章剧本原文中找到（疑似幻觉），已丢弃。",
                }
            )
            continue

        match_key = (asset_type, normalize_name(name))
        entry = by_key.get(match_key)
        if entry is None:
            # 名称对不上，但可能对得上同一类里的某个别名
            for key, candidate in by_key.items():
                if key[0] != asset_type:
                    continue
                alias_keys = {normalize_name(alias) for alias in candidate.get("aliases") or []}
                if normalize_name(name) in alias_keys:
                    entry = candidate
                    break
        if entry is None:
            entry = {
                "candidate_type": asset_type,
                "type_label": type_label(asset_type),
                "name": name,
                # 这一组的别名起点就是模型给的别名（候选表里没有它）
                "aliases": list(aliases),
                "shot_count": 0,
                "shot_ids": [],
                "statuses": {},
                "linked_entity_id": None,
                "existing_asset_id": None,
                "linked_to_project": False,
                "linked_to_shot": False,
                "recommendation": "create_new",
                "source_kind": "llm_new",
                "sources": [],
                "model_fields": {},
                "model_names": [],
            }
            by_key[(asset_type, normalize_name(name))] = entry

        merged_aliases = {str(alias) for alias in (entry.get("aliases") or []) if str(alias).strip()}
        if normalize_name(entry.get("name")) != normalize_name(name):
            merged_aliases.add(name)
        merged_aliases.update(aliases)
        entry["aliases"] = sorted(merged_aliases)
        entry["model_names"] = [*entry.get("model_names", []), name]
        fields = normalize_profile(asset_type, raw.get("fields") or raw.get("profile") or {})
        for key, value in fields.items():
            if value and not entry["model_fields"].get(key):
                entry["model_fields"][key] = value
        entry["sources"].append(
            {
                "name": name,
                "aliases": aliases,
                "asset_type": asset_type,
                "fields": fields,
                "evidence": coerce_str_list(raw.get("evidence")),
                "shot_indexes": [
                    int(index)
                    for index in (raw.get("shot_indexes") or [])
                    if isinstance(index, int) or str(index).isdigit()
                ],
            }
        )

    return by_key, dropped


def _assemble_user_flow_item(
    *,
    asset_type: str,
    name: str,
    aliases: list[str],
    profile: dict[str, str],
    shot_refs: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    shot_count: int,
    source_kind: str,
    existing_asset_id: str | None,
    linked_entity_id: str | None,
    linked_to_project: bool,
    linked_to_shot: bool,
    candidate_recommendation: Any,
) -> dict[str, Any]:
    """组装"用户主流程"里的一行（**生成路径与"从库里读"路径共用**）。

    两条路径共用同一个组装函数，是为了让"刚生成出来的清单"与"后端重启后从数据库
    读回来的清单"在结构上**逐字段同形** —— 否则"重启后直接恢复"就没法验证。
    """
    missing = profile_missing_fields(asset_type, profile)
    missing_visual = profile_missing_fields(asset_type, profile, visual_only=True)
    extra_aliases = sorted({str(alias) for alias in aliases if str(alias).strip()} - {name})
    return {
        "group_key": f"{asset_type}:{normalize_name(name)}",
        "asset_type": asset_type,
        "type_label": type_label(asset_type),
        "name": name,
        "display_name": (f"{name}（{'、'.join(extra_aliases)}）" if extra_aliases else name),
        "aliases": extra_aliases,
        "fields": profile,
        "summary": render_profile_text(asset_type, profile),
        "missing_fields": missing,
        "missing_visual_fields": missing_visual,
        "completeness": profile_completeness(asset_type, profile),
        "shot_refs": shot_refs,
        "evidence": evidence,
        "shot_count": shot_count,
        "source_kind": source_kind,
        # ↓ 内部匹配状态（用户主流程只用来决定"要不要人工处理"）
        "existing_asset_id": existing_asset_id,
        "linked_entity_id": linked_entity_id,
        "linked_to_project": bool(linked_to_project),
        "linked_to_shot": bool(linked_to_shot),
        "candidate_recommendation": candidate_recommendation,
        "notices": [],
    }


def _build_user_flow_item(
    *,
    entry: dict[str, Any],
    shots: list[dict[str, Any]],
    chapter_haystack: str,
) -> dict[str, Any]:
    """把聚合组 + 模型字段整理成"用户主流程"里的一行。"""
    asset_type = str(entry["candidate_type"])
    name = str(entry["name"])
    aliases = [str(alias) for alias in entry.get("aliases") or []]
    profile = normalize_profile(asset_type, entry.get("model_fields") or {})
    refs = shot_refs_for_name(name, aliases, shots)

    # 「出场镜头」既是结构化资料的一个字段（给模型/人看），也是证据列表（给追溯用）
    shot_labels = [f"#{ref['shot_index']}" for ref in refs]
    if shot_labels:
        profile["shot_refs"] = "、".join(shot_labels)
    if not profile.get("related_plot"):
        profile["related_plot"] = _clip("；".join(ref["script_excerpt"] for ref in refs[:3]))

    # 模型自己给的原文依据：只保留能在本章原文里逐字找到的（防止拼接出不存在的话）
    evidence: list[dict[str, Any]] = []
    for source in entry.get("sources") or []:
        for snippet in source.get("evidence") or []:
            text = str(snippet or "").strip()
            if not text:
                continue
            grounded = normalize_name(text)[:20] in chapter_haystack if len(normalize_name(text)) >= 6 else True
            evidence.append(
                {
                    "snippet": _clip(text),
                    "grounded": grounded,
                    "from_name": source.get("name") or "",
                }
            )

    item = _assemble_user_flow_item(
        asset_type=asset_type,
        name=name,
        aliases=aliases,
        profile=profile,
        shot_refs=refs,
        evidence=evidence,
        shot_count=max(len(refs), int(entry.get("shot_count") or 0)),
        source_kind=str(entry.get("source_kind") or "candidate"),
        existing_asset_id=entry.get("existing_asset_id"),
        linked_entity_id=entry.get("linked_entity_id"),
        linked_to_project=bool(entry.get("linked_to_project")),
        linked_to_shot=bool(entry.get("linked_to_shot")),
        candidate_recommendation=entry.get("recommendation"),
    )
    item["merge_sources"] = list(entry.get("sources") or [])
    return item


# ---------------------------------------------------------------------------
# 冲突判定
# ---------------------------------------------------------------------------


#: 冲突码 → 中文原因（页面直接展示）
CONFLICT_TYPE_MISMATCH = "same_name_other_type"
CONFLICT_ALIAS_SPLIT = "alias_points_to_two_assets"
CONFLICT_DUPLICATE_NAME = "duplicate_name_across_types"
#: 下面三个是**真正需要人工**的冲突（会挡住自动确认）
CONFLICT_LIBRARY_PROFILE = "library_profile_mismatch"

CONFLICT_LABELS: dict[str, str] = {
    CONFLICT_TYPE_MISMATCH: "库里已有同名资产，但类型与本次判断不同",
    CONFLICT_ALIAS_SPLIT: "这一组的两个别名分别指向库里两个不同资产",
    CONFLICT_DUPLICATE_NAME: "同一章里有两个不同类型的资产用同一个名字",
}

#: 库里有一件**名字里包含**它的资产（同类或异类）—— 这只是**提示**，不是冲突。
#:
#: 为什么必须单独一档：上游存在性检测 ``check_names_existence`` 用的是**子串匹配**
#: （``name ILIKE '%查询名%'``，服务「新建资产」时的"是不是已经有了"提醒）。
#: 于是「姜岁欢」会命中服装「姜岁欢常服」—— 那不是同一个东西，只是名字里带了这几个字。
#: 把这种命中当冲突会**永久卡住**自动确认（验收时真实发生过：两个角色因此建不出来，
#: 后面按资产的图片提示词直接 400）。所以：**只有归一化名称完全相等才算"同名"**，
#: 子串命中一律降级为提示，如实点名库里的那件资产，让人看一眼即可。
NOTICE_PARTIAL_NAME_MATCH = "partial_name_match_in_library"

#: 库里同名同类型资产已有描述、但与本章资料**没有一个共同用词** —— 这只是**提示**，
#: 不是冲突：同名同类型本身已经足够安全（会走"选用已有"，且不覆盖任何已有内容），
#: 措辞不同不足以判定"不是同一个资产"。把它升级成冲突只会让"无冲突直接确认"变成空话。
NOTICE_LIBRARY_PROFILE = CONFLICT_LIBRARY_PROFILE

NOTICE_LABELS: dict[str, str] = {
    NOTICE_PARTIAL_NAME_MATCH: (
        "库里有一件**名字里包含**它的其它资产（名字里有这几个字，但不是同一样东西）："
        "本次**不当作冲突**、也不会去关联它，只是提醒你留意"
    ),
    NOTICE_LIBRARY_PROFILE: (
        "库里已有同名同类型资产，但它的描述与本章剧本里的资料没有共同用词；"
        "本次会选用已有且**不改动**它的描述，请顺手确认一下是不是同一个资产"
    ),
}


def _bigrams(text: str) -> set[str]:
    """取文本的 2-gram 字符集合（中英文都适用），用于"有没有共同点"的粗判。"""
    cleaned = "".join(ch for ch in str(text or "") if ch.isalnum())
    if len(cleaned) < 2:
        return {cleaned} if cleaned else set()
    return {cleaned[index : index + 2] for index in range(len(cleaned) - 1)}


def _has_any_overlap(left: str, right: str) -> bool:
    """两段文本是否有任何 2-gram 共同点。

    为什么用 2-gram 而不是"字段值整体包含"：同一资产的描述措辞差异极大
    （「素白襦裙」vs「白色长裙」），整串包含会把**正常的**同名资产误判成冲突；
    2-gram 至少能捕捉「素白/襦裙/白裙」这类实际共现，把误报压到
    "两段话一个字都不一样"这种确实需要人看一眼的情况。
    """
    left_set = _bigrams(left)
    right_set = _bigrams(right)
    if not left_set or not right_set:
        return True  # 有一边没内容 → 谈不上冲突
    return bool(left_set & right_set)


def detect_conflicts(
    *,
    items: list[dict[str, Any]],
    existing_by_type: dict[tuple[str, str], dict[str, Any]],
    existing_description_by_id: dict[str, str],
) -> None:
    """给每个 item 打上 ``conflict``（None = 无冲突，可直接确认）。"""
    # 同章内同名不同类型 → 冲突
    name_to_types: dict[str, set[str]] = {}
    for item in items:
        name_to_types.setdefault(normalize_name(item["name"]), set()).add(item["asset_type"])

    for item in items:
        asset_type = item["asset_type"]
        name_key = normalize_name(item["name"])
        conflicts: list[dict[str, str]] = []
        notices: list[dict[str, str]] = []

        if len(name_to_types.get(name_key) or set()) > 1:
            other = sorted((name_to_types.get(name_key) or set()) - {asset_type})
            conflicts.append(
                {
                    "code": CONFLICT_DUPLICATE_NAME,
                    "reason": f"{CONFLICT_LABELS[CONFLICT_DUPLICATE_NAME]}（另一组是 {'/'.join(type_label(x) for x in other)}）",
                }
            )

        # 同名不同类型已在库里（**只认完全同名**：子串命中不算同名，见 NOTICE_PARTIAL_NAME_MATCH）
        for other_type in ASSET_TYPES:
            if other_type == asset_type:
                continue
            hit = existing_by_type.get((other_type, name_key))
            if not (hit and hit.get("exists")):
                continue
            if hit.get("fuzzy"):
                notices.append(
                    {
                        "code": NOTICE_PARTIAL_NAME_MATCH,
                        "message": NOTICE_LABELS[NOTICE_PARTIAL_NAME_MATCH],
                        "existing_asset_id": str(hit.get("asset_id") or ""),
                        "existing_asset_type": other_type,
                        "existing_asset_name": str(hit.get("matched_name") or ""),
                    }
                )
                continue
            conflicts.append(
                {
                    "code": CONFLICT_TYPE_MISMATCH,
                    "reason": (
                        f"{CONFLICT_LABELS[CONFLICT_TYPE_MISMATCH]}："
                        f"库里「{item['name']}」已有 {type_label(other_type)}"
                    ),
                    "existing_asset_id": str(hit.get("asset_id") or ""),
                    "existing_asset_type": other_type,
                }
            )

        # 别名分别指向库里两个不同资产（同样只认完全同名）
        alias_ids: dict[str, str] = {}
        for alias in [item["name"], *(item.get("aliases") or [])]:
            hit = existing_by_type.get((asset_type, normalize_name(alias)))
            if hit and hit.get("exists") and hit.get("asset_id") and not hit.get("fuzzy"):
                alias_ids[str(hit["asset_id"])] = str(alias)
        if len(alias_ids) > 1:
            conflicts.append(
                {
                    "code": CONFLICT_ALIAS_SPLIT,
                    "reason": (
                        f"{CONFLICT_LABELS[CONFLICT_ALIAS_SPLIT]}："
                        + "、".join(f"「{alias}」→ {aid}" for aid, alias in alias_ids.items())
                    ),
                    "existing_asset_ids": sorted(alias_ids),
                }
            )

        # 库里同名同类型资产已有描述，且与本章剧本里的资料**没有一个字的共同点**
        hit = existing_by_type.get((asset_type, name_key))
        if hit and hit.get("exists") and hit.get("fuzzy"):
            # 同类里只有"名字包含它"的资产（例如角色「姜岁欢」vs 角色「姜岁欢替身」）：
            # 不关联、不阻塞，只提示。
            notices.append(
                {
                    "code": NOTICE_PARTIAL_NAME_MATCH,
                    "message": NOTICE_LABELS[NOTICE_PARTIAL_NAME_MATCH],
                    "existing_asset_id": str(hit.get("asset_id") or ""),
                    "existing_asset_type": asset_type,
                    "existing_asset_name": str(hit.get("matched_name") or ""),
                }
            )
        if hit and hit.get("exists") and hit.get("asset_id") and not hit.get("fuzzy"):
            existing_id = str(hit["asset_id"])
            existing_desc = str(existing_description_by_id.get(existing_id) or "").strip()
            item["existing_asset_id"] = existing_id
            if existing_desc:
                summary = str(item.get("summary") or "")
                if summary and not _has_any_overlap(summary, existing_desc):
                    notices.append(
                        {
                            "code": NOTICE_LIBRARY_PROFILE,
                            "message": NOTICE_LABELS[NOTICE_LIBRARY_PROFILE],
                            "existing_asset_id": existing_id,
                            "existing_excerpt": _clip(existing_desc, 80),
                        }
                    )

        item["conflict"] = conflicts[0] if conflicts else None
        item["conflicts"] = conflicts
        item["notices"] = notices
        item["needs_review"] = bool(conflicts)
        item["suggested_action"] = (
            "needs_review"
            if conflicts
            else ("link_existing" if item.get("existing_asset_id") else "create_new")
        )
        item["auto_confirmable"] = not conflicts
        item["action_reason"] = (
            conflicts[0]["reason"]
            if conflicts
            else (
                "库里已有同名同类型资产，且没有冲突 → 可直接选用已有（不会新建重复资产）。"
                if item.get("existing_asset_id")
                else "库里没有同名资产，且本章判断无冲突 → 可直接新建。"
            )
        )


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

#: 库里没有这份清单时的引导（GET 只读，**不花钱**）
NOT_GENERATED_HINT = (
    "本章还没有生成过结构化资产清单。生成需要调用一次文本模型（真实模式下会花钱），"
    "所以只在显式请求时执行：POST /api/v1/studio/chapters/{chapter_id}/asset-profiles。"
)


def _make_target_caller(target: TextLLMTarget | None) -> TextLLMCaller:
    """把"解析出来的模型目标"包成一个 :data:`TextLLMCaller`（真实调用路径）。

    单独抽成模块级函数，而不是在主编排里内嵌 ``async def`` —— 让"真实调用"
    与"注入桩"在调用点上完全同构，测试才能一行不改地替换掉它。
    """

    async def _call(text: str) -> str:  # pragma: no cover - 真实网络路径（测试一律注入桩）
        completion = await call_text_llm(text, target=target)  # type: ignore[arg-type]
        return completion.text

    return _call


async def _load_shots(db: AsyncSession, *, chapter_id: str) -> list[dict[str, Any]]:
    rows = (
        (await db.execute(select(Shot).where(Shot.chapter_id == chapter_id).order_by(Shot.index))).scalars().all()
    )
    return [
        {
            "shot_id": str(row.id),
            "index": int(row.index or 0),
            "title": str(row.title or ""),
            "script_excerpt": str(row.script_excerpt or ""),
        }
        for row in rows
    ]


async def _load_existing_descriptions(
    db: AsyncSession,
    *,
    existing_by_type: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, str]:
    """取库中同名资产的 ``description``（冲突判定要用，只读）。"""
    from app.models.studio import Character, Costume, Prop, Scene

    models = {"character": Character, "scene": Scene, "prop": Prop, "costume": Costume}
    ids_by_type: dict[str, set[str]] = {asset_type: set() for asset_type in ASSET_TYPES}
    for (asset_type, _key), hit in existing_by_type.items():
        if hit.get("exists") and hit.get("asset_id"):
            ids_by_type.setdefault(asset_type, set()).add(str(hit["asset_id"]))
    result: dict[str, str] = {}
    for asset_type, ids in ids_by_type.items():
        if not ids:
            continue
        rows = (await db.execute(select(models[asset_type]).where(models[asset_type].id.in_(sorted(ids))))).scalars().all()
        for row in rows:
            result[str(row.id)] = str(getattr(row, "description", "") or "")
    return result


def _dry_run_items(groups: list[dict[str, Any]], *, shots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """DRY_RUN 占位条目：只做**确定性**的骨架，不编造外观细节。

    与既有编排层同口径：占位内容带 ``[DRY_RUN 占位]``，写库路径会被
    ``product_guardrails`` 拒绝，所以不可能被误存成"已就绪"。
    """
    items: list[dict[str, Any]] = []
    for group in groups[:MAX_ITEMS]:
        asset_type = str(group["candidate_type"])
        name = str(group["name"])
        fields = {
            key: f"{PLACEHOLDER_PREFIX} {key}待模型依据本章剧本生成"
            for key in normalize_profile(asset_type, {}).keys()
        }
        refs = shot_refs_for_name(name, list(group.get("aliases") or []), shots)
        items.append(
            {
                "name": name,
                "aliases": list(group.get("aliases") or []),
                "asset_type": asset_type,
                "fields": fields,
                "_dry_run": True,
                "_refs": refs,
            }
        )
    return items


async def _match_existing(
    db: AsyncSession,
    *,
    project_id: str,
    items: list[dict[str, Any]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """用既有存在性接口做"是否已有同名资产"的匹配（复用，不另写一套）。

    **每个名称都要在四类里各查一次**（不是只查自己那一类）：只有这样才可能发现
    "库里已有同名资产，但类型与本次判断不同"这种冲突 —— 只查同类是永远看不见它的。
    """
    buckets: dict[str, list[str]] = {f"{asset_type}_names": [] for asset_type in ASSET_TYPES}
    for item in items:
        names = [str(item["name"]), *(str(alias) for alias in (item.get("aliases") or []))]
        for asset_type in ASSET_TYPES:
            buckets[f"{asset_type}_names"].extend(names)
    try:
        checked = await check_names_existence(
            db,
            project_id=project_id,
            shot_id=None,
            character_names=buckets["character_names"],
            prop_names=buckets["prop_names"],
            scene_names=buckets["scene_names"],
            costume_names=buckets["costume_names"],
        )
    except HTTPException:
        return {}
    # 上游存在性检测是**子串匹配**（``name ILIKE '%查询名%'``），命中的不一定是同一个东西：
    # 例如查询「姜岁欢」会命中服装「姜岁欢常服」。所以这里按命中的 asset_id 把**库里真实的名字**
    # 取回来，逐条标上 ``matched_name`` 与 ``fuzzy``（fuzzy = 名字里含它、但不是完全同名）。
    # 后面的冲突判定只认"完全同名"，fuzzy 一律降级为提示（否则会永久卡住自动确认）。
    ids_by_type: dict[str, set[str]] = {asset_type: set() for asset_type in ASSET_TYPES}
    for asset_type in ASSET_TYPES:
        for hit in checked.get(f"{asset_type}s") or []:
            if isinstance(hit, dict) and hit.get("exists") and hit.get("asset_id"):
                ids_by_type[asset_type].add(str(hit["asset_id"]))
    actual_names = await _load_asset_names(db, ids_by_type=ids_by_type)

    result: dict[tuple[str, str], dict[str, Any]] = {}
    for asset_type in ASSET_TYPES:
        for hit in checked.get(f"{asset_type}s") or []:
            if not isinstance(hit, dict):
                continue
            key = normalize_name(hit.get("name"))
            asset_id = str(hit.get("asset_id") or "")
            matched_name = actual_names.get(asset_id, "") if asset_id else ""
            exists = bool(hit.get("exists"))
            result[(asset_type, key)] = {
                **hit,
                "matched_name": matched_name,
                "fuzzy": bool(exists and asset_id and normalize_name(matched_name) != key),
            }
    return result


async def _load_asset_names(
    db: AsyncSession,
    *,
    ids_by_type: dict[str, set[str]],
) -> dict[str, str]:
    """按 id 取回库里资产的**真实名称**（用于区分"完全同名"与"名字里含它"）。"""
    from app.models.studio import Character, Costume, Prop, Scene

    models: dict[str, Any] = {"character": Character, "scene": Scene, "prop": Prop, "costume": Costume}
    names: dict[str, str] = {}
    for asset_type, ids in ids_by_type.items():
        if not ids or asset_type not in models:
            continue
        model = models[asset_type]
        rows = (await db.execute(select(model.id, model.name).where(model.id.in_(sorted(ids))))).all()
        for row in rows:
            names[str(row[0])] = str(row[1] or "")
    return names


async def _finalize_items(
    db: AsyncSession,
    *,
    project_id: str,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """匹配库里同名资产 + 冲突判定 + 稳定排序（**生成路径与读库路径共用**）。"""
    existing_by_type = await _match_existing(db, project_id=project_id, items=items)
    existing_descriptions = await _load_existing_descriptions(db, existing_by_type=existing_by_type)
    detect_conflicts(
        items=items,
        existing_by_type=existing_by_type,
        existing_description_by_id=existing_descriptions,
    )
    for item in items:
        item["shot_refs"] = sorted(
            item.get("shot_refs") or [],
            key=lambda ref: (int(ref.get("shot_index") or 0), str(ref.get("shot_id") or "")),
        )
    items.sort(key=lambda item: (CANDIDATE_TYPES.index(item["asset_type"]), -int(item["shot_count"]), item["name"]))
    return items


# ---------------------------------------------------------------------------
# 从数据库读回（后端重启后走的就是这条路，一次模型调用都不会发生）
# ---------------------------------------------------------------------------


def build_item_from_record(record: Any) -> dict[str, Any]:
    """把持久化行还原成"用户主流程"里的一行（与生成路径逐字段同形）。"""
    from app.services.studio.chapter_asset_record_store import (
        STATUS_TEXT,
        effective_profile,
        has_pending_change,
        profile_source_label,
        record_to_read,
    )

    asset_type = normalize_asset_type(record.asset_type) or str(record.asset_type or "")
    profile = effective_profile(record)
    shot_refs = [ref for ref in (record.shot_refs or []) if isinstance(ref, dict)]
    evidence = [entry for entry in (record.evidence or []) if isinstance(entry, dict)]
    item = _assemble_user_flow_item(
        asset_type=asset_type,
        name=str(record.name or ""),
        aliases=[str(alias) for alias in (record.aliases or [])],
        profile=profile,
        shot_refs=shot_refs,
        evidence=evidence,
        shot_count=len(shot_refs),
        source_kind="chapter_record",
        existing_asset_id=record.asset_id,
        linked_entity_id=record.asset_id,
        linked_to_project=bool(record.asset_id),
        linked_to_shot=bool(shot_refs),
        candidate_recommendation=(str(record.link_action or "") or None),
    )
    item.update(
        {
            "record_id": int(record.id),
            "record_status": str(record.status or ""),
            "record_status_label": STATUS_TEXT.get(str(record.status or ""), str(record.status or "")),
            "record_profile_source": profile_source_label(record),
            "manual_edited": bool(record.manual_overrides or record.user_notes),
            "user_notes": [str(note) for note in (record.user_notes or [])],
            "manual_overrides": dict(record.manual_overrides or {}),
            "has_pending_change": has_pending_change(record),
            "pending_change": (record_to_read(record).get("pending") if has_pending_change(record) else None),
            "source_hash": str(record.source_hash or ""),
            "source_summary": dict(record.source_summary or {}),
            "merge_sources": list(record.merge_sources or []),
        }
    )
    return item


def _records_source_summary(
    *,
    chapter_title: str,
    script_chars: int,
    shots: list[dict[str, Any]],
    source_hash: str,
    matched_shot_indexes: list[int] | None = None,
) -> dict[str, Any]:
    """剧本/分镜**来源摘要**（与 ``source_hash`` 一起落库，便于"这份资料是哪一版剧本来的"）。"""
    summary: dict[str, Any] = {
        "chapter_title": str(chapter_title or ""),
        "script_chars": int(script_chars or 0),
        "shot_total": len(shots),
        "shot_indexes": [int(shot.get("index") or 0) for shot in shots],
        "source_hash": str(source_hash or ""),
    }
    if matched_shot_indexes is not None:
        summary["matched_shot_indexes"] = sorted({int(index) for index in matched_shot_indexes})
    return summary


def _technical_from_run(technical: dict[str, Any], *, items: list[dict[str, Any]], cache_key: str, warnings: list[str]) -> dict[str, Any]:
    """技术详情（默认收起）：生成时落库的原始材料 + 本次现算的匹配状态。"""
    return {
        "candidate_groups": technical.get("candidate_groups") or [],
        "merged_groups": technical.get("merged_groups") or [],
        "alias_merge": technical.get("alias_merge") or [],
        "match_status": [
            {
                "group_key": item["group_key"],
                "asset_type": item["asset_type"],
                "name": item["name"],
                "existing_asset_id": item.get("existing_asset_id"),
                "linked_entity_id": item.get("linked_entity_id"),
                "linked_to_project": item.get("linked_to_project"),
                "linked_to_shot": item.get("linked_to_shot"),
                "candidate_recommendation": item.get("candidate_recommendation"),
                "suggested_action": item.get("suggested_action"),
                "record_status": item.get("record_status"),
            }
            for item in items
        ],
        "dropped_model_items": technical.get("dropped_model_items") or [],
        "candidates_raw": technical.get("candidates_raw") or {},
        "llm": technical.get("llm") or {},
        "reconcile": technical.get("reconcile") or {},
        "records": technical.get("records") or [],
        "cache_key": cache_key,
        "warnings": list(warnings or []),
        "persistence": technical.get("persistence") or {},
    }


def _assemble_payload(
    *,
    chapter_id: str,
    project_id: str,
    chapter_title: str,
    script_chars: int,
    shot_total: int,
    items: list[dict[str, Any]],
    technical_detail: dict[str, Any],
    meta: dict[str, Any],
    persistence: dict[str, Any],
) -> dict[str, Any]:
    """把清单打包成对外响应（生成路径与读库路径**共用**，保证两者逐字段同形）。"""
    auto_confirmable = [item for item in items if item["auto_confirmable"]]
    needs_review = [item for item in items if not item["auto_confirmable"]]
    return {
        "chapter_id": chapter_id,
        "project_id": project_id,
        "chapter_title": chapter_title,
        "script_chars": script_chars,
        "shot_total": shot_total,
        # ---------------- 用户主流程 ----------------
        "user_flow": {
            "items": items,
            "summary": {
                "asset_total": len(items),
                "by_type": {
                    asset_type: len([item for item in items if item["asset_type"] == asset_type])
                    for asset_type in CANDIDATE_TYPES
                },
                "evidence_backed": len([item for item in items if item["shot_refs"]]),
                "auto_confirmable": len(auto_confirmable),
                "needs_review": len(needs_review),
                "ready_for_image_prompt": len([item for item in items if not item["missing_visual_fields"]]),
                "pending_change": len([item for item in items if item.get("has_pending_change")]),
                "manual_edited": len([item for item in items if item.get("manual_edited")]),
                "linked": len([item for item in items if item.get("linked_entity_id")]),
            },
            "auto_confirmable_group_keys": [item["group_key"] for item in auto_confirmable],
            "needs_review": [
                {
                    "group_key": item["group_key"],
                    "name": item["name"],
                    "asset_type": item["asset_type"],
                    "conflict_code": (item["conflict"] or {}).get("code", ""),
                    "reason": item["action_reason"],
                    "conflict": item["conflict"],
                }
                for item in needs_review
            ],
            "field_labels": {
                asset_type: [
                    {"key": spec.key, "label": spec.label, "visual": spec.visual}
                    for spec in field_specs(asset_type)
                ]
                for asset_type in CANDIDATE_TYPES
            },
            "notes": [
                "本清单已按**项目 + 章节**持久化保存（新增 / 更新 / 待决定三种结果见 "
                "persistence.reconcile）：后端重启后直接读同一份数据库，**不会重复调用模型**。",
                "无冲突项（auto_confirmable）可直接确认；只有 needs_review 里的冲突项需要人工处理。",
                "确认动作**不写全局资产（场景/道具/服装）的通用资料、不写 image_prompts、不碰图片与定版图**；"
                "要更新全局通用资料，请走 global-updates 的差异预览 + 显式确认。",
            ],
        },
        # ---------------- 技术详情（默认收起） ----------------
        "technical_detail": technical_detail,
        # meta 存成普通 dict（不是 pydantic 模型）：对外的 JSON 形状完全一样。
        "meta": meta,
        "persistence": persistence,
        "note": (
            "数据库是这份清单的事实来源（专用表 chapter_asset_profiles / "
            "chapter_asset_profile_runs）；进程内缓存只用于同一进程内省一次序列化。"
            "接口只预览与持久化：不建资产、不出图；LLM 调用受 DRY_RUN 守卫保护。"
        ),
    }


async def _payload_from_database(
    db: AsyncSession,
    *,
    chapter: Chapter,
    source: Any,
    shots: list[dict[str, Any]],
    run: Any | None,
    cache_key: str,
    content_changed: bool,
    warnings: list[str],
    extra_instructions: str,
) -> dict[str, Any]:
    """**只读库**地组装清单（一次模型调用都不会发生）。"""
    from app.services.studio.chapter_asset_record_store import (
        RUN_STATUS_TEXT,
        group_key,
        has_pending_change,
        list_chapter_records,
        record_to_read,
    )

    records = await list_chapter_records(db, chapter_id=chapter.id)
    items = await _finalize_items(
        db,
        project_id=source.project_id,
        items=[build_item_from_record(record) for record in records],
    )
    pending_items = [item for item in items if item.get("has_pending_change")]
    technical = dict(getattr(run, "technical", None) or {})
    technical["records"] = [record_to_read(record) for record in records]
    technical["persistence"] = {
        "run_id": (int(run.id) if run is not None else None),
        "status": (str(run.status) if run is not None else "records_only"),
        "content_changed": bool(content_changed),
        "extra_instructions": str(extra_instructions or ""),
    }
    meta = dict(getattr(run, "meta", None) or {})
    meta.setdefault("llm_called", False)
    meta.setdefault("dry_run", dry_run.dry_run_enabled())
    meta.setdefault("target", None)
    meta["from_cache"] = False
    meta["from_db"] = True
    persistence = {
        "source": "database",
        "generated": bool(records) or run is not None,
        "tables": ["chapter_asset_profiles", "chapter_asset_profile_runs"],
        "run_id": (int(run.id) if run is not None else None),
        "status": (str(run.status) if run is not None else "records_only"),
        "status_label": (
            RUN_STATUS_TEXT.get(str(run.status), str(run.status))
            if run is not None
            else "库里已有资料，但找不到生成记录（可能是从旧结构迁移过来的）"
        ),
        "content_changed": bool(content_changed),
        "content_changed_hint": (
            "内容已变化，建议重新分析：本章原文或分镜与生成这份清单时不一致（"
            f"{str(getattr(run, 'stale_reason', '') or '')}）。"
            "现有资料与人工修改都已保留，未做任何覆盖；要不要重新分析由你决定。"
            if content_changed
            else ""
        ),
        "source_hash": str(getattr(run, "source_hash", "") or ""),
        "cache_key": cache_key,
        "generated_at": (
            run.generated_at.isoformat() if run is not None and run.generated_at is not None else None
        ),
        # 两个"是否调用过模型"必须分开说，否则读库路径会被误读成"又花钱了"：
        # - llm_called：**本次响应**是否调用了模型（读库路径恒为 False）；
        # - generated_by_llm：库里这份清单**当初**是不是真实模型调用产生的。
        "llm_called": False,
        "generated_by_llm": bool(getattr(run, "llm_called", False)),
        "dry_run": bool(getattr(run, "dry_run", False)),
        "records_total": len(records),
        "protected_records": len(
            [
                record
                for record in records
                if record.confirmed_at is not None
                or record.manual_edited_at is not None
                or dict(record.manual_overrides or {})
                or list(record.user_notes or [])
            ]
        ),
        "pending_changes": [
            {
                "group_key": group_key(record),
                "name": str(record.name or ""),
                "asset_type": str(record.asset_type or ""),
                "asset_id": record.asset_id,
                "reason": "该行已确认或有人工修改；新结果不会自动覆盖它。",
            }
            for record in records
            if has_pending_change(record)
        ],
        "unresolved_change_total": len(pending_items),
        "reconcile": technical.get("reconcile") or {},
        "note": (
            "数据库是事实来源：这一份是从 chapter_asset_profiles 直接读回来的，"
            "没有调用任何模型；进程内缓存只是性能优化，清掉它结论不变。"
        ),
    }
    return _assemble_payload(
        chapter_id=str(chapter.id),
        project_id=str(source.project_id),
        chapter_title=str(source.title or ""),
        script_chars=len(source.text),
        shot_total=len(shots),
        items=items,
        technical_detail=_technical_from_run(technical, items=items, cache_key=cache_key, warnings=warnings),
        meta=meta,
        persistence=persistence,
    )


def _not_generated_payload(
    *,
    chapter_id: str,
    project_id: str,
    chapter_title: str,
    script_chars: int,
    shot_total: int,
    cache_key: str,
    extra_instructions: str,
) -> dict[str, Any]:
    """库里从来没有这份清单时的只读响应（**不调模型、不花钱**）。"""
    return _assemble_payload(
        chapter_id=chapter_id,
        project_id=project_id,
        chapter_title=chapter_title,
        script_chars=script_chars,
        shot_total=shot_total,
        items=[],
        technical_detail={
            "candidate_groups": [],
            "merged_groups": [],
            "alias_merge": [],
            "match_status": [],
            "dropped_model_items": [],
            "candidates_raw": {},
            "llm": {},
            "reconcile": {},
            "records": [],
            "cache_key": cache_key,
            "warnings": [],
            "persistence": {},
        },
        meta={
            "dry_run": dry_run.dry_run_enabled(),
            "llm_called": False,
            "target": None,
            "latency_ms": None,
            "raw_output_chars": 0,
            "json_repairs": [],
            "json_parse_error": None,
            "dry_run_reason": None,
            "from_cache": False,
            "from_db": True,
        },
        persistence={
            "source": "database",
            "generated": False,
            "tables": ["chapter_asset_profiles", "chapter_asset_profile_runs"],
            "run_id": None,
            "status": "not_generated",
            "status_label": "还没有生成过本章的结构化资产清单",
            "content_changed": False,
            "content_changed_hint": "",
            "source_hash": "",
            "cache_key": cache_key,
            "extra_instructions": str(extra_instructions or ""),
            "generated_at": None,
            "llm_called": False,
            "dry_run": dry_run.dry_run_enabled(),
            "records_total": 0,
            "protected_records": 0,
            "pending_changes": [],
            "unresolved_change_total": 0,
            "reconcile": {},
            "hint": NOT_GENERATED_HINT.format(chapter_id=chapter_id),
        },
    )


async def build_chapter_asset_profiles(
    db: AsyncSession,
    *,
    chapter_id: str,
    llm_caller: TextLLMCaller | None = None,
    extra_instructions: str = "",
    refresh: bool = False,
    allow_generate: bool = True,
    use_cache: bool = True,
) -> dict[str, Any]:
    """本章资产的规范化清单（**数据库优先**：有就直读，没有才生成）。

    三种调用语义（这是"付费结果不会丢"的落地方式）：

    - ``refresh=False`` 且库里已有（生成记录或资料行）→ **只读数据库**，
      返回值与"刚生成时"逐字段同形（``user_flow`` / ``technical_detail`` 一致），
      不调用任何模型；
      剧本/分镜变了 → ``persistence.content_changed=true`` +
      中文提示「内容已变化，建议重新分析」，**不覆盖任何资料**；
    - ``refresh=True`` → 重新分析（可能真实调用模型），结果与库里逐条对账：
      未确认且未人工改过的行更新；**已确认或人工改过的行只记 ``pending_*``**
      并标 ``pending_change``，等用户决定覆盖 / 合并 / 保留；没再提到的行不删除；
    - ``allow_generate=False``（GET 只读入口）且库里没有 → 返回空清单 +
      ``persistence.status="not_generated"`` 的中文引导，**一次模型调用都不发**。

    ``use_cache`` 只影响"同一进程内要不要省一次 JSON 深拷贝"，不影响结论。
    """
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))

    source = await load_chapter_source(db, chapter_id)
    shots = await _load_shots(db, chapter_id=chapter_id)
    chapter_haystack = normalize_name(source.text)

    cache_key = build_chapter_profile_cache_key(
        project_id=source.project_id,
        chapter_id=chapter_id,
        chapter_text=source.text,
        shots=shots,
        extra_instructions=extra_instructions,
    )
    source_hash = build_chapter_source_hash(chapter_text=source.text, shots=shots)

    # 同进程内的性能优化：内容签名一致且不要求刷新时，直接返回上次组装的响应。
    # **它不是事实来源**：库里的行才是（下面每一次"读"都从库里重新组装）。
    if use_cache and llm_caller is None and not refresh:
        cached = get_cached_chapter_profile(cache_key)
        if cached is not None:
            meta = cached.get("meta")
            if isinstance(meta, dict):
                meta["from_cache"] = True
            return cached

    from app.services.studio.chapter_asset_record_store import (
        get_latest_run,
        list_chapter_records,
    )

    latest_run = await get_latest_run(db, chapter_id=chapter_id)
    has_records = bool(await list_chapter_records(db, chapter_id=chapter_id))

    # ---------------- ① 数据库优先：有就直读，一次模型调用都不发 ----------------
    if not refresh and (latest_run is not None or has_records):
        content_changed = latest_run is not None and str(latest_run.cache_key or "") != cache_key
        warnings = list(getattr(latest_run, "warnings", None) or [])
        if content_changed and latest_run is not None:
            from app.services.studio.chapter_asset_record_store import mark_run_stale

            await mark_run_stale(
                db,
                run=latest_run,
                reason="本章原文或分镜与生成这份清单时不一致（内容已变化，建议重新分析）。",
            )
            warnings = [*warnings, "本章原文或分镜已变化：现有资料与人工修改均已保留，未做任何覆盖。"]
        payload = await _payload_from_database(
            db,
            chapter=chapter,
            source=source,
            shots=shots,
            run=latest_run,
            cache_key=cache_key,
            content_changed=content_changed,
            warnings=warnings,
            extra_instructions=extra_instructions,
        )
        if use_cache and llm_caller is None:
            set_cached_chapter_profile(cache_key, payload)
        return payload

    # ---------------- ② 库里没有：只读入口明确拒绝花钱 ----------------
    if not allow_generate:
        return _not_generated_payload(
            chapter_id=chapter_id,
            project_id=str(source.project_id),
            chapter_title=str(source.title or ""),
            script_chars=len(source.text),
            shot_total=len(shots),
            cache_key=cache_key,
            extra_instructions=extra_instructions,
        )

    # ---------------- ③ 生成（真实调用或演练占位），结果立刻落库 ----------------
    candidates = await build_chapter_asset_candidates(db, chapter_id=chapter_id)
    groups = [
        {**item, "source_kind": "candidate"}
        for item in candidates.get("items") or []
        if item.get("candidate_type") in CANDIDATE_TYPES
    ]

    warnings: list[str] = []
    target: TextLLMTarget | None = None
    dry_run_reason: str | None = None

    if llm_caller is None:
        try:
            target = await resolve_text_llm_target(db)
        except HTTPException as exc:
            target = None
            if not dry_run.dry_run_enabled():
                raise
            warnings.append(f"未能解析默认文本模型配置：{exc.detail}")

    prompt = build_chapter_asset_profile_prompt(
        chapter_title=source.title,
        chapter_text=source.text,
        shot_list_text=build_shot_list_text(shots),
        candidate_list_text=build_candidate_list_text(groups),
        extra_instructions=extra_instructions,
    )

    if llm_caller is not None or (target is not None and not dry_run.dry_run_enabled()):
        caller = llm_caller or _make_target_caller(target)
        try:
            raw_text = await caller(prompt)
            parsed, repairs = parse_json_object_with_repairs(raw_text)
            model_items = extract_raw_asset_items(parsed)
        except LLMRequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "llm_request_failed", "message": f"结构化资产提取调用失败：{exc}"},
            ) from exc
        except JSONParseError as exc:
            raise HTTPException(
                status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
                detail={
                    "code": "llm_json_parse_failed",
                    "message": f"结构化资产提取返回的不是合法 JSON：{exc}",
                    "fix": "请重试；若反复失败，可在附加要求里强调「只输出 JSON 对象」。",
                },
            ) from exc
        if repairs:
            warnings.append(f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")
        llm_called = True
        raw_output_chars = len(raw_text)
    else:
        model_items = _dry_run_items(groups, shots=shots)
        llm_called = False
        raw_output_chars = 0
        warnings.append(dry_run_warning(skill="结构化资产清单生成"))
        dry_run_reason = dry_run.short_status()

    by_key, dropped = merge_model_items_into_groups(
        model_items=model_items,
        groups=groups,
        chapter_haystack=chapter_haystack,
    )

    merged_groups = list(by_key.values())
    items = [_build_user_flow_item(entry=entry, shots=shots, chapter_haystack=chapter_haystack) for entry in merged_groups]
    for item in items:
        item["source_summary"] = _records_source_summary(
            chapter_title=source.title or "",
            script_chars=len(source.text),
            shots=shots,
            source_hash=source_hash,
            matched_shot_indexes=[int(ref.get("shot_index") or 0) for ref in item.get("shot_refs") or []],
        )
        item["shot_refs"] = sorted(
            item.get("shot_refs") or [],
            key=lambda ref: (int(ref.get("shot_index") or 0), str(ref.get("shot_id") or "")),
        )

    meta = {
        **build_run_meta(
            target=target,
            llm_called=llm_called,
            raw_output_chars=raw_output_chars,
            dry_run_reason=dry_run_reason,
        ).model_dump(),
        "from_cache": False,
        "from_db": False,
        "just_generated": True,
    }
    technical: dict[str, Any] = {
        "candidate_groups": groups,
        "merged_groups": [
            {
                "group_key": f"{entry['candidate_type']}:{normalize_name(entry['name'])}",
                "name": entry["name"],
                "asset_type": entry["candidate_type"],
                "aliases": sorted(set(entry.get("aliases") or [])),
                "merged_names": sorted(set(entry.get("model_names") or [])),
                "source_kind": entry.get("source_kind"),
                "shot_ids": entry.get("shot_ids") or [],
                "candidate_statuses": entry.get("statuses") or {},
            }
            for entry in merged_groups
        ],
        "alias_merge": [
            {
                "group_key": f"{entry['candidate_type']}:{normalize_name(entry['name'])}",
                "canonical_name": entry["name"],
                "merged_names": sorted(set(entry.get("model_names") or [])),
                "aliases": sorted(set(entry.get("aliases") or [])),
                "sources": entry.get("sources") or [],
            }
            for entry in merged_groups
        ],
        "dropped_model_items": dropped,
        "candidates_raw": {
            "summary": candidates.get("summary") or {},
            "shot_total": candidates.get("shot_total"),
            "shot_with_candidates": candidates.get("shot_with_candidates"),
        },
        "llm": {
            "prompt_chars": len(prompt),
            "prompt_excerpt": _clip(prompt, 1200),
            "candidate_list_text": build_candidate_list_text(groups),
            "shot_list_chars": len(build_shot_list_text(shots)),
        },
        "reconcile": {},
    }

    from app.services.studio.chapter_asset_record_store import create_run, save_analysis_result

    run = await create_run(
        db,
        project_id=str(source.project_id),
        chapter_id=chapter_id,
        cache_key=cache_key,
        source_hash=source_hash,
        source_summary=_records_source_summary(
            chapter_title=source.title or "",
            script_chars=len(source.text),
            shots=shots,
            source_hash=source_hash,
        ),
        item_total=len(items),
        llm_called=llm_called,
        dry_run=dry_run.dry_run_enabled(),
        extra_instructions=extra_instructions,
        meta=meta,
        technical=technical,
        warnings=warnings,
    )
    reconcile = await save_analysis_result(
        db,
        project_id=str(source.project_id),
        chapter_id=chapter_id,
        cache_key=cache_key,
        source_hash=source_hash,
        source_summary=run.source_summary,
        items=items,
        run=run,
        extra_instructions=extra_instructions,
    )
    run.technical = {**technical, "reconcile": reconcile}

    payload = await _payload_from_database(
        db,
        chapter=chapter,
        source=source,
        shots=shots,
        run=run,
        cache_key=cache_key,
        content_changed=False,
        warnings=warnings,
        extra_instructions=extra_instructions,
    )
    payload["meta"] = {**payload["meta"], "from_db": False, "just_generated": True}
    payload["persistence"] = {
        **payload["persistence"],
        "reconcile": reconcile,
        "llm_called": bool(llm_called),
        "generated_by_llm": bool(llm_called),
    }
    if use_cache and llm_caller is None:
        set_cached_chapter_profile(cache_key, payload)
    return payload


async def load_chapter_asset_records(db: AsyncSession, *, chapter_id: str) -> dict[str, Any]:
    """只读接口：本章持久化的资产资料（**数据库是事实来源**的唯一读入口）。"""
    from app.services.studio.chapter_asset_record_store import (
        get_latest_run,
        list_chapter_records,
        record_to_read,
    )

    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=entity_not_found("Chapter"))
    source = await load_chapter_source(db, chapter_id)
    shots = await _load_shots(db, chapter_id=chapter_id)
    current_hash = build_chapter_source_hash(chapter_text=source.text, shots=shots)
    run = await get_latest_run(db, chapter_id=chapter_id)
    records = await list_chapter_records(db, chapter_id=chapter_id)
    items = [record_to_read(record) for record in records]
    pending = [item for item in items if item.get("has_pending_change")]
    return {
        "chapter_id": chapter_id,
        "project_id": str(source.project_id),
        "items": items,
        "run": (
            {
                "id": int(run.id),
                "cache_key": str(run.cache_key or ""),
                "source_hash": str(run.source_hash or ""),
                "source_summary": dict(run.source_summary or {}),
                "status": str(run.status or ""),
                "stale_reason": str(run.stale_reason or ""),
                "generated_at": run.generated_at.isoformat() if run.generated_at is not None else None,
                "llm_called": bool(run.llm_called),
                "dry_run": bool(run.dry_run),
                "item_total": int(run.item_total or 0),
            }
            if run is not None
            else None
        ),
        "content_changed": bool(run is not None and str(run.source_hash or "") != current_hash),
        "current_source_hash": current_hash,
        "summary": {
            "records_total": len(items),
            "by_type": {
                asset_type: len([item for item in items if item["asset_type"] == asset_type])
                for asset_type in CANDIDATE_TYPES
            },
            "confirmed": len([item for item in items if item.get("status") == "confirmed"]),
            "manual_edited": len(
                [item for item in items if item.get("manual_overrides") or item.get("user_notes")]
            ),
            "pending_change": len(pending),
            "missing_in_latest": len([item for item in items if item.get("status") == "missing_in_latest"]),
            "linked": len([item for item in items if item.get("asset_id")]),
        },
        "note": (
            "这份资料按**项目 + 章节**隔离保存在 chapter_asset_profiles 表里："
            "后端重启后直接读，不需要重新调用模型；"
            "人工修改与用户补充不会被模型结果覆盖，"
            "也不会写回全局资产（场景/道具/服装）的通用资料、图片提示词或定版图。"
        ),
    }


__all__ = [
    "CANDIDATE_TYPES",
    "MAX_EVIDENCE_CHARS",
    "MAX_EVIDENCE_SHOTS",
    "MAX_ITEMS",
    "NOT_GENERATED_HINT",
    "build_chapter_asset_profile_prompt",
    "build_chapter_asset_profiles",
    "build_candidate_list_text",
    "build_item_from_record",
    "build_shot_list_text",
    "detect_conflicts",
    "extract_raw_asset_items",
    "load_chapter_asset_records",
    "merge_model_items_into_groups",
    "shot_refs_for_name",
]
