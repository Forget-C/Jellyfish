"""FastAPI 应用入口。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.routing import Route

from app.api.v1 import router as api_v1_router
from app.bootstrap import bootstrap_all_registries
from app.canvas_mcp.server import MCP_PATH, CanvasMcpEndpoint, run_transport
from app.config import Settings, settings
from app.core.dev_runtime import process_identity
from app.schemas.common import ApiResponse


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
    """HTTP 异常沿用统一封套；画布领域失败在 data 保留类型化诊断。"""
    from fastapi import HTTPException
    from app.services.generation_canvas.errors import CanvasDomainError
    from app.schemas.generation_canvas import CanvasError

    if isinstance(exc, CanvasDomainError):
        body = CanvasError(code=exc.status_code, message=exc.detail['message'], data=exc.detail).model_dump()
        return JSONResponse(status_code=exc.status_code, content=body)
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


def create_app(config: Settings = settings) -> FastAPI:
    """Configure the API and register MCP only when it has a usable key."""
    secret_key = config.mcp_secret_key.get_secret_value().strip()
    mcp_active = config.mcp_enabled and bool(secret_key)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        with process_identity('api'):
            bootstrap_all_registries()
            if mcp_active:
                async with run_transport() as transport:
                    app.state.canvas_mcp_transport = transport
                    yield
            else:
                if config.mcp_enabled:
                    logging.getLogger(__name__).warning('Canvas MCP is inactive. Set MCP_SECRET_KEY to enable access.')
                yield

    app = FastAPI(
        title=config.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # 统一错误响应格式：{ code, message, data: null }
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, http_exception_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    app.include_router(api_v1_router, prefix=config.api_v1_prefix)
    if mcp_active:
        app.router.routes.append(Route(MCP_PATH, CanvasMcpEndpoint(secret_key, config.cors_origins_list)))
    app.get("/health")(health)
    return app


async def health():
    """健康检查。"""
    from app.schemas.common import success_response
    return success_response({"status": "ok"})


app = create_app()
