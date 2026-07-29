"""CAS 生产流水线枚举（CAS 本地定义，不复用/污染 Jellyfish 业务枚举）。"""

from __future__ import annotations

from enum import Enum


class JobStatus(str, Enum):
    """生产任务状态。"""

    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Stage(str, Enum):
    """生产阶段（按流水线顺序定义）。"""

    validate = "validate"
    prompt_build = "prompt_build"
    image_generation = "image_generation"
    video_generation = "video_generation"
    audio_generation = "audio_generation"
    subtitle_generation = "subtitle_generation"
    composition = "composition"
    finalize = "finalize"


class ArtifactType(str, Enum):
    """产物类型。"""

    prompt = "prompt"
    image = "image"
    video = "video"
    voice = "voice"
    subtitle = "subtitle"
    music = "music"
    manifest = "manifest"
    final_video = "final_video"
    log = "log"


#: 流水线阶段顺序（重试时据此判断“失败阶段及其之后”）。
STAGE_ORDER: tuple[Stage, ...] = (
    Stage.validate,
    Stage.prompt_build,
    Stage.image_generation,
    Stage.video_generation,
    Stage.audio_generation,
    Stage.subtitle_generation,
    Stage.composition,
    Stage.finalize,
)


def stage_index(stage: Stage) -> int:
    """返回阶段在流水线中的序号（用于比较先后）。"""
    return STAGE_ORDER.index(stage)


__all__ = ["JobStatus", "Stage", "ArtifactType", "STAGE_ORDER", "stage_index"]
