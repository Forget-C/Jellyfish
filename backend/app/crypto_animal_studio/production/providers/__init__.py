"""生产供应商边界与 Mock 实现。"""

from app.crypto_animal_studio.production.providers.base import (
    Composer,
    GeneratedArtifact,
    ImageProvider,
    ProviderBundle,
    VideoProvider,
    VoiceProvider,
)
from app.crypto_animal_studio.production.providers.mock import (
    MockComposer,
    MockImageProvider,
    MockProviderFailure,
    MockVideoProvider,
    MockVoiceProvider,
    build_mock_bundle,
)

__all__ = [
    "GeneratedArtifact",
    "ImageProvider",
    "VideoProvider",
    "VoiceProvider",
    "Composer",
    "ProviderBundle",
    "MockImageProvider",
    "MockVideoProvider",
    "MockVoiceProvider",
    "MockComposer",
    "MockProviderFailure",
    "build_mock_bundle",
]
