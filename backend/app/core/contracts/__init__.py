"""生成任务共享契约导出。"""

from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
    InputImageRef,
    ResponseFormat,
)
from app.core.contracts.provider import ProviderConfig, ProviderKey
from app.core.contracts.model_catalog import ProviderModelCandidate, ProviderModelCatalog
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult

__all__ = [
    "ProviderConfig",
    "ProviderKey",
    "ProviderModelCandidate",
    "ProviderModelCatalog",
    "VideoGenerationInput",
    "VideoGenerationResult",
    "ImageGenerationInput",
    "ImageGenerationResult",
    "ImageItem",
    "InputImageRef",
    "ResponseFormat",
]
