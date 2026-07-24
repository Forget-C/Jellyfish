"""CAS api 层：轻量路由聚合。

职责：仅收参、组织响应（统一 ``ApiResponse`` 壳）；不承载业务逻辑。
本聚合 router 由 ``app.api.v1`` 以 ``/crypto-animal-studio`` 前缀挂载。
"""

from fastapi import APIRouter

from app.crypto_animal_studio.api import health, import_episode

router = APIRouter()
router.include_router(health.router)
router.include_router(import_episode.router)

__all__ = ["router"]
