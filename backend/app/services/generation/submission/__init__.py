"""统一生成提交服务导出。"""

from app.services.generation.submission.capabilities import (
    GenerationCapabilityRegistry,
    UnsupportedGenerationDeliveryError,
    generation_capability_registry,
)
from app.services.generation.submission.submitter import GenerationAccepted, GenerationEntityGate, GenerationSubmitter

__all__ = [
    "GenerationAccepted",
    "GenerationCapabilityRegistry",
    "GenerationEntityGate",
    "GenerationSubmitter",
    "UnsupportedGenerationDeliveryError",
    "generation_capability_registry",
]
