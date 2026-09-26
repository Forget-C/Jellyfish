"""集级提示词看板的**服务端草稿存储**（`shot_video_prompt_drafts`，keyed by (chapter_id, shot_id)）。

修的是什么（2026-09-19「整集视频提示词草稿丢失」）：
看板按「一次一镜」**真实调用**大模型（真金白银），草稿此前只存在浏览器内存里，
刷新 / 切走 / 中断就全丢，用户已经付过费的结果无法恢复。草稿必须落服务端库。

本模块**只负责那一行的读写与「生成中」租约**，不掺看板语义（镜头编号、草稿令牌签发、
覆盖模式、来源映射都在 `prompt_board.py`）。依赖方向刻意单向：
``prompt_board → prompt_board_drafts``，两个模块都不会互相 import 成环。

三条边界（读代码时请守住）：
1. **本表只放草稿**，任何情况下都不写 ``shot_details.video_prompt``；写正式列只有
   ``/prompt-board/{chapter_id}/save`` 一条路。
2. 「未开始」**不落行**：没有行的镜头就是未开始，读层渲染成 ``pending``，
   这样"未开始"和"失败"在数据层不会混淆。
3. 租约（claim）是**防重复付费**的轻量闸门：同一镜在租约内只能有一次生成；
   租约到期自动可抢，避免进程被杀 / 页面关掉之后永久卡住。
"""

from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import ShotVideoPromptDraft
from app.models.types import ShotVideoPromptDraftStatus

#: 落库状态（与模型列同口径）
STATUS_RUNNING = ShotVideoPromptDraftStatus.running.value
STATUS_OK = ShotVideoPromptDraftStatus.ok.value
STATUS_FAILED = ShotVideoPromptDraftStatus.failed.value
DB_STATUSES: tuple[str, ...] = (STATUS_RUNNING, STATUS_OK, STATUS_FAILED)

#: **读层**状态：没有草稿行 = 未开始（不落库，只在响应里出现）
STATUS_PENDING = "pending"
READ_STATUSES: tuple[str, ...] = (STATUS_PENDING, STATUS_RUNNING, STATUS_OK, STATUS_FAILED)

DraftStatus = Literal["pending", "running", "ok", "failed"]
SaveStatus = Literal["ok", "failed"]

#: 「生成中」租约时长（秒）。默认 3 分钟：覆盖一次慢生成，又不至于中断后长时间卡住。
DEFAULT_LEASE_SECONDS = 180
MIN_LEASE_SECONDS = 30
MAX_LEASE_SECONDS = 1800


