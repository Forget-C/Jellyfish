from __future__ import annotations

"""
AI Studio/影视制作相关的数据库模型（聚合导出器）。

为避免在单个文件里维护过多 ORM 定义，这里把模型类按类别拆分到多个模块，
并在此处统一 re-export，保持现有导入路径兼容（`app.models.studio.*`）。
"""

from app.models.studio_assets import Actor, Character, CharacterPropLink, Costume, Prop, Scene
from app.models.studio_asset_images import (
    ActorImage,
    CharacterImage,
    CostumeImage,
    PropImage,
    SceneImage,
)
from app.models.studio_prompts_files_timeline import FileItem, PromptTemplate, TimelineClip
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
from app.models.studio_shots import (
    Shot,
    ShotExtractedCandidate,
    ShotExtractedDialogueCandidate,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
    ShotFrameImage,
)
from app.models.types import (
    AssetQualityLevel,
    AssetViewAngle,
    CameraAngle,
    CameraMovement,
    CameraShotType,
    ChapterStatus,
    DialogueLineMode,
    FileType,
    FileUsageKind,
    ProjectStyle,
    ProjectVisualStyle,
    PromptCategory,
    ShotCandidateStatus,
    ShotCandidateType,
    ShotDialogueCandidateStatus,
    ShotFrameType,
    ShotStatus,
    TimelineClipType,
    VFXType,
)

__all__ = [
    # Enums
    "ProjectStyle",
    "ProjectVisualStyle",
    "ChapterStatus",
    "ShotStatus",
    "ShotCandidateType",
    "ShotCandidateStatus",
    "ShotDialogueCandidateStatus",
    "CameraShotType",
    "CameraAngle",
    "CameraMovement",
    "AssetQualityLevel",
    "AssetViewAngle",
    "ShotFrameType",
    "FileType",
    "FileUsageKind",
    "TimelineClipType",
    "DialogueLineMode",
    "VFXType",
    "PromptCategory",
    # Models
    "Project",
    "Chapter",
    "Scene",
    "Prop",
    "Costume",
    "Shot",
    "ShotDetail",
    "ShotFrameImage",
    "ShotDialogLine",
    "ShotExtractedCandidate",
    "ShotExtractedDialogueCandidate",
    "Actor",
    "Character",
    "CharacterImage",
    "CharacterPropLink",
    "ShotCharacterLink",
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
    "TimelineClip",
    "ExperimentSession",
    "ExperimentMessage",
]
