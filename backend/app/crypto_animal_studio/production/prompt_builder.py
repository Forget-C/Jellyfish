"""确定性 PromptBuilder v0（不调用任何 LLM）。

对每个 EpisodePackage 镜头生成 image_prompt / negative_prompt / video_prompt /
voice_text / subtitle_text。规则纯函数式、字段顺序固定，因此**相同 EpisodePackage 恒等产出
相同提示词**（由测试保证）。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from app.crypto_animal_studio.domain import mapping
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage, Shot

#: 全局反向提示词基线（确定性常量）。
BASE_NEGATIVE_PROMPT = "low quality, blurry, deformed, extra limbs, watermark, text overlay, logo, subtitles"


@dataclass(slots=True)
class ShotPrompts:
    """单镜头的一组确定性提示词。"""

    shot_id: str
    sequence: int
    image_prompt: str
    negative_prompt: str
    video_prompt: str
    voice_text: str
    subtitle_text: str

    def to_dict(self) -> dict:
        """转为可 JSON 序列化的 dict（写入 prompt.json）。"""
        return asdict(self)


def _character_names(package: EpisodePackage, shot: Shot) -> list[str]:
    """按镜头 character_keys 的给定顺序解析角色展示名（缺失则回退为 key）。"""
    by_key = {c.character_key: c.display_name for c in package.characters}
    return [by_key.get(key, key) for key in shot.character_keys]


def _scene_name(package: EpisodePackage, shot: Shot) -> str:
    """解析场景展示名（无场景返回空串）。"""
    if shot.scene_key is None:
        return ""
    for scene in package.assets.scenes:
        if scene.scene_key == shot.scene_key:
            return scene.display_name or scene.scene_key
    return shot.scene_key


def build_shot_prompts(package: EpisodePackage, shot: Shot) -> ShotPrompts:
    """为单个镜头构建确定性提示词。

    组装顺序固定：视觉风格 → 场景 → 角色 → 动作 → 相机 → 既有 image_prompt。
    """
    shot_type, angle, movement, _ = mapping.resolve_camera(shot.camera)
    characters = _character_names(package, shot)
    scene = _scene_name(package, shot)

    image_parts = [
        f"style: {package.creative_direction.visual_style}".strip(),
        f"scene: {scene}" if scene else "",
        f"characters: {', '.join(characters)}" if characters else "",
        f"action: {shot.action}" if shot.action else "",
        f"camera: {shot_type}/{angle}",
        shot.image_prompt,
    ]
    image_prompt = " | ".join(part for part in image_parts if part)

    negative_prompt = shot.negative_prompt or BASE_NEGATIVE_PROMPT

    video_parts = [
        f"motion: {movement}",
        f"duration: {shot.duration_seconds}s",
        f"action: {shot.action}" if shot.action else "",
        shot.video_prompt,
    ]
    video_prompt = " | ".join(part for part in video_parts if part)

    # 语音/字幕：按 order 升序拼接对白，说话人用展示名（无则用 key）
    by_key = {c.character_key: c.display_name for c in package.characters}
    dialogue_lines = [
        f"{by_key.get(line.character_key, line.character_key) if line.character_key else '—'}: {line.text}"
        for line in sorted(shot.dialogue, key=lambda d: d.order)
    ]
    voice_text = "\n".join(dialogue_lines)
    subtitle_text = "\n".join(line.text for line in sorted(shot.dialogue, key=lambda d: d.order))

    return ShotPrompts(
        shot_id=shot.shot_id,
        sequence=shot.sequence,
        image_prompt=image_prompt,
        negative_prompt=negative_prompt,
        video_prompt=video_prompt,
        voice_text=voice_text,
        subtitle_text=subtitle_text,
    )


def build_all_prompts(package: EpisodePackage) -> list[ShotPrompts]:
    """按 sequence 升序为整包构建提示词（确定性）。"""
    return [build_shot_prompts(package, shot) for shot in sorted(package.shots, key=lambda s: s.sequence)]


__all__ = ["ShotPrompts", "build_shot_prompts", "build_all_prompts", "BASE_NEGATIVE_PROMPT"]
