"""EpisodePackage 领域常量与辅助（domain 层）。

用途：
- 集中管理与 EpisodePackage 契约相关的**常量 / 枚举 / 纯函数**，供 schemas 层复用，
  避免把「版本号」「合法来源类型」等散落在多处。
- 本模块**不定义** Pydantic 传输模型（那些在 ``crypto_animal_studio.schemas``），
  也**不依赖 FastAPI**，以保持领域层可独立测试与复用。
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

# EpisodePackage 契约版本。Sprint 2 固定为 "1.0"；升级规则见 docs/episode-package-v1.md。
SCHEMA_VERSION: str = "1.0"

# 新闻/素材来源类型的合法取值。schemas 层以 Literal 复用该集合的语义。
SourceType = Literal["news", "original", "fictional", "generic"]


# --------------------------------------------------------------------------- #
# 相机（镜头）传输枚举 —— CAS 本地定义
#
# 说明：这些取值**刻意与 Jellyfish 的 CameraShotType / CameraAngle / CameraMovement
# 存储 code 一一对齐**（存英文 code），以便后续导入器把 EpisodePackage 的 camera 干净地
# 映射到 Jellyfish ShotDetail（camera_shot / angle / movement）。
# 但按边界约定，**不**从 ORM 或 Jellyfish 数据库枚举导入——在 CAS 边界模块内独立声明，
# 避免 schemas 层反向依赖 app.models。
# --------------------------------------------------------------------------- #
class CasShotType(str, Enum):
    """景别（对齐 Jellyfish CameraShotType 的 code）。"""

    ECU = "ECU"
    CU = "CU"
    MCU = "MCU"
    MS = "MS"
    MLS = "MLS"
    LS = "LS"
    ELS = "ELS"


class CasCameraAngle(str, Enum):
    """机位角度（对齐 Jellyfish CameraAngle 的 code）。"""

    EYE_LEVEL = "EYE_LEVEL"
    HIGH_ANGLE = "HIGH_ANGLE"
    LOW_ANGLE = "LOW_ANGLE"
    BIRD_EYE = "BIRD_EYE"
    DUTCH = "DUTCH"
    OVER_SHOULDER = "OVER_SHOULDER"


class CasCameraMovement(str, Enum):
    """运镜方式（对齐 Jellyfish CameraMovement 的 code）。"""

    STATIC = "STATIC"
    PAN = "PAN"
    TILT = "TILT"
    DOLLY_IN = "DOLLY_IN"
    DOLLY_OUT = "DOLLY_OUT"
    TRACK = "TRACK"
    CRANE = "CRANE"
    HANDHELD = "HANDHELD"
    STEADICAM = "STEADICAM"
    ZOOM_IN = "ZOOM_IN"
    ZOOM_OUT = "ZOOM_OUT"

# 合法来源类型集合（供文档/校验/诊断复用；与 SourceType 保持一致）。
SUPPORTED_SOURCE_TYPES: frozenset[str] = frozenset(
    {"news", "original", "fictional", "generic"}
)

# Crypto Animal Studio 常驻角色 key（领域参考，不做强制校验：单集不必六位全到场）。
RECURRING_CHARACTER_KEYS: frozenset[str] = frozenset(
    {"bull", "bear", "fox", "hammy", "monkey", "walter"}
)


def is_supported_schema_version(version: str) -> bool:
    """判断给定 schema_version 是否被当前实现支持。

    参数：
        version: 待检查的版本字符串。
    返回：
        当且仅当 version 等于当前 ``SCHEMA_VERSION`` 时返回 True。
    存在意义：
        让 schemas 校验与未来的多版本兼容判断共用同一处版本真相。
    """
    return version == SCHEMA_VERSION
