"""EpisodePackage → Jellyfish 的**纯映射辅助**（domain 层）。

只含确定性、无副作用的纯函数：键规范化、相机默认值解析、对白模式校验、raw_text 组装、
时长取整。不依赖 FastAPI、不依赖 ORM、不触库，便于独立单测。
"""

from __future__ import annotations

from app.crypto_animal_studio.schemas.episode_package import (
    CameraSpec,
    DialogueLine,
    EpisodePackage,
)

# 相机缺省值（EpisodePackage camera 为可选；Jellyfish ShotDetail 三字段为 NOT NULL）。
DEFAULT_SHOT_TYPE = "MS"
DEFAULT_CAMERA_ANGLE = "EYE_LEVEL"
DEFAULT_CAMERA_MOVEMENT = "STATIC"

# 合法对白模式（CAS 本地常量，对齐 Jellyfish DialogueLineMode 的 code）。
VALID_LINE_MODES = frozenset({"DIALOGUE", "VOICE_OVER", "OFF_SCREEN", "PHONE"})


def normalize_key(value: str) -> str:
    """资产键/名称规范化：trim + lowercase，得到稳定比较键。

    参数：
        value: 原始名称/键。
    返回：
        去除首尾空白并转小写后的字符串（用于重用查找与去重）。
    """
    return (value or "").strip().lower()


def resolve_camera(camera: CameraSpec | None) -> tuple[str, str, str, list[str]]:
    """把可选的 CameraSpec 解析为 Jellyfish ShotDetail 的三个 NOT NULL 相机字段。

    缺省字段用中性默认值填充，并对每个被默认的字段产生一条 warning（绝不静默丢弃）。

    返回：
        ``(camera_shot, angle, movement, warnings)``，均为 code 字符串。
    """
    warnings: list[str] = []
    shot_type = DEFAULT_SHOT_TYPE
    angle = DEFAULT_CAMERA_ANGLE
    movement = DEFAULT_CAMERA_MOVEMENT

    if camera is None:
        warnings.append("camera missing; defaulted shot_type/angle/movement")
        return shot_type, angle, movement, warnings

    if camera.shot_type is not None:
        shot_type = camera.shot_type.value
    else:
        warnings.append(f"camera.shot_type missing; defaulted to {DEFAULT_SHOT_TYPE}")
    if camera.angle is not None:
        angle = camera.angle.value
    else:
        warnings.append(f"camera.angle missing; defaulted to {DEFAULT_CAMERA_ANGLE}")
    if camera.movement is not None:
        movement = camera.movement.value
    else:
        warnings.append(f"camera.movement missing; defaulted to {DEFAULT_CAMERA_MOVEMENT}")
    return shot_type, angle, movement, warnings


def resolve_line_mode(mode: str) -> tuple[str, str | None]:
    """校验并规范化对白模式，非法值退回 DIALOGUE 并给出 warning。

    返回：
        ``(code, warning_or_none)``。
    """
    code = (mode or "DIALOGUE").strip().upper()
    if code in VALID_LINE_MODES:
        return code, None
    return "DIALOGUE", f"unknown dialogue line_mode '{mode}'; defaulted to DIALOGUE"


def round_duration(seconds: float) -> int:
    """把浮点秒时长取整为 Jellyfish ShotDetail.duration 所需的整数秒（四舍五入，至少 1）。"""
    value = int(round(seconds))
    return value if value >= 1 else 1


def assemble_raw_text(package: EpisodePackage) -> str:
    """确定性地把 EpisodePackage 组装成一段完整剧本文本，存入 Chapter.raw_text（仅供追溯）。

    算法（确定性、可复现，保留镜头顺序与可得内容）：
    1. 首行 ``# {title}``；若有 ``logline`` 追加一行。
    2. 镜头**按 sequence 升序**遍历；每镜输出一个空行分隔的小节：
       a. 头部 ``[{sequence}] {title}``；
       b. 若有 ``script_excerpt`` → 原样一行；
       c. 若有 ``action`` → ``(action) {action}`` 一行；
       d. 对白**按 order 升序**，逐行 ``{character_key or '—'}: {text}``。
    3. 各部分以换行连接，整体首尾去空白。
    仅在字段存在（非空）时输出，"where available"。不改写任何文本内容。
    """
    lines: list[str] = [f"# {package.title}".rstrip()]
    if package.logline:
        lines.append(package.logline)
    for shot in sorted(package.shots, key=lambda s: s.sequence):
        lines.append(f"\n[{shot.sequence}] {shot.title}".rstrip())
        if shot.script_excerpt:
            lines.append(shot.script_excerpt)
        if shot.action:
            lines.append(f"(action) {shot.action}")
        for line in sorted(shot.dialogue, key=lambda d: d.order):
            speaker = line.character_key or "—"
            lines.append(f"{speaker}: {line.text}")
    return "\n".join(lines).strip()


def dialogue_speaker_name(package: EpisodePackage, line: DialogueLine) -> str | None:
    """把对白的 character_key 解析为角色展示名（用于 ShotDialogLine.speaker_name 回填）。"""
    if line.character_key is None:
        return None
    for character in package.characters:
        if character.character_key == line.character_key:
            return character.display_name
    return None
