from __future__ import annotations

from enum import Enum


class ProjectStyle(str, Enum):
    """项目题材/风格维度（不用于区分真人/动漫）。"""

    # 真人：都市、科幻、古装；动漫：科幻、古装、3D、国漫、水墨画
    real_people_city = "真人都市"
    real_people_scifi = "真人科幻"
    real_people_ancient = "真人古装"
    anime_scifi = "动漫科幻"
    anime_3d = "动漫3D"
    guoman = "国漫"
    ink_wash = "水墨画"


class ProjectVisualStyle(str, Enum):
    """画面表现形式维度：用于区分现实/动漫等。"""

    live_action = "现实"
    anime = "动漫"


class ChapterStatus(str, Enum):
    """章节生产状态。"""

    draft = "draft"
    shooting = "shooting"
    done = "done"


class AssetQualityLevel(str, Enum):
    """资产精度等级（由低到高逐步补齐更多角度/细节图）。"""

    low = "LOW"
    medium = "MEDIUM"
    high = "HIGH"
    ultra = "ULTRA"


class AssetViewAngle(str, Enum):
    """资产图片角度（用于多视图描述同一资产）。"""

    front = "FRONT"
    left = "LEFT"
    right = "RIGHT"
    back = "BACK"
    three_quarter = "THREE_QUARTER"
    top = "TOP"
    detail = "DETAIL"


class FileType(str, Enum):
    """文件类型（用于素材库与时间线引用）。"""

    image = "image"
    video = "video"


class FileUsageKind(str, Enum):
    """文件在项目业务链上的用途（file_usages.usage_kind）。"""

    directing_reference = "directing_reference"
    directing_take = "directing_take"
    generated_video = "generated_video"
    character_image = "character_image"
    asset_image = "asset_image"
    task_link = "task_link"
    upload = "upload"
    api = "api"


class PromptCategory(str, Enum):
    """提示词模板类别。"""

    frame_head_image = "frame_head_image"
    frame_tail_image = "frame_tail_image"
    frame_key_image = "frame_key_image"
    frame_head_prompt = "frame_head_prompt"
    frame_tail_prompt = "frame_tail_prompt"
    frame_key_prompt = "frame_key_prompt"
    video_prompt = "video_prompt"
    storyboard_prompt = "storyboard_prompt"
    bgm = "bgm"
    sfx = "sfx"
    character_image = "character_image"
    actor_image = "actor_image"
    prop_image = "prop_image"
    scene_image_front = "scene_image_front"
    scene_image_other = "scene_image_other"
    costume_image = "costume_image"
    combined = "combined"
