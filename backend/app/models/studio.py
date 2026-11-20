from __future__ import annotations

"""
AI Studio/影视制作相关的数据库模型（聚合导出器）。

为避免在单个文件里维护过多 ORM 定义，这里把模型类按类别拆分到多个模块，
并在此处统一 re-export，保持现有导入路径兼容（`app.models.studio.*`）。
"""

from app.models.studio_assets import Actor, Character, Costume, Prop, Scene
from app.models.studio_asset_images import (
    ActorImage,
    CharacterImage,
    CostumeImage,
    PropImage,
    SceneImage,
)
from app.models.studio_prompts_files_timeline import FileItem, PromptTemplate
from app.models.studio_file_usages import FileUsage
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.models.studio_projects import (
    Chapter,
    Project,
    ProjectActorLink,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
)
from app.models.types import (
    AssetQualityLevel,
    AssetViewAngle,
    ChapterStatus,
    FileType,
    FileUsageKind,
    ProjectStyle,
    ProjectVisualStyle,
    PromptCategory,
)

__all__ = [
    # Enums
    "ProjectStyle",
    "ProjectVisualStyle",
    "ChapterStatus",
    "AssetQualityLevel",
    "AssetViewAngle",
    "FileType",
    "FileUsageKind",
    "PromptCategory",
    # Models
    "Project",
    "Chapter",
    "Scene",
    "Prop",
    "Costume",
    "Actor",
    "Character",
    "CharacterImage",
    "ActorImage",
    "SceneImage",
    "PropImage",
    "CostumeImage",
    "ProjectActorLink",
    "ProjectSceneLink",
    "ProjectPropLink",
    "ProjectCostumeLink",
    "PromptTemplate",
    "FileItem",
    "FileUsage",
    "ExperimentSession",
    "ExperimentMessage",
]
