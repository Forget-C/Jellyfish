"""付费出口守卫的统一接入层（新旧链路共用同一套闸门）。

判定与审计在 :mod:`app.services.studio.llm_orchestration.dry_run` 里，本模块只负责
「把守卫接到每一个付费出口上」，避免 legacy 路径和新链路各写一套：

- :func:`require_outlet`：付费动作发起**之前**调用，被拦截时抛 409（FastAPI
  ``HTTPException``，沿用全局错误信封 ``{code, message, data: null}``）；
- :func:`require_llm_outlet` / :func:`require_image_outlet` / :func:`require_video_outlet`：
  FastAPI 依赖，可直接挂在 router 或单条路由的 ``dependencies=`` 上；
- :func:`outlet_for_task_kind` / :func:`task_kind_block_reason`：把
  ``GenerationTask.task_kind`` 映射到付费出口，供任务执行入口兜底
  （防的是「先建了任务，回放时才真花钱」）；
- :func:`blocked_envelope`：自持路由复用统一的结构化 409 响应（``meta.error``）；
- :class:`PaidOutletBlocked` / :func:`paid_outlet_blocked_handler`：依赖或服务层抛出的
  拦截异常统一转成结构化 409（``code`` + 中文 ``message`` + 中文 ``how_to_enable``），
  并明确区分「演练模式所以不发真实请求」与「真实模式已开但没确认」。

为什么要接 legacy：

- ``/api/v1/script-processing/*`` 的同步接口在本次 HTTP 请求内直接调用真实大模型并
  按 token 计费；
- ``/api/v1/film/tasks/video`` 会真实出视频；``/api/v1/studio/image-tasks/*`` 会真实出图。

这三处此前都不经过任何闸门，是 DRY_RUN 体系里最大的缺口。

**导入注意**：``app.services.studio`` 这个包的 ``__init__`` 会连带导入大量 studio 模块，
而本模块会被 ``app.services.llm`` 的导入链用到。所以这里对 ``dry_run`` 只做**延迟导入**
（函数内 import），模块级不引入 ``app.services.studio``，否则会形成循环导入。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from app.schemas.common import ApiResponse

BLOCKED_STATUS_CODE = 409
BLOCKED_ERROR_CODE = "paid_outlet_blocked"

# 出口名与 ``dry_run.OUTLETS`` 一致（这里的字面量只是为了不在模块级导入 studio 包）。
OUTLET_LLM = "llm"
OUTLET_IMAGE = "image"
OUTLET_VIDEO = "video"
OUTLET_OSS = "oss"

# 任务型出口：``task_kind`` → 守卫出口名；不在这里的任务不产生外部费用。
PAID_TASK_KIND_OUTLETS: dict[str, str] = {
    "image_generation": OUTLET_IMAGE,
    "video_generation": OUTLET_VIDEO,
}


def _dry_run() -> Any:
    """延迟导入守卫实现（见模块 docstring 的导入注意）。"""
    from app.services.studio.llm_orchestration import dry_run

    return dry_run


def _blocked_types() -> tuple[type[BaseException], ...]:
    d = _dry_run()
    # OutletNotAllowed 是 RealCallNotConfirmed 的子类（"出口不在白名单"），一并覆盖
    return (d.DryRunBlocked, d.RealCallNotConfirmed, d.OutletNotAllowed)


def confirm_hint() -> str:
    """给用户看的「怎么才允许真实调用」的说明。"""
    d = _dry_run()
    return f"要真实调用请显式设置 {d.DRY_RUN_ENV}=0 且 {d.CONFIRM_ENV}=1（会产生真实费用）。"


def outlet_for_task_kind(task_kind: str | None) -> str | None:
    """把任务类型映射到付费出口；不需要付费的任务返回 ``None``。"""
    return PAID_TASK_KIND_OUTLETS.get((task_kind or "").strip())


def is_blocked_exception(exc: BaseException) -> bool:
    """是否为守卫拦截异常（供调用方决定要不要转 409）。"""
    return isinstance(exc, _blocked_types())


class PaidOutletBlocked(HTTPException):
    """守卫拦截 → 可抛出的 409 异常（机器可读 code + 中文 message + 中文 how_to_enable）。

    为什么继承 ``HTTPException``：既有调用方按 ``status_code`` 与 ``str(detail)`` 消费
    （服务层、测试都在用），行为保持不变；同时它带 :attr:`payload`，应用级异常处理器
    （:func:`paid_outlet_blocked_handler`）据此还原成结构化 409（``meta.error``）。
    """

    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__(
            status_code=BLOCKED_STATUS_CODE,
            detail=str(payload.get("message") or BLOCKED_ERROR_CODE),
        )
        self.payload = payload
        self.error_code = str(payload.get("code") or BLOCKED_ERROR_CODE)
        #: ``dry_run``（演练模式）或 ``real_call_not_confirmed``（真实模式已开但没确认）
        self.reason = str(payload.get("reason") or "")

    @property
    def how_to_enable(self) -> str:
        """中文「怎么开真实模式」的单段说明。"""
        return str(self.payload.get("how_to_enable") or "")

    @property
    def enable_steps(self) -> list[str]:
        """中文「怎么开真实模式」的分步说明。"""
        raw = self.payload.get("enable_steps")
        return [str(item) for item in raw] if isinstance(raw, list) else []


def blocked_payload(exc: Exception) -> dict[str, Any]:
    """被拦截异常 → 结构化明细（不含任何密钥）。

    字段分三类：
    - 机器可读：``code``（恒定 ``paid_outlet_blocked``）、``reason``（区分两种拦截原因）；
    - 中文给用户看：``message`` / ``reason_text`` / ``how_to_enable`` / ``enable_steps``；
    - 兼容既有前端与排查：``outlet`` / ``outlet_label`` / ``hint`` / ``guard`` / ``paid_call_made``。

    ``paid_call_made`` 恒为 ``False``：被拦意味着**这次没有任何真实调用 / 上传发生**
    （与 ``reference_regenerate`` 等自持 409 明细同一字段名），前端据此显示「未产生付费调用」。
    """
    d = _dry_run()
    outlet = str(getattr(exc, "outlet", OUTLET_LLM))
    reason = str(getattr(exc, "reason_code", "") or d.blocked_reason_code() or "")
    steps = getattr(exc, "enable_steps", None) or d.enable_steps()
    return {
        "code": BLOCKED_ERROR_CODE,
        "reason": reason,
        # 异常自带说明优先（例如"出口不在白名单"这种与模式无关的拦截原因）
        "reason_text": str(getattr(exc, "reason_text", "") or d.blocked_reason_text() or ""),
        "outlet": outlet,
        "outlet_label": d.outlet_label(outlet),
        "message": str(exc),
        "hint": confirm_hint(),
        "how_to_enable": str(getattr(exc, "how_to_enable", "") or d.how_to_enable_text()),
        "enable_steps": [str(item) for item in steps],
        "restore_steps": d.restore_steps(),
        "mode": d.mode(),
        "mode_label": d.mode_label(),
        #: 被拦 = 没有发起任何真实请求（也就没有付费 / 没有对象写入）
        "paid_call_made": False,
        "guard": d.state(),
    }


def blocked_json_response(payload: dict[str, Any]) -> JSONResponse:
    """结构化明细 → 统一 409 信封（``meta.error`` 里带原因与放开方式）。"""
    return JSONResponse(
        status_code=BLOCKED_STATUS_CODE,
        content=ApiResponse[None](
            code=BLOCKED_STATUS_CODE,
            message=str(payload.get("message") or ""),
            data=None,
            meta={"error": payload},
        ).model_dump(),
    )


def blocked_envelope(exc: Exception) -> JSONResponse:
    """被拦截 → 统一的 409 信封（``meta.error`` 里带出口与放开方式）。"""
    return blocked_json_response(blocked_payload(exc))


def blocked_http_error(exc: Exception) -> PaidOutletBlocked:
    """被拦截 → 可抛出的 :class:`PaidOutletBlocked`（自带结构化 payload）。"""
    return PaidOutletBlocked(blocked_payload(exc))


async def paid_outlet_blocked_handler(request: Request, exc: Exception) -> JSONResponse:
    """应用级异常处理器：把守卫拦截统一变成结构化 409。

    挂在 ``app.main`` 上，覆盖所有**没有**自己 catch 守卫异常的路径（依赖式守卫、
    legacy 路由都走这里），避免全局处理器把结构化 detail 压成一行字符串。
    """
    _ = request  # 处理器签名由 Starlette 固定，这里用不到请求对象
    payload = exc.payload if isinstance(exc, PaidOutletBlocked) else blocked_payload(exc)
    return blocked_json_response(payload)


def require_outlet(detail: str = "", *, outlet: str = OUTLET_LLM) -> None:
    """付费动作发起前的统一检查；被拦截时抛 409，**不会**发出任何请求。"""
    d = _dry_run()
    try:
        d.assert_outbound_allowed(detail, outlet=outlet)
    except _blocked_types() as exc:
        raise blocked_http_error(exc) from exc


def task_kind_block_reason(task_kind: str, detail: str = "") -> str | None:
    """任务执行入口的兜底检查。

    返回被拦截的原因字符串（调用方据此把任务标记为失败并结束）；允许执行或该任务
    类型不产生外部费用时返回 ``None``。这里**不抛异常**，因为任务执行发生在后台
    线程 / worker 里，抛出去只会变成一条没有上下文的堆栈。
    """
    outlet = outlet_for_task_kind(task_kind)
    if outlet is None:
        return None
    d = _dry_run()
    try:
        d.assert_outbound_allowed(detail or f"执行任务 task_kind={task_kind}", outlet=outlet)
    except _blocked_types() as exc:
        return str(exc)
    return None


# --------------------------------------------------------------------------
# FastAPI 依赖：挂 router 或单条路由
# --------------------------------------------------------------------------


async def require_llm_outlet(request: Request) -> None:
    """大模型出口守卫（挂在 paid 路由的 ``dependencies=`` 上）。"""
    require_outlet(
        f"{request.method} {request.url.path} 会真实调用大模型（按 token 计费）",
        outlet=OUTLET_LLM,
    )


async def require_image_outlet(request: Request) -> None:
    """出图出口守卫。"""
    require_outlet(
        f"{request.method} {request.url.path} 会真实发起出图（按张计费）",
        outlet=OUTLET_IMAGE,
    )


async def require_video_outlet(request: Request) -> None:
    """出视频出口守卫。"""
    require_outlet(
        f"{request.method} {request.url.path} 会真实发起出视频（按次计费）",
        outlet=OUTLET_VIDEO,
    )


__all__ = [
    "BLOCKED_ERROR_CODE",
    "BLOCKED_STATUS_CODE",
    "OUTLET_IMAGE",
    "OUTLET_LLM",
    "OUTLET_OSS",
    "OUTLET_VIDEO",
    "PAID_TASK_KIND_OUTLETS",
    "PaidOutletBlocked",
    "blocked_envelope",
    "blocked_http_error",
    "blocked_json_response",
    "blocked_payload",
    "confirm_hint",
    "is_blocked_exception",
    "outlet_for_task_kind",
    "paid_outlet_blocked_handler",
    "require_image_outlet",
    "require_llm_outlet",
    "require_outlet",
    "require_video_outlet",
    "task_kind_block_reason",
]
