"""统一生成业务结果发布器。"""

from app.services.generation.publishers.asset_image import AssetImagePublisher
from app.services.generation.publishers.base import GenerationResultPublisher

__all__ = [
    "AssetImagePublisher",
    "GenerationResultPublisher",
]
