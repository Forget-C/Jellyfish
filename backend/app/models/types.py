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


class ShotStatus(str, Enum):
    """镜头生成状态（更多是“生产流程”而非剧情状态）。"""

    pending = "pending"
    generating = "generating"
    ready = "ready"


class ShotCandidateType(str, Enum):
    """镜头提取候选类型。"""

    character = "character"
    scene = "scene"
    prop = "prop"
    costume = "costume"


class ShotCandidateStatus(str, Enum):
    """镜头提取候选确认状态。"""

    pending = "pending"
    linked = "linked"
    ignored = "ignored"


class ShotDialogueCandidateStatus(str, Enum):
    """镜头对白提取候选确认状态。"""

    pending = "pending"
    accepted = "accepted"
    ignored = "ignored"


class CameraShotType(str, Enum):
    """景别（与 `app.schemas.skills.common.ShotType` 对齐，存英文 code）。"""

    ecu = "ECU"  # 大特写
    cu = "CU"  # 特写
    mcu = "MCU"  # 中近景
    ms = "MS"  # 中景
    mls = "MLS"  # 中远景
    ls = "LS"  # 远景
    els = "ELS"  # 大远景


class CameraAngle(str, Enum):
    """机位角度（与 `app.schemas.skills.common.CameraAngle` 对齐，存英文 code）。"""

    eye_level = "EYE_LEVEL"  # 平视
    high_angle = "HIGH_ANGLE"  # 高角度
    low_angle = "LOW_ANGLE"  # 低角度
    bird_eye = "BIRD_EYE"  # 鸟瞰
    dutch = "DUTCH"  # 荷兰式
    over_shoulder = "OVER_SHOULDER"  # 过肩


class CameraMovement(str, Enum):
    """运镜方式（与 `app.schemas.skills.common.CameraMovement` 对齐，存英文 code）。"""

    static = "STATIC"  # 静止
    pan = "PAN"  # 平移
    tilt = "TILT"  # 倾斜
    dolly_in = "DOLLY_IN"  # 拉近
    dolly_out = "DOLLY_OUT"  # 拉远
    track = "TRACK"  # 轨道
    crane = "CRANE"  # 摇臂
    handheld = "HANDHELD"  # 手持
    steadicam = "STEADICAM"  # 稳定器
    zoom_in = "ZOOM_IN"
    zoom_out = "ZOOM_OUT"  # 拉近


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


class ShotFrameType(str, Enum):
    """镜头分镜帧类型：首帧/尾帧/关键帧。"""

    first = "first"
    last = "last"
    key = "key"


class FileType(str, Enum):
    """文件类型（用于素材库与时间线引用）。"""

    image = "image"
    video = "video"


class FileUsageKind(str, Enum):
    """文件在项目业务链上的用途（file_usages.usage_kind）。"""

    shot_frame = "shot_frame"
    generated_video = "generated_video"
    character_image = "character_image"
    asset_image = "asset_image"
    task_link = "task_link"
    upload = "upload"
    api = "api"


class TimelineClipType(str, Enum):
    """时间线片段类型（视频/音频）。"""

    video = "video"
    audio = "audio"


class DialogueLineMode(str, Enum):
    """对白模式（与 `app.schemas.skills.common.DialogueLineMode` 对齐，存英文 code）。"""

    dialogue = "DIALOGUE"  # 对白
    voice_over = "VOICE_OVER"  # 旁白
    off_screen = "OFF_SCREEN"  # 画外音
    phone = "PHONE"  # 电话声


class VFXType(str, Enum):
    """视效类型（与 `app.schemas.skills.common.VFXType` 对齐，存英文 code）。"""

    none = "NONE"  # 无
    particles = "PARTICLES"  # 粒子
    volumetric_fog = "VOLUMETRIC_FOG"  # 体积雾
    cg_double = "CG_DOUBLE"  # 数字替身
    digital_environment = "DIGITAL_ENVIRONMENT"  # 数字场景
    matte_painting = "MATTE_PAINTING"  # 绘景
    fire_smoke = "FIRE_SMOKE"  # 烟火
    water_sim = "WATER_SIM"  # 水效
    destruction = "DESTRUCTION"  # 破碎/解算
    energy_magic = "ENERGY_MAGIC"  # 能量/魔法
    compositing_cleanup = "COMPOSITING_CLEANUP"  # 合成/修脏
    slow_motion_time = "SLOW_MOTION_TIME"  # 升格/慢动作
    other = "OTHER"  # 其他


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
    character_image_front = "character_image_front"
    character_image_other = "character_image_other"
    actor_image = "actor_image"
    prop_image_front = "prop_image_front"
    prop_image_other = "prop_image_other"
    scene_image_front = "scene_image_front"
    scene_image_other = "scene_image_other"
    costume_image_front = "costume_image_front"
    costume_image_other = "costume_image_other"
    combined = "combined"
