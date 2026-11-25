"""API v1 路由聚合。"""

from fastapi import APIRouter

from app.api.v1.routes import film, health, llm, studio, script_processing

router = APIRouter()

router.include_router(health.router, tags=["health"])
router.include_router(film.router, prefix="/film", tags=["film"])
router.include_router(llm.router, prefix="/llm", tags=["llm"])
router.include_router(studio.router, prefix="/studio")
router.include_router(script_processing.router)
