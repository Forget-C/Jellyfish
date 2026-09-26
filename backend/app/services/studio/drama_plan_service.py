"""「广告剧情流程」的服务编排层：草稿读取 / brief 保存 / 生成 / 确认落库。

为什么要有这一层（而不是把逻辑写在路由里）
==========================================

AGENTS.md 的分层约定：``api`` 层只负责收参、鉴权、响应组织；**业务逻辑、状态流转、数据编排**
放 ``service``。这条链路的编排恰好是最需要集中的一处，因为它把四件事串成一条事务边界明确的流程：

    brief 保存（免费）→ 抢租约（防重复付费）→ 编排层一次调用 → 落草稿（只落草稿）
    → 人工编辑 → confirm（一个事务落正式产物）

另外它替路由挡住两类"结构化明细"的翻译：

- 草稿忙 / 草稿缺失 / 章节非空等 **409** 明细（进 ``meta.error``）；
- 编排层的 **422**（``llm_json_parse_failed``）与 **502**（模型请求失败）。

诚实边界：``generate`` 在演练模式下**返回占位说明 + 不写 plan**（``llm_called=False``），
而不是抛异常——这样演练能走通全链路，而不像"关掉闸门"那样直接把功能挡住。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Project, Shot
from app.schemas.studio.drama_plan import (
    DramaBrief,
    DramaPlanConfirmRead,
    DramaPlanDraft,
    DramaPlanRead,
)
from app.services.studio import drama_plan_drafts as drafts
from app.services.studio import drama_plan_materialize as materialize
from app.services.studio.llm_orchestration import drama_plan as orchestration

#: 自动建章节时的标题上限（chapter.title 是 String(255)）
MAX_TITLE_CHARS = 120

NOTE_READ = (
    "只读：返回 brief 与草稿，**永不调用模型**。草稿确认之前不会影响章节/分镜/资产的任何正式数据。"
)
NOTE_BRIEF = "brief 已保存（免费，未调用任何模型）。状态与 plan 不受影响：已生成的草稿不会被这次保存弄丢。"
NOTE_CONFIRM = "已把草稿落成正式产物：章节标题/主线、角色、场景、商品、分镜（含时长/景别/动作/台词）与关联行。"


def _iso(value: Any) -> str:
    """把 ORM 的 datetime 转成 ISO 串（页面只展示，不下发内部对象）。"""
    if value is None:
        return ""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


async def _load_chapter_or_404(db: AsyncSession, chapter_id: str) -> Chapter:
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"章节不存在：{chapter_id}"
        )
    return chapter


def _read_payload(chapter: Chapter, row: Any, *, note: str) -> dict[str, Any]:
    """草稿行 → 页面读模型（无行 = 从没保存过 brief）。"""
    if row is None:
        return DramaPlanRead(
            chapter_id=chapter.id,
            project_id=chapter.project_id,
            has_draft=False,
            status="none",
            brief=DramaBrief(),
            plan=None,
            note=note,
        ).model_dump()
    plan_payload = row.plan if isinstance(row.plan, dict) and row.plan else None
    plan: DramaPlanDraft | None = None
    if plan_payload:
        try:
            plan = DramaPlanDraft.model_validate(plan_payload)
        except Exception:  # noqa: BLE001 - 库里草稿结构坏了要如实显示为空，而不是 500
            plan = None
    return DramaPlanRead(
        chapter_id=chapter.id,
        project_id=chapter.project_id,
        has_draft=True,
        status=drafts.short_status(row),
        brief=DramaBrief.model_validate(row.brief or {}),
        plan=plan,
        error=str(row.error or ""),
        model=str(row.model or ""),
        meta=dict(row.meta or {}),
        claim_expires_at=_iso(row.claim_expires_at),
        updated_at=_iso(row.updated_at),
        note=note,
    ).model_dump()


async def load_plan(db: AsyncSession, *, chapter_id: str) -> dict[str, Any]:
    """读取草稿（只读，永不付费）。"""
    chapter = await _load_chapter_or_404(db, chapter_id)
    row = await drafts.get_draft(db, chapter_id)
    return _read_payload(chapter, row, note=NOTE_READ)


async def save_brief(
    db: AsyncSession,
    *,
    chapter_id: str,
    brief: dict[str, Any],
) -> dict[str, Any]:
    """保存 brief（免费，**绝不触发模型调用**）。"""
    chapter = await _load_chapter_or_404(db, chapter_id)
    row = await drafts.save_brief(
        db, chapter_id=chapter_id, project_id=chapter.project_id, brief=brief
    )
    return _read_payload(chapter, row, note=NOTE_BRIEF)


async def generate(db: AsyncSession, *, chapter_id: str) -> dict[str, Any]:
    """生成剧情方案草稿（**真实付费出口**；租约防重复，演练不写 plan）。"""
    chapter = await _load_chapter_or_404(db, chapter_id)
    row, token = await drafts.claim_for_generate(db, chapter_id=chapter_id)
    brief = dict(row.brief or {})

    try:
        result = await orchestration.preview_drama_plan(db, chapter_id=chapter_id, brief=brief)
    except HTTPException as exc:
        # 解析失败(422) / 模型请求失败(502)：把失败如实写回草稿行（**不动已有 plan**），
        # 让页面能显示"上次失败原因"，而不是让状态永远停在 running。
        await drafts.mark_failed(
            db,
            chapter_id=chapter_id,
            token=token,
            error=str(exc.detail if isinstance(exc.detail, str) else exc.detail),
            meta={"status_code": exc.status_code},
        )
        raise
    except Exception as exc:  # noqa: BLE001 - 任何异常都要释放租约，否则会卡住 5 分钟
        await drafts.mark_failed(db, chapter_id=chapter_id, token=token, error=f"{type(exc).__name__}: {exc}")
        raise

    plan = result.get("plan")
    meta = result.get("meta")
    meta_dict = meta.model_dump() if hasattr(meta, "model_dump") else dict(meta or {})
    model_name = ""
    target = meta_dict.get("target") if isinstance(meta_dict, dict) else None
    if isinstance(target, dict):
        model_name = str(target.get("model_name") or "")
    warnings = list(result.get("warnings") or [])

    if plan:
        # 成功：只把归一化后的草稿写进草稿列（**正式行仍然一行都不写**）
        if isinstance(plan, dict):
            plan.setdefault("warnings", warnings)
        row = await drafts.mark_ok(
            db,
            chapter_id=chapter_id,
            token=token,
            plan=dict(plan),
            model=model_name,
            meta={**meta_dict, "warnings": warnings},
        )
        if row is None:  # 租约在生成期间被别人抢走（过期）→ 不覆盖别人的结果
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "drama_plan_lease_lost",
                    "message": "生成本次结果时租约已失效（可能已过期或被重新抢占），结果未写入。",
                    "fix": "重新点一次生成（如果上一次的结果其实已经写进去了，页面会显示它）。",
                },
            )
    else:
        # 演练：不写 plan，但把"未调用模型"如实写进 meta，且**不把状态标成 ok**
        current = await drafts.get_draft(db, chapter_id)
        if current is not None and str(current.claim_token or "") == token:
            current.claim_token = None
            current.claim_expires_at = None
            current.meta = {**meta_dict, "warnings": warnings}
            current.status = drafts.STATUS_NONE if not current.plan else current.status
            await db.flush()
            await db.refresh(current)
            row = current

    refreshed = await drafts.get_draft(db, chapter_id)
    note = str(result.get("note") or NOTE_READ)
    if warnings and not plan:
        note = f"{note} " + "；".join(warnings)
    return _read_payload(chapter, refreshed or row, note=note)


async def save_plan(
    db: AsyncSession,
    *,
    chapter_id: str,
    plan: dict[str, Any],
) -> dict[str, Any]:
    """保存**人工编辑后**的草稿（免费，**只写草稿列**，绝不落正式行）。

    为什么需要它（需求里的一个缺口）：需求说「人工编辑直接改 plan JSON 草稿列」，
    但四件套里没有"保存编辑"的端点 —— 不补的话编辑只能活在浏览器内存里，
    刷新就丢，与"草稿刷新不丢"的验收矛盾。
    """
    chapter = await _load_chapter_or_404(db, chapter_id)
    row = await drafts.get_draft(db, chapter_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "drama_plan_brief_required",
                "message": "这一集还没有保存过商品信息（brief），没有草稿可改。",
                "fix": "先保存 brief（免费），再点生成或手工填一份草稿。",
            },
        )
    if drafts.lease_active(row):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "drama_plan_generating",
                "message": "这一集正在生成中，先等它结束再保存手改的草稿（否则会被生成结果覆盖）。",
                "fix": "等生成结束后重新保存。",
            },
        )
    # 两步走：先按 DTO 校验**结构**（类型/必填/多余字段），再跑确定性归一化。
    # 分两步的理由：结构坏掉时若直接进归一化，用户会收到"模型返回里没有可用镜头"这种
    # 与他的手改无关的报错；这里要给他"草稿结构不合法"的准确原因。
    try:
        DramaPlanDraft.model_validate(plan or {})
    except Exception as exc:  # noqa: BLE001 - 结构不合法要如实报，不能把坏草稿写进库
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "drama_plan_invalid_draft",
                "message": f"草稿结构不合法，未保存：{exc}",
                "fix": "检查镜头字段的类型（shots 必须是数组、每镜要有 index 与 title 等）。",
            },
        ) from exc

    # 手改草稿走**和模型产物同一套**确定性归一化：景别/机位/运镜别名、时长档位、
    # 镜头序号连续、悬空角色引用剔除。理由：这些字段在 DTO 里是普通字符串，
    # 不归一的话 `shot_details.camera_shot` 会把「不存在的景别」这种脏值原样落库。
    # 归一化产生的 warning 随草稿返回，页面可以显示，不会静默改掉用户输入。
    plan_dto, warnings = orchestration.postprocess_plan(
        plan or {}, shot_count=max(1, len((plan or {}).get("shots") or []))
    )
    plan_dto.warnings = list(dict.fromkeys([*(plan_dto.warnings or []), *warnings]))
    row.plan = plan_dto.model_dump()
    # 状态不在这里改：状态表达的是「模型生成过没有」，手改草稿不改变这个事实
    await db.flush()
    await db.refresh(row)
    return _read_payload(
        chapter,
        row,
        note="草稿已保存（免费）。正式产物要等你点「确认落成正式内容」。",
    )


async def confirm(db: AsyncSession, *, chapter_id: str) -> dict[str, Any]:
    """确认落库（materialize，一个事务；失败整体回滚）。"""
    chapter = await _load_chapter_or_404(db, chapter_id)
    row = await drafts.get_draft(db, chapter_id)
    if row is None or not row.plan:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "drama_plan_draft_missing",
                "message": "这一集还没有生成过剧情方案草稿，没有可确认的内容。",
                "fix": "先保存 brief 并点「生成剧情方案」。",
            },
        )
    counts = await materialize.materialize_drama_plan(db, chapter_id=chapter_id, plan=dict(row.plan))
    payload = DramaPlanConfirmRead(**counts).model_dump()
    payload["note"] = NOTE_CONFIRM
    return payload


async def resolve_working_chapter(
    db: AsyncSession,
    *,
    project_id: str,
    product_name: str = "",
) -> dict[str, Any]:
    """给"项目内进入剧情策划"找一个可用章节：优先**还没有分镜的空章节**，没有就建一个。

    为什么需要它：剧情策划的四个动作都是**章节级**的（``/chapters/{id}/drama-plan``），
    而入口在项目里。自动建章节的标题取商品名，这样用户在项目列表里能一眼看出
    "这一集是做这个商品的"。
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"项目不存在：{project_id}")

    rows = (
        await db.execute(
            select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.index)
        )
    ).scalars().all()
    for chapter in rows:
        # 只认"没有分镜"的章节：有分镜的章节 confirm 会被拒（避免新旧分镜混在一起），
        # 所以这里先挑干净的那一个，别让用户填完 brief 才发现落不了库。
        shots = await db.scalar(
            select(func.count()).select_from(Shot).where(Shot.chapter_id == chapter.id)
        )
        if not shots:
            return {
                "chapter_id": chapter.id,
                "project_id": project_id,
                "created": False,
                "title": chapter.title,
            }

    next_index = max((int(item.index or 0) for item in rows), default=0) + 1
    title = (product_name or "").strip()[:MAX_TITLE_CHARS] or f"第 {next_index} 集 · 剧情广告"
    chapter = Chapter(
        id=f"chap-{uuid.uuid4().hex[:16]}",
        project_id=project_id,
        index=next_index,
        title=title,
    )
    db.add(chapter)
    await db.flush()
    return {"chapter_id": chapter.id, "project_id": project_id, "created": True, "title": chapter.title}


__all__ = [
    "confirm",
    "generate",
    "load_plan",
    "resolve_working_chapter",
    "save_brief",
]
