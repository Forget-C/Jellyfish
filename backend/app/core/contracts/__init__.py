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
from app.core.contracts.generation import (
    GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation,
    GenerationSubmitRequest, GenerationTarget, GenerationTargetKind, ResolvedGenerationSnapshot,
)
from app.core.contracts.media import (
    ImageMediaInput, MediaReference, VideoFrameMediaReferences, VideoMediaInput,
    VideoSubjectMediaReference,
)
from app.core.contracts.text_generation import ScriptOperationInput, TextChatInput, TextChatMessage
from app.core.contracts.streaming import (
    GenerationStreamEvent,
    GenerationStreamEventSequence,
    StreamAcceptedData,
    StreamCancelledData,
    StreamCompletedData,
    StreamDeltaData,
    StreamErrorData,
    StreamErrorDetail,
    StreamEventType,
    StreamGenerationResult,
    StreamHeartbeatData,
    StreamMessageData,
    StreamProgressData,
)

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
    "GenerationCommand",
    "GenerationDelivery",
    "GenerationModality",
    "GenerationOperation",
    "GenerationSubmitRequest",
    "GenerationTarget",
    "GenerationTargetKind",
    "ResolvedGenerationSnapshot",
    "MediaReference",
    "ImageMediaInput",
    "VideoFrameMediaReferences",
    "VideoMediaInput",
    "VideoSubjectMediaReference",
    "TextChatInput",
    "TextChatMessage",
    "ScriptOperationInput",
    "GenerationStreamEvent",
    "GenerationStreamEventSequence",
    "StreamEventType",
    "StreamMessageData",
    "StreamGenerationResult",
    "StreamErrorDetail",
    "StreamAcceptedData",
    "StreamDeltaData",
    "StreamProgressData",
    "StreamCompletedData",
    "StreamErrorData",
    "StreamCancelledData",
    "StreamHeartbeatData",
]
