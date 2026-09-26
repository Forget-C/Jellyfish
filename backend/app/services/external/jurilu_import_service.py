"""巨日禄分镜导入 —— 取数 + 落库服务。

分工
----
* 抓取与解析：复用搬运过来的 ``jurilu_agent_import``（零第三方依赖，纯 stdlib）。
* 配对判断：``jurilu_import_plan``（纯函数，可沙箱自检）。
* 本文件只负责"把计划落到 Jellyfish 库上"，以及把结果整理成前端能用的形状。

安全约定（沿用中控台口径）
--------------------------
* Cookie / Authorization **不落库、不落日志、不回显**；
* 抓取日志的脱敏由 ``jurilu_agent_import`` 内部完成（``ph_phc_xxx`` → ``<COOKIE_VAL>``）；
* 本模块不打印任何请求头。
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    CameraAngle,
    CameraMovement,
    CameraShotType,
    Chapter,
    Shot,
    ShotDetail,
    VFXType,
)
from app.services.common import entity_not_found, require_entity
from app.services.external import jurilu_agent_import as jurilu
from app.services.external import jurilu_import_plan as planner


class JuriluImportError(RuntimeError):
    """巨日禄抓取/解析失败（携带给前端看的诊断信息）。"""

    def __init__(self, message: str, diagnostics: Optional[Dict[str, Any]] = None,
                 warnings: Optional[List[str]] = None) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics or {}
        self.warnings = warnings or []


class JuriluSelectionError(JuriluImportError):
    """所选 ``script_ids`` 不合法 —— **400，不是上游网关故障**。

    抓取本身是成功的，只是用户选了本次抓取里不存在的脚本组。
    这类错误必须能和 502（Cookie 失效 / 页面结构变化）分开，
    否则用户会以为「接口又挂了」，而其实只是选错了组。
    """

    status_code = 400

    def __init__(
        self,
        message: str,
        *,
        available_script_ids: Optional[List[str]] = None,
        script_groups: Optional[List[Dict[str, Any]]] = None,
        diagnostics: Optional[Dict[str, Any]] = None,
        warnings: Optional[List[str]] = None,
    ) -> None:
        super().__init__(message, diagnostics=diagnostics, warnings=warnings)
        self.available_script_ids = available_script_ids or []
        self.script_groups = script_groups or []


#: 预览里**永远**带回的一句话口径（用户原话：默认不跨 scriptId 合并）。
NO_MERGE_NOTE = "默认不跨 scriptId 合并：请先选择一个脚本组"

#: 用户口径（2026-09-21）：**一次只能导入一个脚本组**（单数语义）。
SINGLE_GROUP_NOTE = "一次只能导入一个脚本组"


def _clean_script_ids(script_ids: Optional[List[str]]) -> List[str]:
    """规范化用户选的 scriptIds：去空白、去重、保持用户给的顺序。"""
    cleaned: List[str] = []
    for item in script_ids or []:
        text = str(item or "").strip()
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def check_single_selection(selected: List[str]) -> None:
    """强制「恰好一个」语义：0 个 = 还没选，1 个 = 允许匹配，>1 个 = 拒绝。

    为什么在服务层也拦一道（路由层还拦一次）：`build_preview` 是可以被
    脚本/任务直接调用的，跨组合并这条底线不能只靠 HTTP 层守
    （「109 条 = 同一集连续镜头」这个错误前提一旦写进库就收不回来）。
    """
    if len(selected) <= 1:
        return
    raise JuriluSelectionError(
        f"{SINGLE_GROUP_NOTE}：script_ids 只能传 1 个 scriptId，本次收到 {len(selected)} 个"
        f"（{'、'.join(selected)}）。请先选定一个脚本组再重试（{NO_MERGE_NOTE}）。",
        available_script_ids=list(selected),
        diagnostics={},
        warnings=[],
    )


def _group_label(group: Dict[str, Any]) -> str:
    title = str(group.get("title") or "").strip() or "未命名"
    return f"{group.get('script_id')}（{title}，{group.get('record_count', 0)} 条）"


def fetch_entries(
    *,
    url: str,
    cookie: str,
    authorization: str = "",
    auth_mode: str = "auto",
    referer: str = "",
    api_url_override: str = "",
    script_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """抓取巨日禄分镜并规范化。**纯网络 + 纯计算，不碰数据库。**

    多 scriptId 口径（用户原话）：一次抓取的多个 scriptId 是**不同的脚本**
    （或同一脚本的不同版本），默认**不跨 scriptId 合并**。

    * ``script_ids`` 为空 → 不做任何匹配（``entries=[]``），只把脚本组报出去；
    * ``script_ids`` 非空 → **只**规范化这些组的分镜；
    * ``script_ids`` 里出现本次抓取没有的 id → ``JuriluSelectionError``（400）。

    Returns:
        ``{"entries": [...], "diagnostics": {...}, "warnings": [...],
           "scripts": [...], "project_id": str, "clip_id": str,
           "script_groups": [...], "selected_script_ids": [...],
           "requires_script_selection": bool}``
    """
    source_url = jurilu.resolve_agent_list_url(url)
    if not source_url:
        raise JuriluImportError("缺少巨日禄页面 URL（需带 projectId / clipId 参数）")

    resolved_cookie = jurilu.resolve_cookie(cookie)
    resolved_auth, auth_note = jurilu.resolve_authorization(authorization, auth_mode)
    selected = _clean_script_ids(script_ids)
    # 单数语义：>1 个直接拒绝（400），连上游都不碰
    check_single_selection(selected)

    result = jurilu.fetch_all_storyboards(
        source_url=source_url,
        cookie_text=resolved_cookie,
        authorization=resolved_auth,
        # 巨日禄按 Referer 判来源：留空时用页面 URL 兜底（原中控台同口径 app.py:18478）
        referer=(referer or source_url),
        api_url_override=api_url_override,
    )
    diagnostics = dict(result.get("diagnostics") or {})
    diagnostics["auth_header_mode"] = auth_note
    diagnostics["has_cookie"] = bool(resolved_cookie)
    diagnostics["has_auth"] = bool(resolved_auth)
    diagnostics["has_referer"] = bool(referer)
    # 401 排查用的**请求头形状**（只有头名与布尔值，绝不含头值）：
    # 「是否带 Cookie / Cookie 里是否有 Authorization 项 / 是否错发了 HTTP Authorization 头」
    facts = dict(diagnostics.get("script_request_facts") or {})
    diagnostics["request_header_names"] = list(facts.get("request_header_names") or [])
    diagnostics["sent_cookie_header"] = bool(facts.get("sent_cookie_header"))
    diagnostics["sent_authorization_header"] = bool(facts.get("sent_authorization_header"))
    diagnostics["cookie_has_authorization_item"] = bool(
        facts.get("cookie_has_authorization_item")
    )

    # 分组只用「第一步记录 + 已解析出来的分镜」，是纯计算：抓取失败时也算出来，
    # 这样 502 的诊断里能带上「本次到底看到了哪几个 scriptId」。
    script_groups = jurilu.build_script_groups(
        list(result.get("scripts") or []),
        list(result.get("storyboards") or []),
        pages_by_script=dict(result.get("storyboard_pages") or {}),
    )
    available = [str(group.get("script_id")) for group in script_groups]
    diagnostics["all_script_ids"] = available
    diagnostics["selected_script_ids"] = selected
    diagnostics["script_groups"] = [
        {
            "script_id": group.get("script_id"),
            "title": group.get("title"),
            "record_count": group.get("record_count"),
            "seq_min": group.get("seq_min"),
            "seq_max": group.get("seq_max"),
            "pages_fetched": group.get("pages_fetched"),
            "likely_newest": group.get("likely_newest"),
        }
        for group in script_groups
    ]

    if not result.get("ok"):
        raise JuriluImportError(
            "分镜导入失败（未解析到分镜，或接口拒绝）",
            diagnostics=diagnostics,
            warnings=list(result.get("warnings") or []),
        )

    unknown = [sid for sid in selected if sid not in available]
    if unknown:
        raise JuriluSelectionError(
            f"script_ids 里的这些组本次没有抓到：{'、'.join(unknown)}。"
            f"本次抓到的脚本组：{'；'.join(_group_label(g) for g in script_groups) or '（无）'}。"
            f"请从这些组里选（{NO_MERGE_NOTE}）。",
            available_script_ids=available,
            script_groups=[
                {
                    "script_id": group.get("script_id"),
                    "title": group.get("title"),
                    "record_count": group.get("record_count"),
                }
                for group in script_groups
            ],
            diagnostics=diagnostics,
            warnings=list(result.get("warnings") or []),
        )

    storyboards = list(result.get("storyboards") or [])
    if selected:
        chosen = set(selected)
        storyboards = [
            row for row in storyboards
            if str(row.get("source_script_id") or "") in chosen
        ]
    else:
        # **默认不合并**：没选组就一条都不进匹配。
        storyboards = []

    # 整组进匹配：**不做任何数量截断**（有几条分镜就有几条条目）
    entries = jurilu.normalize_external_agent_prompts(storyboards)
    pid, cid = jurilu.extract_project_clip_from_url(source_url)
    return {
        "entries": entries,
        "diagnostics": diagnostics,
        "warnings": list(result.get("warnings") or []),
        "scripts": list(result.get("scripts") or []),
        "project_id": pid,
        "clip_id": cid,
        "script_groups": script_groups,
        "selected_script_ids": selected,
        "requires_script_selection": not selected,
    }


async def load_chapter_shots(db: AsyncSession, chapter_id: str) -> List[Dict[str, Any]]:
    """读章节内已有镜头（含当前 video_prompt），供配对使用。"""
    rows = await db.execute(
        select(Shot.id, Shot.index, Shot.title, ShotDetail.video_prompt)
        .join(ShotDetail, ShotDetail.id == Shot.id, isouter=True)
        .where(Shot.chapter_id == chapter_id)
        .order_by(Shot.index)
    )
    return [
        {
            "id": row.id,
            "index": int(row.index or 0),
            "title": row.title or "",
            "video_prompt": row.video_prompt or "",
        }
        for row in rows.all()
    ]


async def build_preview(
    db: AsyncSession,
    *,
    chapter_id: str,
    url: str,
    cookie: str,
    authorization: str = "",
    auth_mode: str = "auto",
    referer: str = "",
    api_url_override: str = "",
    create_missing: bool = True,
    overwrite: bool = False,
    script_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """抓取 + 配对，产出一份"将要发生什么"的预览。**不写库。**

    ``script_ids`` 为空（用户还没选组）时：
    ``requires_script_selection=True``、``rows=[]``、``entry_count=0``、
    空计划、``plan_summary=""``，但 ``script_groups`` 仍然返回 ——
    默认不跨 scriptId 合并。
    """
    await require_entity(
        db, Chapter, chapter_id, detail=entity_not_found("Chapter"), status_code=404
    )

    fetched = fetch_entries(
        url=url,
        cookie=cookie,
        authorization=authorization,
        auth_mode=auth_mode,
        # 巨日禄按 Referer 判来源：留空时由 fetch_entries 统一用页面 URL 兜底
        # （这里**不能**引用 source_url —— 那是 fetch_entries 里的局部变量，
        #   在 build_preview 作用域里并不存在，写了就是 NameError）
        referer=referer,
        api_url_override=api_url_override,
        script_ids=script_ids,
    )
    shots = await load_chapter_shots(db, chapter_id)
    entries = list(fetched.get("entries") or [])
    script_groups = list(fetched.get("script_groups") or [])
    selected = list(fetched.get("selected_script_ids") or [])
    requires_selection = bool(fetched.get("requires_script_selection", not selected))

    if requires_selection:
        # 没选组 → 一行计划都不产出（**默认不跨 scriptId 合并**）。
        # ``entry_count`` 也强制为 0：没选组就什么都不参与匹配，
        # 绝不允许「前端没选组、行却被算进计划」这种半吊子状态。
        plan = planner.empty_plan()
        summary = ""
        note = NO_MERGE_NOTE
        entry_count = 0
    else:
        # 复用既有的「创建缺失镜头并重新匹配」能力：同一个 create_missing 开关，
        # 同一份 counts / next_index 口径（不另起一套割裂流程）。
        plan = planner.build_import_plan(
            entries, shots, create_missing=create_missing, overwrite=overwrite
        )
        summary = planner.plan_summary(plan)
        picked = "、".join(
            _group_label(group)
            for group in script_groups
            if str(group.get("script_id")) in set(selected)
        )
        note = (
            f"已选 1 个脚本组：{picked}（{SINGLE_GROUP_NOTE}）；"
            f"该组全部 {len(entries)} 条分镜都参与匹配（不截断），"
            f"未选中的脚本组不参与（{NO_MERGE_NOTE}）。"
        )
        entry_count = len(entries)

    counts = plan.get("counts") or {}
    # 镜头数不足的缺多少：要新建的 + 因为不允许新建而跳过的
    missing_shot_count = (
        int(counts.get(planner.ACTION_CREATE, 0))
        + int(counts.get(planner.ACTION_SKIP_NO_SHOT, 0))
    )

    return {
        "chapter_id": chapter_id,
        "chapter_shot_count": len(shots),
        "entry_count": entry_count,
        "plan": plan,
        "plan_summary": summary,
        "missing_shot_count": missing_shot_count,
        "diagnostics": fetched["diagnostics"],
        "warnings": fetched["warnings"],
        "jurilu_project_id": fetched["project_id"],
        "jurilu_clip_id": fetched["clip_id"],
        "source_url": jurilu.resolve_agent_list_url(url),
        "script_groups": script_groups,
        "selected_script_ids": selected,
        "selected_script_id": selected[0] if len(selected) == 1 else "",
        "requires_script_selection": requires_selection,
        "note": note,
    }


async def apply_plan(
    db: AsyncSession,
    *,
    chapter_id: str,
    plan: Dict[str, Any],
) -> Dict[str, Any]:
    """执行计划。**写库。**

    只处理 ``update`` / ``overwrite`` / ``create`` 三种动作；
    其余动作仅计数，不落库。
    """
    await require_entity(
        db, Chapter, chapter_id, detail=entity_not_found("Chapter"), status_code=404
    )

    updated = 0
    created = 0
    touched_shot_ids: List[str] = []

    for row in planner.writable_rows(plan.get("rows") or []):
        action = row["action"]
        text = str(row.get("prompt") or "").strip()
        source = str(row.get("source") or planner.JURILU_SOURCE)
        if not text:
            continue

        if action in (planner.ACTION_UPDATE, planner.ACTION_OVERWRITE):
            shot_id = str(row.get("shot_id") or "")
            if not shot_id:
                continue
            await db.execute(
                update(ShotDetail)
                .where(ShotDetail.id == shot_id)
                .values(video_prompt=text, video_prompt_source=source)
            )
            updated += 1
            touched_shot_ids.append(shot_id)
            continue

        if action == planner.ACTION_CREATE:
            shot_id = str(uuid.uuid4())
            title = str(row.get("title") or "").strip() or f"镜头 {row.get('index') or 1}"
            db.add(
                Shot(
                    id=shot_id,
                    chapter_id=chapter_id,
                    index=int(row.get("index") or 1),
                    title=title[:255],
                    script_excerpt=str(row.get("summary") or "")[:2000],
                )
            )
            db.add(
                ShotDetail(
                    id=shot_id,
                    camera_shot=CameraShotType.ms,
                    angle=CameraAngle.eye_level,
                    movement=CameraMovement.static,
                    follow_atmosphere=True,
                    vfx_type=VFXType.none,
                    duration=5,
                    video_prompt=text,
                    video_prompt_source=source,
                )
            )
            created += 1
            touched_shot_ids.append(shot_id)

    await db.flush()

    return {
        "chapter_id": chapter_id,
        "updated": updated,
        "created": created,
        "written": updated + created,
        "touched_shot_ids": touched_shot_ids,
        "counts": plan.get("counts") or {},
    }


__all__ = [
    "JuriluImportError",
    "JuriluSelectionError",
    "NO_MERGE_NOTE",
    "SINGLE_GROUP_NOTE",
    "check_single_selection",
    "fetch_entries",
    "load_chapter_shots",
    "build_preview",
    "apply_plan",
]
