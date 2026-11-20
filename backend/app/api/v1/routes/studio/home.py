"""首页摘要接口。"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.home import HomeRecentAsset, HomeRecentCanvas
from app.services.studio.home import recent_assets, recent_canvases

router = APIRouter()


@router.get("/recent-canvases", operation_id="home_recent_canvases")
async def get_recent_canvases(db: AsyncSession = Depends(get_db)) -> ApiResponse[list[HomeRecentCanvas]]:
    """展示最近保存的三张画布。"""
    return success_response(await recent_canvases(db))


@router.get("/recent-assets", operation_id="home_recent_assets")
async def get_recent_assets(db: AsyncSession = Depends(get_db)) -> ApiResponse[list[HomeRecentAsset]]:
    """展示资产库中档案更新时间最近的六项资产。"""
    return success_response(await recent_assets(db))
