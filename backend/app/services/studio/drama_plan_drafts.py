"""剧情方案草稿的服务端存储（``drama_plan_drafts``，一章一行）。

为什么草稿必须落库（与 ``prompt_board_drafts`` 同一个坑）
=========================================================

流程是：填 brief（免费）→ 点「生成剧情方案」（**真实付费的一次模型调用**）→ 人工编辑 →
显式确认 → 落正式产物。草稿只活在浏览器内存里的话，刷新 / 切走 / 中断就全丢，
用户已经付过费的结果无法恢复（``shot_video_prompt_drafts`` 正是为同一个坑落的表）。

三条边界（读代码时请守住）
==========================

1. **本表只放草稿**：确认之前**不落任何正式行**（章节 / 分镜 / 资产）。写正式产物只有一条路：
   ``POST /studio/chapters/{id}/drama-plan/confirm``（``drama_plan_materialize``）。
2. **brief 保存免费**：``save_brief()`` 只写 ``brief`` 列，**绝不触发模型调用**，
   也绝不改 ``status``。行由 brief 保存创建，这是对"未开始不落行"先例的**唯一有意偏离**
   （用户填一半就要能存下来），"有没有生成过"由 ``status`` 表达：
   ``""``（行有了但从未生成）/ ``running``（生成中，带租约）/ ``ok`` / ``failed``。
3. **租约防重复付费**：``claim_for_generate()`` 是"同一章在租约内只能生成一次"的轻量闸门，
   到期自动可抢（避免进程被杀 / 页面关掉后永久卡住）。
   ``mark_ok`` / ``mark_failed`` 必须带**持有者令牌**，防止过期租约的旧写入覆盖新结果。
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import DramaPlanDraft

#: 草稿状态（与 ``models.types.DramaPlanDraftStatus`` 同值；空串 = 未生成）
STATUS_NONE = ""
STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_FAILED = "failed"

#: 租约时长：一次生成（含模型超时 60s）留足余量；到期自动可抢
LEASE_SECONDS = 300


def short_status(row: DramaPlanDraft | None) -> str:
    """给页面看的短状态：``none`` / ``running`` / ``ok`` / ``failed``。"""
    if row is None:
        return "none"
    return str(row.status or STATUS_NONE) or "none"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime | None) -> datetime | None:
    """SQLite 取回的 DATETIME 可能是 naive，比较前统一成带时区。"""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def lease_active(row: DramaPlanDraft, *, now: datetime | None = None) -> bool:
    """当前是否有人正持有生成租约（未过期）。"""
    expires = _as_aware(row.claim_expires_at)
    if expires is None:
        return False
    return expires > (now or _now())


async def get_draft(db: AsyncSession, chapter_id: str) -> DramaPlanDraft | None:
    """读草稿行（没有就返回 ``None``，不是错误）。"""
    return await db.get(DramaPlanDraft, chapter_id)


async def get_draft_for_project(db: AsyncSession, project_id: str) -> list[DramaPlanDraft]:
    """按项目列出各集的草稿（供页面按项目查"哪几集已经有方案"）。"""
    rows = (
        await db.execute(
            select(DramaPlanDraft)
            .where(DramaPlanDraft.project_id == project_id)
            .order_by(DramaPlanDraft.chapter_id)
        )
    ).scalars().all()
    return list(rows)


async def save_brief(
    db: AsyncSession,
    *,
    chapter_id: str,
    project_id: str,
    brief: dict[str, Any],
) -> DramaPlanDraft:
    """保存 brief（**免费、永不触模型**）。

    - 行不存在 → 建一行（``status`` 留空 = 未生成）；
    - 行已存在 → 只覆盖 ``brief``，**不动** ``plan`` / ``status`` / ``error``
      （用户改完商品信息不该把已经付过费生成的草稿弄丢）。
    """
    row = await get_draft(db, chapter_id)
    if row is None:
        row = DramaPlanDraft(
            chapter_id=chapter_id,
            project_id=project_id,
            brief=dict(brief or {}),
            plan={},
            status=STATUS_NONE,
        )
        db.add(row)
    else:
        row.brief = dict(brief or {})
        row.project_id = project_id
    await db.flush()
    await db.refresh(row)
    return row


def _busy_detail(row: DramaPlanDraft) -> dict[str, Any]:
    expires = _as_aware(row.claim_expires_at)
    return {
        "code": "drama_plan_generating",
        "message": "这一集的剧情方案正在生成中，请等它结束（或租约到期）后再点。",
        "fix": "租约到期后会自动可重新生成；重复点击不会重复付费，这是刻意的保护。",
        "claim_expires_at": expires.isoformat() if expires else "",
    }


async def claim_for_generate(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> tuple[DramaPlanDraft, str]:
    """抢占生成租约（**调用模型之前**必须过这一关）。

    返回 ``(草稿行, 令牌)``；同一章已有未过期租约时抛 **409**（结构化明细见
    ``_busy_detail``）——这就是"连续点击不重复付费"的实现处。
    """
    row = await get_draft(db, chapter_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "drama_plan_brief_required",
                "message": "这一集还没有保存过商品信息（brief），无法生成。",
                "fix": "先保存 brief（免费，不会调用模型），再点生成。",
            },
        )
    if lease_active(row):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_busy_detail(row))

    token = secrets.token_hex(16)
    row.status = STATUS_RUNNING
    row.claim_token = token
    row.claim_expires_at = _now() + timedelta(seconds=LEASE_SECONDS)
    row.error = ""
    await db.flush()
    await db.refresh(row)
    return row, token


async def mark_ok(
    db: AsyncSession,
    *,
    chapter_id: str,
    token: str,
    plan: dict[str, Any],
    model: str,
    meta: dict[str, Any],
) -> DramaPlanDraft | None:
    """写成功结果（**只有生成成功才写 plan**）。令牌不匹配则**不写**（过期租约的迟到结果）。"""
    row = await get_draft(db, chapter_id)
    if row is None or str(row.claim_token or "") != token:
        return None
    row.plan = dict(plan or {})
    row.status = STATUS_OK
    row.error = ""
    row.model = str(model or "")[:128]
    row.meta = dict(meta or {})
    row.claim_token = None
    row.claim_expires_at = None
    await db.flush()
    await db.refresh(row)
    return row


async def mark_failed(
    db: AsyncSession,
    *,
    chapter_id: str,
    token: str,
    error: str,
    model: str = "",
    meta: dict[str, Any] | None = None,
) -> DramaPlanDraft | None:
    """写失败原因（**不动 plan**：上一次成功的草稿必须留着，不能被失败清掉）。"""
    row = await get_draft(db, chapter_id)
    if row is None or str(row.claim_token or "") != token:
        return None
    row.status = STATUS_FAILED
    row.error = str(error or "")[:2000]
    if model:
        row.model = str(model)[:128]
    if meta:
        row.meta = dict(meta)
    row.claim_token = None
    row.claim_expires_at = None
    await db.flush()
    await db.refresh(row)
    return row


async def release_claim(db: AsyncSession, *, chapter_id: str, token: str) -> bool:
    """主动释放租约（页面取消 / 服务端异常收尾）；令牌不匹配则不动。"""
    row = await get_draft(db, chapter_id)
    if row is None or str(row.claim_token or "") != token:
        return False
    row.claim_token = None
    row.claim_expires_at = None
    if str(row.status or "") == STATUS_RUNNING:
        row.status = STATUS_FAILED
        row.error = row.error or "生成被取消。"
    await db.flush()
    return True


__all__ = [
    "LEASE_SECONDS",
    "STATUS_FAILED",
    "STATUS_NONE",
    "STATUS_OK",
    "STATUS_RUNNING",
    "claim_for_generate",
    "get_draft",
    "get_draft_for_project",
    "lease_active",
    "mark_failed",
    "mark_ok",
    "release_claim",
    "save_brief",
    "short_status",
]