def now_utc() -> datetime:
    """当前 UTC 时间，**naive**。

    为什么是 naive：SQLite 的 DATETIME 不存时区，写进去再读出来也拿不到 tzinfo；
    统一用 naive UTC 才能在「库里读出来的值」和「当前时间」之间安全比较
    （混用 aware/naive 会直接 TypeError）。
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_naive_utc(value: datetime | None) -> datetime | None:
    """把可能带时区的时间统一成 naive UTC（跨方言读回来可能是 aware）。"""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def normalize_lease_seconds(value: int | float | None) -> int:
    """把请求里的租约时长夹到安全区间（太短=形同没有闸门，太长=中断后卡住）。"""
    try:
        seconds = int(value) if value is not None else DEFAULT_LEASE_SECONDS
    except (TypeError, ValueError):
        seconds = DEFAULT_LEASE_SECONDS
    return max(MIN_LEASE_SECONDS, min(MAX_LEASE_SECONDS, seconds))


@dataclass(slots=True)
class ClaimResult:
    """一次抢占的结果。``claimed=False`` 时 ``reason`` 说明谁/为什么挡住了。"""

    claimed: bool
    claim_token: str = ""
    lease_seconds: int = DEFAULT_LEASE_SECONDS
    expires_at: datetime | None = None
    reason: str = ""
    #: 挡住抢占的现有状态（未抢占时用于页面提示）
    blocking_status: str = ""

    def to_read(self) -> dict[str, Any]:
        return {
            "claimed": self.claimed,
            "claim_token": self.claim_token,
            "lease_seconds": self.lease_seconds,
            # 统一带 Z：库里存的是 naive UTC，不带 Z 会被 JS 当成本地时间（差 8 小时）
            "claim_expires_at": self.expires_at.isoformat() + "Z" if self.expires_at else None,
            "reason": self.reason,
            "blocking_status": self.blocking_status,
        }


async def load_map(db: AsyncSession, *, chapter_id: str) -> dict[str, ShotVideoPromptDraft]:
    """该集全部草稿行，按 ``shot_id`` 索引（一次查询，不做 N+1）。"""
    rows = (
        await db.execute(
            select(ShotVideoPromptDraft).where(ShotVideoPromptDraft.chapter_id == chapter_id)
        )
    ).scalars().all()
    return {str(row.shot_id): row for row in rows}


async def get_row(
    db: AsyncSession, *, chapter_id: str, shot_id: str
) -> ShotVideoPromptDraft | None:
    """取一镜的草稿行；**必须同时**匹配 chapter_id 与 shot_id（防跨集读写）。"""
    row = await db.get(ShotVideoPromptDraft, shot_id)
    if row is None or str(row.chapter_id) != str(chapter_id):
        return None
    return row


async def _load_any_chapter(db: AsyncSession, *, shot_id: str) -> ShotVideoPromptDraft | None:
    """按主键取行（**不**校验章节）。写路径专用：镜头换集时草稿要跟着走。"""
    return await db.get(ShotVideoPromptDraft, str(shot_id))


def _apply_fields(
    row: ShotVideoPromptDraft,
    *,
    chapter_id: str,
    status: str,
    prompt: str | None,
    source: str,
    error: str,
    model: str,
    meta: dict[str, Any] | None,
    server_generated: bool | None,
    release_claim: bool,
) -> None:
    """把一次写入的字段落到行上（upsert 与"并发后退化成更新"共用同一份逻辑）。"""
    # 镜头换了集：把归属改到当前集，键仍然成立（老集的读接口不会再看到它）
    row.chapter_id = str(chapter_id)
    if prompt is not None:
        if server_generated is None:
            # 按内容自证：正文与库里**完全一致**才沿用"服务端生成"标记
            row.server_generated = bool(row.server_generated) and str(row.prompt or "") == prompt
        row.prompt = prompt
    if server_generated is not None:
        row.server_generated = bool(server_generated)

    row.status = status
    if source:
        row.source = source
    row.error = error if status == STATUS_FAILED else ""
    if model:
        row.model = model
    if meta is not None:
        row.meta = meta
    if release_claim:
        # 写入结果即表示这次生成结束：租约释放，下一次可以正常抢占
        row.claim_token = None
        row.claim_expires_at = None


def lease_alive(row: ShotVideoPromptDraft, *, now: datetime | None = None) -> bool:
    """该行是否还持有**未过期**的生成租约。"""
    holder = str(row.claim_token or "").strip()
    if not holder:
        return False
    expires = as_naive_utc(row.claim_expires_at)
    if expires is None:
        # 有令牌却没有到期时间：按"已过期"处理（宁可放行，也不永久卡死）
        return False
    return expires > (now or now_utc())


async def upsert(
    db: AsyncSession,
    *,
    chapter_id: str,
    shot_id: str,
    status: SaveStatus | str,
    prompt: str | None = None,
    source: str = "",
    error: str = "",
    model: str = "",
    meta: dict[str, Any] | None = None,
    server_generated: bool | None = None,
    release_claim: bool = True,
) -> tuple[ShotVideoPromptDraft, bool]:
    """写入/更新一镜的草稿（**幂等 upsert**，一镜永远只有一行）。返回 ``(行, 是否新建)``。

    参数取舍：
    - ``prompt=None`` 表示"不动正文"（只更新状态/失败原因），避免"重试失败把上一版
      已经生成的正文抹掉"；
    - ``server_generated=None`` 表示按内容自证：正文与库里**完全一致**时才沿用原有的
      ``server_generated``，否则一律置 False（客户端新塞进来的正文不算大模型产物）；
    - ``release_claim=True``（默认）：写入结果即表示这次生成结束，顺带释放租约。
    """
    resolved = str(status or "").strip()
    if resolved not in (STATUS_OK, STATUS_FAILED):
        raise ValueError(f"草稿状态只接受 ok / failed，收到：{status!r}")

    incoming = None if prompt is None else str(prompt)
    fields: dict[str, Any] = {
        "chapter_id": str(chapter_id),
        "status": resolved,
        "prompt": incoming,
        "source": str(source or ""),
        "error": str(error or ""),
        "model": str(model or ""),
        "meta": None if meta is None else dict(meta),
        "server_generated": server_generated,
        "release_claim": bool(release_claim),
    }

    row = await _load_any_chapter(db, shot_id=shot_id)
    created = row is None
    if row is None:
        row = ShotVideoPromptDraft(
            shot_id=str(shot_id),
            chapter_id=str(chapter_id),
            status=resolved,
            prompt="",
            source="",
            error="",
            model="",
            meta={},
            server_generated=False,
        )
        db.add(row)
    _apply_fields(row, **fields)
    try:
        await db.commit()
    except IntegrityError:
        # 并发：另一个请求刚给同一镜插了行（主键冲突）→ 退化成"更新已有行"，仍然是幂等 upsert
        await db.rollback()
        row = await _load_any_chapter(db, shot_id=shot_id)
        if row is None:  # pragma: no cover - 理论不可达（冲突说明行一定存在）
            raise
        created = False
        _apply_fields(row, **fields)
        await db.commit()

    await db.refresh(row)
    return row, created


async def claim(
    db: AsyncSession,
    *,
    chapter_id: str,
    shot_id: str,
    lease_seconds: int | None = None,
    claim_token: str = "",
) -> ClaimResult:
    """抢占一镜的「生成中」租约（**同一镜在租约内只能有一次生成**）。

    实现要点（都是"防重复付费"所必需的）：
    - 读一次拿到现状 → 用 ``claim_token`` 做**比较并交换**（CAS）写入：读与写之间
      被别的请求抢走时 ``rowcount`` 为 0，直接判定未抢到，不会两头都以为自己是持有者；
    - 自己没有行时 INSERT，撞主键（另一个请求刚建好）按"未抢到"处理；
    - 租约**会过期**：进程被杀 / 页面关掉之后不会永久锁死（这是"中断后能续跑"的前提）；
    - 带着**同一个** ``claim_token`` 再来 = 续租，允许（页面在生成前先占位再发起请求）。
    """
    seconds = normalize_lease_seconds(lease_seconds)
    now = now_utc()
    expires = now + timedelta(seconds=seconds)

    row = await _load_any_chapter(db, shot_id=shot_id)
    holder = str(row.claim_token or "") if row is not None else ""
    if row is not None and lease_alive(row, now=now):
        if not (claim_token and hmac.compare_digest(holder, str(claim_token))):
            remaining = int((as_naive_utc(row.claim_expires_at) - now).total_seconds())
            return ClaimResult(
                claimed=False,
                reason=(
                    f"该镜头正在生成中（{max(remaining, 0)} 秒后租约自动释放；"
                    "同一镜不允许并发生成，避免重复付费）。"
                ),
                blocking_status=str(row.status or STATUS_RUNNING),
            )

    token = secrets.token_urlsafe(24)
    if row is None:
        db.add(
            ShotVideoPromptDraft(
                shot_id=str(shot_id),
                chapter_id=str(chapter_id),
                status=STATUS_RUNNING,
                prompt="",
                source="",
                error="",
                model="",
                meta={},
                server_generated=False,
                claim_token=token,
                claim_expires_at=expires,
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            # 并发：另一个请求刚建了同一镜的行 → 让给它
            await db.rollback()
            return ClaimResult(
                claimed=False,
                lease_seconds=seconds,
                reason="该镜头刚刚被另一处抢占（并发生成已挡住，未发起重复调用）。",
                blocking_status=STATUS_RUNNING,
            )
        return ClaimResult(claimed=True, claim_token=token, lease_seconds=seconds, expires_at=expires)

    # CAS：只有"持有者令牌没被换掉"时才允许写入（换掉 = 期间被别人抢走了）
    guard = or_(
        ShotVideoPromptDraft.claim_token.is_(None),
        ShotVideoPromptDraft.claim_token == holder,
    )
    result = await db.execute(
        update(ShotVideoPromptDraft)
        .where(
            # 按主键定位（不按 chapter_id 过滤：镜头换集时租约也要能正常抢占/续租）
            ShotVideoPromptDraft.shot_id == str(shot_id),
            guard,
        )
        .values(
            chapter_id=str(chapter_id),
            status=STATUS_RUNNING,
            claim_token=token,
            claim_expires_at=expires,
            updated_at=now,
        )
    )
    if not result.rowcount:
        await db.rollback()
        return ClaimResult(
            claimed=False,
            lease_seconds=seconds,
            reason="该镜头刚刚被另一处抢占（并发生成已挡住，未发起重复调用）。",
            blocking_status=STATUS_RUNNING,
        )
    await db.commit()
    return ClaimResult(claimed=True, claim_token=token, lease_seconds=seconds, expires_at=expires)


async def release(
    db: AsyncSession,
    *,
    chapter_id: str,
    shot_id: str,
    claim_token: str = "",
    error: str = "",
) -> bool:
    """释放租约（不清正文）。``error`` 非空时顺带把状态记为失败。

    用于"真实调用抛异常 / 提前返回"这类收尾：**不留下永远的"生成中"**。
    """
    row = await get_row(db, chapter_id=chapter_id, shot_id=shot_id)
    if row is None:
        return False
    holder = str(row.claim_token or "").strip()
    if claim_token and holder and not hmac.compare_digest(holder, str(claim_token)):
        return False
    row.claim_token = None
    row.claim_expires_at = None
    if error:
        row.status = STATUS_FAILED
        row.error = str(error)
    await db.commit()
    return True


async def clear(
    db: AsyncSession,
    *,
    chapter_id: str,
    shot_ids: Iterable[str] | None = None,
) -> int:
    """清掉该集草稿（``shot_ids`` 为空 = 清整集）。返回删除行数。

    ``/save`` 正式落库成功后调用：草稿使命已完成，留着反而会让页面显示"还有未保存草稿"。
    """
    ids = [str(item) for item in (shot_ids or []) if str(item or "").strip()]
    stmt = delete(ShotVideoPromptDraft).where(ShotVideoPromptDraft.chapter_id == str(chapter_id))
    if ids:
        stmt = stmt.where(ShotVideoPromptDraft.shot_id.in_(ids))
    result = await db.execute(stmt)
    await db.commit()
    return int(result.rowcount or 0)


async def count_for_chapter(db: AsyncSession, *, chapter_id: str) -> int:
    """该集草稿行数（测试/诊断用）。"""
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ShotVideoPromptDraft)
                .where(ShotVideoPromptDraft.chapter_id == chapter_id)
            )
        ).scalar()
        or 0
    )


__all__ = [
    "ClaimResult",
    "DB_STATUSES",
    "DEFAULT_LEASE_SECONDS",
    "MAX_LEASE_SECONDS",
    "MIN_LEASE_SECONDS",
    "READ_STATUSES",
    "STATUS_FAILED",
    "STATUS_OK",
    "STATUS_PENDING",
    "STATUS_RUNNING",
    "as_naive_utc",
    "claim",
    "clear",
    "count_for_chapter",
    "get_row",
    "lease_alive",
    "load_map",
    "normalize_lease_seconds",
    "now_utc",
    "release",
    "upsert",
]
