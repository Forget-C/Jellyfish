"""「广告剧情流程」的四个端点（+ 一个找章节的小入口）。

    GET  /studio/chapters/{chapter_id}/drama-plan            读取草稿（只读，永不付费）
    PUT  /studio/chapters/{chapter_id}/drama-plan/brief      保存商品信息（**免费，绝不触模型**）
    PUT  /studio/chapters/{chapter_id}/drama-plan/draft      保存手改草稿（免费，只写草稿列）
    POST /studio/chapters/{chapter_id}/drama-plan/generate   生成草稿（**付费出口**，租约防重复）
    POST /studio/chapters/{chapter_id}/drama-plan/confirm    确认落库（materialize，一个事务）
    POST /studio/projects/{project_id}/drama-plan/chapter    项目里找一个可用空章节（没有就建）

为什么读写分成两个文件（仓库惯例）
==================================

``shot_binding.py`` / ``shot_binding_action.py``、``prompt_board.py``（读+写同一文件）…
既有做法是"**哪些端点会花钱必须一眼可数**"。这里会花钱的只有 ``generate`` 一个，
所以它和只读/免费的三个放在同一个文件里，但**在每条的 summary 里标死出口性质**。

守卫怎么挂（与既有 newest 链路一致，不是漏挂）
==============================================

``generate`` **不挂** ``dependencies=[Depends(require_llm_outlet)]``：
那条守卫在演练模式下直接 409，会让"演练走通全链路"这条验收做不成
——而 ``llm_orchestration`` 的四个预览端点正是这么处理的（服务层在演练下返回占位结果，
路由只捕获拦截异常做**兜底**，防的是"新路径忘了过服务层守卫"）。
所以这里同样：服务层走 ``dry_run`` 判定，路由用 ``paid_outlet_guard.is_blocked_exception``
兜底成统一的结构化 409（``meta.error.paid_call_made == false``）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import error_envelope
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.drama_plan import (
    DramaBrief,
    DramaPlanConfirmRead,
    DramaPlanRead,
)
from app.services import paid_outlet_guard
from app.services.studio import drama_plan_service as service

router = APIRouter()
project_router = APIRouter()

#: 出口性质标注（写进 summary，让"哪些会花钱"一眼可数）
OUTLET_FREE = "免费出口：不调用模型、不产生费用"
OUTLET_PAID = "付费出口：真实调用一次大模型（租约防重复；演练模式下返回占位且不落草稿）"


def _error(exc: Any) -> JSONResponse:
    """HTTPException → 结构化明细（``meta.error``），不让全局处理器把它压成一行字符串。"""
    return error_envelope(code=exc.status_code, detail=exc.detail)


@router.get(
    "/{chapter_id}/drama-plan",
    response_model=ApiResponse[DramaPlanRead],
    summary=f"读取剧情方案草稿（brief + 草稿 + 状态）· {OUTLET_FREE}",
)
async def get_drama_plan(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """只读：返回 brief 与草稿。**永不调用模型**。"""
    try:
        data = await service.load_plan(db, chapter_id=chapter_id)
    except Exception as exc:  # noqa: BLE001 - 统一走结构化明细
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    return success_response(DramaPlanRead.model_validate(data))


@router.put(
    "/{chapter_id}/drama-plan/brief",
    response_model=ApiResponse[DramaPlanRead],
    summary=f"保存商品信息 brief · {OUTLET_FREE}",
)
async def put_drama_plan_brief(
    chapter_id: str,
    body: DramaBrief,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """保存 brief：**绝不触发模型调用**，也不动已生成的草稿。"""
    try:
        data = await service.save_brief(db, chapter_id=chapter_id, brief=body.model_dump())
    except Exception as exc:  # noqa: BLE001
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    return success_response(DramaPlanRead.model_validate(data))


@router.put(
    "/{chapter_id}/drama-plan/draft",
    response_model=ApiResponse[DramaPlanRead],
    summary=f"保存人工编辑后的草稿（只写草稿列）· {OUTLET_FREE}",
)
async def put_drama_plan_draft(
    chapter_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> Any:
    """保存手改的草稿：**免费**，只写 ``drama_plan_drafts.plan``，正式行一行都不碰。"""
    try:
        data = await service.save_plan(db, chapter_id=chapter_id, plan=body)
    except Exception as exc:  # noqa: BLE001
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    return success_response(DramaPlanRead.model_validate(data))


@router.post(
    "/{chapter_id}/drama-plan/generate",
    response_model=ApiResponse[DramaPlanRead],
    summary=f"生成剧情方案草稿（一次模型调用）· {OUTLET_PAID}",
)
async def post_drama_plan_generate(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """生成草稿：抢租约 → 一次调用 → 只落草稿列（确认之前不写任何正式行）。"""
    try:
        data = await service.generate(db, chapter_id=chapter_id)
    except Exception as exc:  # noqa: BLE001
        # 兜底：守卫拦截（演练 / 未确认真实付费 / 出口不在白名单）→ 统一 409 结构化信封
        if paid_outlet_guard.is_blocked_exception(exc):
            return paid_outlet_guard.blocked_envelope(exc)
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    return success_response(DramaPlanRead.model_validate(data))


@router.post(
    "/{chapter_id}/drama-plan/confirm",
    response_model=ApiResponse[DramaPlanConfirmRead],
    summary=f"确认落库（materialize，一个事务）· {OUTLET_FREE}",
)
async def post_drama_plan_confirm(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """把草稿落成正式产物；失败整体回滚，不会留下半个章节。"""
    try:
        data = await service.confirm(db, chapter_id=chapter_id)
    except Exception as exc:  # noqa: BLE001
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    payload = DramaPlanConfirmRead.model_validate(data)
    return success_response(payload, meta={"note": data.get("note", "")})


@project_router.post(
    "/{project_id}/drama-plan/chapter",
    summary=f"取一个可用空章节（没有就建一个）· {OUTLET_FREE}",
)
async def post_drama_plan_chapter(
    project_id: str,
    body: dict[str, Any] | None = None,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """项目级入口：返回该项目的"可用空章节"（优先复用，没有就按商品名建一个）。"""
    product_name = str((body or {}).get("product_name") or "")
    try:
        data = await service.resolve_working_chapter(
            db, project_id=project_id, product_name=product_name
        )
    except Exception as exc:  # noqa: BLE001
        if hasattr(exc, "status_code") and hasattr(exc, "detail"):
            return _error(exc)
        raise
    return success_response(data)


__all__ = ["project_router", "router"]
