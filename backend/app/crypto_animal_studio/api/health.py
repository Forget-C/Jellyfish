"""CAS 健康检查端点（v1 内，薄路由）。

用途：提供一个不依赖数据库/外部服务的轻量端点，用于确认 CAS 模块已正确注册，
并对外暴露当前 EpisodePackage 契约版本，便于集成方做版本探测。
"""

from fastapi import APIRouter

from app.crypto_animal_studio.domain.episode_package import SCHEMA_VERSION
from app.schemas.common import ApiResponse, success_response

router = APIRouter()


@router.get("/health", response_model=ApiResponse[dict])
async def cas_health() -> ApiResponse[dict]:
    """返回 CAS 模块健康状态与契约版本。

    返回：
        统一 ``ApiResponse`` 壳，data 形如
        ``{"service": "crypto-animal-studio", "status": "ok", "schema_version": "1.0"}``。
    """
    return success_response(
        data={
            "service": "crypto-animal-studio",
            "status": "ok",
            "schema_version": SCHEMA_VERSION,
        }
    )
