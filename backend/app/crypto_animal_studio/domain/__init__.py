"""CAS 领域层（domain）。

职责：只存放常量、枚举、领域辅助函数；不定义传输/校验 Pydantic 模型
（那些统一放在 ``crypto_animal_studio.schemas``），也不依赖 FastAPI。
"""

from app.crypto_animal_studio.domain.episode_package import (
    RECURRING_CHARACTER_KEYS,
    SCHEMA_VERSION,
    SUPPORTED_SOURCE_TYPES,
    CasCameraAngle,
    CasCameraMovement,
    CasShotType,
    is_supported_schema_version,
)

__all__ = [
    "SCHEMA_VERSION",
    "SUPPORTED_SOURCE_TYPES",
    "RECURRING_CHARACTER_KEYS",
    "CasShotType",
    "CasCameraAngle",
    "CasCameraMovement",
    "is_supported_schema_version",
]
