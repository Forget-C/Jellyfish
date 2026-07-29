"""影视技能 API：实体抽取、分镜抽取。"""

from __future__ import annotations


from fastapi import APIRouter

from app.api.v1.routes.film import task_status

router = APIRouter()
router.include_router(task_status.router)

__all__ = ["router"]
