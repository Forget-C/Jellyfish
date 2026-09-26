"""API 通用工具：列表过滤、排序、分页、结构化错误信封。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.common import ApiResponse

#: 非结构化 detail（纯字符串）被包进 meta.error 时用的通用码
STRUCTURED_ERROR_CODE = "structured_error"


def error_envelope(*, code: int, detail: Any) -> JSONResponse:
    """把服务层的**结构化错误**塞进统一 ``ApiResponse`` 信封的 ``meta.error`` 里。

    形状与既有的 ``image_pipeline`` / ``llm_orchestration`` / ``prompt_board`` 三条路由一致：
    ``detail`` 是 dict 时原样放进 ``meta.error``（``message`` 取它的 ``message``），
    否则包成 ``{"code": "structured_error", "message": <str>}``。
    这里不另写一套判定逻辑，只是让新增的写入路径不必再复制第四份。
    """
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("code") or "error")
        error = detail
    else:
        message = str(detail)
        error = {"code": STRUCTURED_ERROR_CODE, "message": message}
    body = ApiResponse[None](code=code, message=message, data=None, meta={"error": error}).model_dump()
    return JSONResponse(status_code=code, content=body)


def normalize_q(q: str | None) -> str | None:
    if q is None:
        return None
    s = q.strip()
    return s or None


def apply_keyword_filter(
    stmt: Select[Any],
    *,
    q: str | None,
    fields: Sequence[InstrumentedAttribute[Any]],
) -> Select[Any]:
    qn = normalize_q(q)
    if not qn or not fields:
        return stmt
    pattern = f"%{qn}%"
    cond = None
    for f in fields:
        expr = f.ilike(pattern)
        cond = expr if cond is None else (cond | expr)
    return stmt.where(cond) if cond is not None else stmt


def apply_order(
    stmt: Select[Any],
    *,
    model: Any,
    order: str | None,
    is_desc: bool,
    allow_fields: set[str],
    default: str,
) -> Select[Any]:
    col = order if order and order in allow_fields else default
    attr = getattr(model, col)
    return stmt.order_by(attr.desc() if is_desc else attr.asc())


async def paginate(
    db: AsyncSession,
    *,
    stmt: Select[Any],
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_res = await db.execute(count_stmt)
    total = int(total_res.scalar() or 0)

    res = await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
    items = list(res.scalars().all())
    return items, total

