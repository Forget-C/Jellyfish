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
from app.core.contracts.video_generation import VideoFrameReferences, VideoGenerationInput, VideoGenerationResult, VideoSubjectReference
from app.core.contracts.experiment import ExperimentInputSnapshot

__all__ = [
    "ProviderConfig",
    "ProviderKey",
    "ProviderModelCandidate",
    "ProviderModelCatalog",
    "VideoGenerationInput",
    "VideoFrameReferences",
    "VideoGenerationResult",
    "VideoSubjectReference",
    "ImageGenerationInput",
    "ImageGenerationResult",
    "ImageItem",
    "InputImageRef",
    "ResponseFormat",
    "ExperimentInputSnapshot",
]
