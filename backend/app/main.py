"""FastAPI 应用入口。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.v1 import router as api_v1_router
from app.bootstrap import bootstrap_all_registries
from app.config import settings
from app.core.storage import init_storage, is_local_storage, local_storage_path
from app.schemas.common import ApiResponse
from app.services.paid_outlet_guard import PaidOutletBlocked, paid_outlet_blocked_handler


logger = logging.getLogger(__name__)


def _error_message(detail: object) -> str:
    """将异常 detail 转为前端可读的 message。"""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, dict) and "msg" in item:
                loc = item.get("loc", ())
                loc_str = ".".join(str(x) for x in loc if x != "body")
                parts.append(f"{loc_str}: {item['msg']}" if loc_str else item["msg"])
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else "Validation error"
    return str(detail)


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """HTTP 异常统一为 { code, message, data: null }。"""
    from fastapi import HTTPException

    if isinstance(exc, HTTPException):
        code = exc.status_code
        message = _error_message(exc.detail)
    else:
        code = 500
        message = "Internal server error"
    body = ApiResponse[None](code=code, message=message, data=None, meta=None).model_dump()
    return JSONResponse(status_code=code, content=body)


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 校验异常统一为 { code: 422, message, data: null }。"""
    assert isinstance(exc, RequestValidationError)
    message = _error_message(exc.errors())
    body = ApiResponse[None](code=422, message=message, data=None, meta=None).model_dump()
    return JSONResponse(status_code=422, content=body)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化，关闭时清理。"""
    # 启动时：守卫模式点名。真实模式若是由 backend/.env 打开的，这里打一条醒目中文告警
    # （.env 通常被 gitignore，改它不进代码评审，是最容易「悄悄开出去」的一条路）。
    from app.services.studio.llm_orchestration import dry_run

    warning = dry_run.startup_warning()
    if warning:
        logger.warning(warning)

    # 出站兜底（按需）：默认不装，避免静默改变本地「演练模式下仍可做只读外部读取」的用法；
    # 显式设 JELLYFISH_NETWORK_GUARD=1 才安装，安装后只放行「真实模式且已确认」+ 本机/白名单。
    if dry_run.network_guard_requested():
        dry_run.install_network_guard()
        logger.warning(
            "已按 JELLYFISH_NETWORK_GUARD=1 安装出站兜底：非真实模式（演练 / 未确认）下"
            "外部 httpx 主机一律拦截（本机地址与 JELLYFISH_DRY_RUN_ALLOW_HOSTS 白名单除外）。"
        )
    # 启动时：供应商注册 + 任务执行器注册（幂等）
    bootstrap_all_registries()
    # 启动时：初始化存储（S3 或本地磁盘，二选一）
    try:
        init_storage()
    except Exception as exc:  # noqa: BLE001 - 存储不可用不应阻断进程启动
        logger.warning("存储初始化失败，产物落盘能力不可用：%s", exc)
    yield
    # 关闭时：清理资源
    from app.core.db import close_db

    await close_db()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# 统一错误响应格式：{ code, message, data: null }
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
# 付费出口守卫的拦截单独走结构化 409（code + 中文 message + how_to_enable），
# 必须在 HTTPException 之上注册，否则会被上面那条压成一行字符串。
app.add_exception_handler(PaidOutletBlocked, paid_outlet_blocked_handler)
app.add_exception_handler(Exception, http_exception_handler)

# 本机开发服务器的端口会漂移（vite 5173、preview 7788、streamlit 8501 等），
# 显式白名单容易漏，这里额外放行「本机任意端口」的来源；远程域名一律不放行。
LOCAL_ORIGIN_REGEX = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix=settings.api_v1_prefix)
# 影视技能路由同时挂到主应用，保证 /api/v1/film 一定可访问


@app.get("/health")
async def health():
    """健康检查。"""
    from app.schemas.common import success_response
    return success_response({"status": "ok"})


@app.get("/files/{key:path}")
async def serve_local_file(key: str):
    """本地存储驱动下的文件回放。

    只在 ``STORAGE_DRIVER=local`` 时可用；S3 驱动下由对象存储自己的
    公网地址提供服务，走本路由没有意义，直接 404。
    """
    if not is_local_storage():
        raise HTTPException(status_code=404, detail="本地存储未启用，请使用对象存储地址访问")

    try:
        target = local_storage_path(key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"文件不存在：{key}")

    return FileResponse(target)
