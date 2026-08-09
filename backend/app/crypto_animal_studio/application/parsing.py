"""EpisodePackage 版本分派解析（application 层）。

显式分派，绝不「顺带」接受两个版本：
- ``"1.0"`` → ``EpisodePackage``（v1 语义完全不变）；
- ``"1.1"`` → ``EpisodePackageV11``（附加式扩展）；
- 缺失 ``schema_version`` → 沿用既有 v1 行为（必填字段缺失错误），不发明任何回落；
- 未知版本 → 显式 ``UnsupportedSchemaVersionError``，绝不强制升级为最新版本。

解析**不会**改写 ``schema_version``、不会把可选对象写回源文档、不会重算既有 payload hash。
"""

from __future__ import annotations

from typing import Any, Union

from pydantic import ValidationError

from app.crypto_animal_studio.domain.episode_package import (
    SCHEMA_VERSION,
    SCHEMA_VERSION_V1_1,
    SUPPORTED_SCHEMA_VERSIONS,
)
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage, EpisodePackageV11

AnyEpisodePackage = Union[EpisodePackage, EpisodePackageV11]


class UnsupportedSchemaVersionError(ValueError):
    """schema_version 不在显式支持集合内。"""

    def __init__(self, version: object) -> None:
        """记录被拒绝的版本值与当前支持集合。"""
        self.version = version
        supported = ", ".join(sorted(SUPPORTED_SCHEMA_VERSIONS))
        super().__init__(f'unsupported schema_version {version!r}; supported versions: {supported}')


def parse_episode_package(data: dict[str, Any]) -> AnyEpisodePackage:
    """按 ``schema_version`` 显式分派并校验 EpisodePackage。

    参数：
        data: 原始 dict（不会被修改）。
    返回：
        v1 或 v1.1 的已校验模型实例。
    异常：
        UnsupportedSchemaVersionError: 版本存在但不受支持。
        pydantic.ValidationError: 结构/字段级校验失败（含缺失 schema_version）。
    """
    if not isinstance(data, dict):
        raise TypeError("episode package payload must be a mapping")

    version = data.get("schema_version")
    if version is None:
        # 缺失版本：交给 v1 模型产生既有的「必填字段缺失」错误，不发明回落。
        return EpisodePackage.model_validate(data)

    if version == SCHEMA_VERSION:
        return EpisodePackage.model_validate(data)
    if version == SCHEMA_VERSION_V1_1:
        return EpisodePackageV11.model_validate(data)
    raise UnsupportedSchemaVersionError(version)


def is_v11(package: AnyEpisodePackage) -> bool:
    """判断是否为 v1.1 包（供校验器选择附加规则）。"""
    return isinstance(package, EpisodePackageV11)


def _reraise_validation(error: ValidationError) -> None:  # pragma: no cover - 便于将来包装
    """预留：如需把 pydantic 错误转换为领域错误时使用。"""
    raise error


__all__ = [
    "parse_episode_package",
    "UnsupportedSchemaVersionError",
    "AnyEpisodePackage",
    "is_v11",
]
