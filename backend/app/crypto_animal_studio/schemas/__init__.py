"""CAS schemas 层：EpisodePackage v1 传输 / 校验模型。

职责：本层是 EpisodePackage 契约的**唯一** Pydantic 模型来源（domain 层不重复定义）。
对外导出根模型与主要子模型，便于导入与测试。
"""

from app.crypto_animal_studio.schemas.episode_package import (
    ActorAsset,
    AssetLibrary,
    CameraSpec,
    CharacterSpec,
    CostumeAsset,
    CreativeDirection,
    DialogueLine,
    EpisodeMetadata,
    EpisodePackage,
    NewsSource,
    PropAsset,
    SceneAsset,
    Shot,
)

__all__ = [
    "EpisodePackage",
    "NewsSource",
    "CreativeDirection",
    "CharacterSpec",
    "AssetLibrary",
    "ActorAsset",
    "SceneAsset",
    "PropAsset",
    "CostumeAsset",
    "Shot",
    "CameraSpec",
    "DialogueLine",
    "EpisodeMetadata",
]
