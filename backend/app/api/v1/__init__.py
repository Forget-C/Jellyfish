"""API v1 路由聚合。"""

from fastapi import APIRouter

from app.api.v1.routes import film, health, llm, studio, script_processing
from app.crypto_animal_studio.api import router as crypto_animal_studio_router

router = APIRouter()

router.include_router(health.router, tags=["health"])
router.include_router(film.router, prefix="/film", tags=["film"])
router.include_router(llm.router, prefix="/llm", tags=["llm"])
router.include_router(studio.router, prefix="/studio")
router.include_router(script_processing.router)
# Crypto Animal Studio（CAS）受限边界模块：通过既有聚合机制挂载，不新建独立 FastAPI app。
router.include_router(
    crypto_animal_studio_router,
    prefix="/crypto-animal-studio",
    tags=["crypto-animal-studio"],
)
