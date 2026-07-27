"""统一生成业务结果发布器。"""

from app.services.generation.publishers.asset_image import AssetImagePublisher
from app.services.generation.publishers.base import GenerationResultPublisher
from app.services.generation.publishers.shot_frame import ShotFramePublisher
from app.services.generation.publishers.shot_video import ShotVideoPublisher

__all__ = [
    "AssetImagePublisher",
    "GenerationResultPublisher",
    "ShotFramePublisher",
    "ShotVideoPublisher",
]
