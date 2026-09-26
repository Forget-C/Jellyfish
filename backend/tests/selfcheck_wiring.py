#!/usr/bin/env python3
"""后端装配自检：应用能否加载 + 新路由是否挂载 + OpenAPI 是否可生成。

不启动服务器，不写库，不联网。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JELLYFISH_CELERY_EAGER", "1")

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


print("== 1. 加载应用 ==")
from app.main import app  # noqa: E402

check("FastAPI 实例已创建", app is not None)

print("== 2. 收集全部路由 ==")
paths = {route.path for route in app.routes if hasattr(route, "path")}
print(f"  路由总数：{len(paths)}")

print("== 3. 出口 A 路由在位 ==")
check(
    "preview 端点",
    "/api/v1/studio/prompt-delivery/{project_id}" in paths,
    "未找到 prompt-delivery preview",
)
check(
    "export 端点",
    "/api/v1/studio/prompt-delivery/{project_id}/export" in paths,
    "未找到 prompt-delivery export",
)

print("== 4. 巨日禄导入路由在位 ==")
check(
    "preview 端点",
    "/api/v1/studio/jurilu-import/{project_id}/preview" in paths,
    "未找到 jurilu-import preview",
)
check(
    "apply 端点",
    "/api/v1/studio/jurilu-import/{project_id}/apply" in paths,
    "未找到 jurilu-import apply",
)

print("== 5. OpenAPI 可生成（schema 无冲突） ==")
schema = app.openapi()
check("openapi() 返回 dict", isinstance(schema, dict) and "paths" in schema)
check(
    "OpenAPI 收录 jurilu-import",
    any("/jurilu-import/" in p for p in schema.get("paths", {})),
)

print("== 6. 新路由的依赖：sqlalchemy 会话工厂可用 ==")
from app.core.db import async_session_maker  # noqa: E402

check("async_session_maker 存在", async_session_maker is not None)

print("== 7. 巨日禄抓取模块零第三方依赖 ==")
import app.services.external.jurilu_agent_import as jai  # noqa: E402

check("模块可导入", jai is not None)
check(
    "平台名常量正确",
    jai.JURILU_AGENT_PLATFORM_NAME == "巨日禄",
    jai.JURILU_AGENT_PLATFORM_NAME,
)

print()
print(f"结果：{PASS} 通过 / {FAIL} 失败")
sys.exit(1 if FAIL else 0)
