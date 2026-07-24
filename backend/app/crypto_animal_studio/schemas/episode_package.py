"""EpisodePackage v1 —— Creative OS(CAS) 与 Jellyfish 之间的严格契约。

用途：
- 定义 CAS 生成的「一集（Episode）」完整交付包的传输 / 校验模型。
- 该契约是 Sprint 2 的核心产物；后续 Sprint 的同步导入 service 会消费本模型，
  把一个 EpisodePackage 映射为 Jellyfish 的一个 Chapter + 若干 Shot。

设计要点：
- 所有模型 ``extra="forbid"``：拒绝未知字段，尽早暴露契约漂移。
- 字段级约束（非空 / 大于零 / 唯一序号等）尽量用 ``Field`` 表达；
  **跨字段 / 跨引用**校验统一放在根模型的 ``model_validator(mode="after")``，
  一次性收集所有错误，便于调用方定位。
- 版本号、来源类型等常量来自 ``crypto_animal_studio.domain``，不在本文件重复定义。

Pydantic：与仓库一致使用 Pydantic v2（``pydantic>=2.0``）。
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.crypto_animal_studio.domain.episode_package import (
    SCHEMA_VERSION,
    CasCameraAngle,
    CasCameraMovement,
    CasShotType,
    SourceType,
)


# --------------------------------------------------------------------------- #
# 子模型
# --------------------------------------------------------------------------- #
class NewsSource(BaseModel):
    """一集的素材来源：新闻或原创设定的事实性上下文。

    仅承载「事实/触发点」，不含创意执行；便于追溯与审核。
    """

    model_config = ConfigDict(extra="forbid")

    source_type: SourceType = Field(..., description="来源类型：news/original/fictional/generic")
    headline: str = Field("", description="标题（新闻标题或原创触发点标题）")
    summary: str = Field("", description="摘要：事件的中性概述")
    source_url: Optional[str] = Field(None, description="来源链接（可选；原创内容可为空）")
    published_at: Optional[str] = Field(None, description="发布时间（ISO-8601 字符串，可选）")
    factual_notes: str = Field("", description="事实性备注：不得改写为投资建议或价格预测")


class CreativeDirection(BaseModel):
    """一集的创意方向：格式、基调、时长目标与风格。"""

    model_config = ConfigDict(extra="forbid")

    format: str = Field("", description="内容格式（如 short_form_vertical）")
    tone: str = Field("", description="整体基调（如 deadpan、satirical）")
    target_duration_seconds: int = Field(..., gt=0, description="目标时长（秒），必须大于零")
    visual_style: str = Field("", description="视觉风格（如 anime、cel-shaded）")
    comedy_style: str = Field("", description="喜剧风格（如 false_confidence + callback）")
    continuity_notes: str = Field("", description="连续性备注：跨集/跨镜需保持的设定")


class CharacterSpec(BaseModel):
    """出场角色定义（叙事角色）。

    ``character_key`` 为本集内稳定引用键；``actor_key`` / ``costume_key`` 指向素材库
    （视觉演员 / 服装），用于 Jellyfish 侧的一致性与选角映射。
    """

    model_config = ConfigDict(extra="forbid")

    character_key: str = Field(..., min_length=1, description="角色键（本集内唯一，非空）")
    display_name: str = Field(..., min_length=1, description="展示名（如 Bull）")
    role: str = Field("", description="叙事角色定位（如 main、chaos_agent、straight_man）")
    description: str = Field("", description="角色描述")
    actor_key: Optional[str] = Field(None, description="对应 assets.actors 中的 actor_key（可选）")
    costume_key: Optional[str] = Field(None, description="对应 assets.costumes 中的 costume_key（可选）")
    voice_profile: Optional[str] = Field(None, description="声音设定（可选）")
    continuity_notes: str = Field("", description="角色连续性备注（可选）")


class ActorAsset(BaseModel):
    """视觉演员素材（跨角色/跨集可复用的视觉身份）。"""

    model_config = ConfigDict(extra="forbid")

    actor_key: str = Field(..., min_length=1, description="演员键（素材类别内唯一）")
    display_name: str = Field("", description="展示名")
    description: str = Field("", description="外观/视觉描述")


class SceneAsset(BaseModel):
    """场景素材。"""

    model_config = ConfigDict(extra="forbid")

    scene_key: str = Field(..., min_length=1, description="场景键（素材类别内唯一）")
    display_name: str = Field("", description="展示名")
    description: str = Field("", description="场景描述")


class PropAsset(BaseModel):
    """道具素材。"""

    model_config = ConfigDict(extra="forbid")

    prop_key: str = Field(..., min_length=1, description="道具键（素材类别内唯一）")
    display_name: str = Field("", description="展示名")
    description: str = Field("", description="道具描述")


class CostumeAsset(BaseModel):
    """服装素材。"""

    model_config = ConfigDict(extra="forbid")

    costume_key: str = Field(..., min_length=1, description="服装键（素材类别内唯一）")
    display_name: str = Field("", description="展示名")
    description: str = Field("", description="服装描述")


class AssetLibrary(BaseModel):
    """一集的素材库：演员 / 场景 / 道具 / 服装。"""

    model_config = ConfigDict(extra="forbid")

    actors: list[ActorAsset] = Field(default_factory=list, description="演员素材列表")
    scenes: list[SceneAsset] = Field(default_factory=list, description="场景素材列表")
    props: list[PropAsset] = Field(default_factory=list, description="道具素材列表")
    costumes: list[CostumeAsset] = Field(default_factory=list, description="服装素材列表")


class DialogueLine(BaseModel):
    """镜头内单条对白。

    ``order`` 为镜头内排序（正整数、镜头内唯一）；``character_key`` 若提供，
    必须能在 ``characters`` 中找到（根模型统一校验）。
    """

    model_config = ConfigDict(extra="forbid")

    order: int = Field(..., gt=0, description="镜头内排序（正整数，镜头内唯一）")
    character_key: Optional[str] = Field(None, description="说话角色键（可选；旁白可为空）")
    text: str = Field(..., min_length=1, description="台词正文（非空）")
    line_mode: str = Field("DIALOGUE", description="对白模式：DIALOGUE/VOICE_OVER/OFF_SCREEN/PHONE")


class CameraSpec(BaseModel):
    """镜头的结构化相机描述。

    v1.1 起将「camera 自由文本」升级为结构化对象，字段与 Jellyfish ShotDetail 的
    ``camera_shot`` / ``angle`` / ``movement`` 概念一一对应，便于导入器干净映射。
    三个字段均可选（storyboard 未指定时留空）；取值由 CAS 本地枚举校验，
    **不**从 Jellyfish ORM/枚举导入。
    """

    model_config = ConfigDict(extra="forbid")

    shot_type: Optional[CasShotType] = Field(None, description="景别（ECU/CU/MCU/MS/MLS/LS/ELS）")
    angle: Optional[CasCameraAngle] = Field(
        None, description="机位角度（EYE_LEVEL/HIGH_ANGLE/LOW_ANGLE/BIRD_EYE/DUTCH/OVER_SHOULDER）"
    )
    movement: Optional[CasCameraMovement] = Field(
        None, description="运镜（STATIC/PAN/TILT/DOLLY_IN/DOLLY_OUT/TRACK/CRANE/HANDHELD/STEADICAM/ZOOM_IN/ZOOM_OUT）"
    )


class Shot(BaseModel):
    """一个镜头（storyboard 中的 shot），直接映射为 Jellyfish 的 Shot/ShotDetail。

    说明：
    - ``camera`` 为结构化对象（``CameraSpec``），字段对齐 Jellyfish ShotDetail 的
      camera_shot/angle/movement，便于后续导入器映射；取值由 CAS 本地枚举校验。
    - ``duration_seconds`` 允许小数，必须大于零。
    """

    model_config = ConfigDict(extra="forbid")

    shot_id: str = Field(..., min_length=1, description="镜头 ID（本集内唯一，非空）")
    sequence: int = Field(..., gt=0, description="镜头顺序（正整数，本集内唯一）")
    title: str = Field("", description="镜头标题/分镜名")
    duration_seconds: float = Field(..., gt=0, description="镜头时长（秒），必须大于零")
    script_excerpt: str = Field("", description="镜头对应的剧本摘录")
    camera: Optional[CameraSpec] = Field(None, description="结构化相机描述（景别/角度/运镜，可选）")
    action: str = Field("", description="镜头内动作/视觉描述")
    dialogue: list[DialogueLine] = Field(default_factory=list, description="镜头内对白列表")
    character_keys: list[str] = Field(default_factory=list, description="出场角色键（须存在于 characters）")
    scene_key: Optional[str] = Field(None, description="场景键（可选；提供则须存在于 assets.scenes）")
    prop_keys: list[str] = Field(default_factory=list, description="道具键（须存在于 assets.props）")
    costume_keys: list[str] = Field(default_factory=list, description="服装键（须存在于 assets.costumes）")
    image_prompt: str = Field("", description="图像生成提示词")
    video_prompt: str = Field("", description="视频生成提示词")
    negative_prompt: str = Field("", description="反向提示词")
    continuity_notes: str = Field("", description="镜头连续性备注")
    metadata: dict = Field(default_factory=dict, description="镜头级附加元信息")


class EpisodeMetadata(BaseModel):
    """一集的生成元信息（用于追溯）。"""

    model_config = ConfigDict(extra="forbid")

    created_at: Optional[str] = Field(None, description="生成时间（ISO-8601 字符串，可选）")
    generator: str = Field("", description="生成器标识（如 creative-os）")
    model: str = Field("", description="所用模型标识")
    prompt_version: str = Field("", description="提示词版本")
    tags: list[str] = Field(default_factory=list, description="标签")


# --------------------------------------------------------------------------- #
# 根模型
# --------------------------------------------------------------------------- #
class EpisodePackage(BaseModel):
    """EpisodePackage v1 根对象：一集的完整交付包。

    一个 EpisodePackage 对应 Jellyfish 的一个 Chapter；其 ``shots`` 直接建立
    Jellyfish 的 Shot（不回送 ScriptDivider）。跨引用完整性由 ``_validate_cross_references``
    统一校验。
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(..., description='契约版本；v1 必须等于 "1.0"')
    episode_id: str = Field(..., min_length=1, description="一集的唯一 ID（非空）")
    title: str = Field(..., min_length=1, description="剧集标题（非空）")
    logline: str = Field("", description="一句话梗概")
    language: str = Field(..., min_length=1, description="语言（如 en、zh；非空）")
    source: NewsSource = Field(..., description="素材来源")
    creative_direction: CreativeDirection = Field(..., description="创意方向")
    characters: list[CharacterSpec] = Field(..., description="出场角色（键须唯一）")
    assets: AssetLibrary = Field(..., description="素材库")
    shots: list[Shot] = Field(..., min_length=1, description="镜头列表（至少一个）")
    metadata: EpisodeMetadata = Field(..., description="生成元信息")

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, value: str) -> str:
        """规则 1：schema_version 必须等于当前契约版本 "1.0"。"""
        if value != SCHEMA_VERSION:
            raise ValueError(f'schema_version must equal "{SCHEMA_VERSION}", got "{value}"')
        return value

    @model_validator(mode="after")
    def _validate_cross_references(self) -> "EpisodePackage":
        """跨字段 / 跨引用完整性校验（规则 7–17）。

        一次性收集所有问题并抛出，覆盖：
        - 角色键唯一（16）
        - 各素材类别内 key 唯一（17）
        - 镜头 sequence 正且唯一（7）、shot_id 唯一（8）
        - 镜头内 dialogue.order 正且唯一（10）
        - 镜头 character_keys / dialogue.character_key 必须存在于 characters（11）
        - character.actor_key / costume_key 提供时须存在于对应素材（12、15）
        - 镜头 scene_key 提供时须存在于 scenes（13）
        - 镜头 prop_keys / costume_keys 须存在于对应素材（14、15）
        """
        errors: list[str] = []

        # --- 角色键唯一 & 集合 ---
        character_keys = [c.character_key for c in self.characters]
        _collect_duplicates(character_keys, "characters[].character_key", errors)
        character_key_set = set(character_keys)

        # --- 素材键唯一 & 集合 ---
        actor_keys = [a.actor_key for a in self.assets.actors]
        scene_keys = [s.scene_key for s in self.assets.scenes]
        prop_keys = [p.prop_key for p in self.assets.props]
        costume_keys = [c.costume_key for c in self.assets.costumes]
        _collect_duplicates(actor_keys, "assets.actors[].actor_key", errors)
        _collect_duplicates(scene_keys, "assets.scenes[].scene_key", errors)
        _collect_duplicates(prop_keys, "assets.props[].prop_key", errors)
        _collect_duplicates(costume_keys, "assets.costumes[].costume_key", errors)
        actor_key_set = set(actor_keys)
        scene_key_set = set(scene_keys)
        prop_key_set = set(prop_keys)
        costume_key_set = set(costume_keys)

        # --- character 对素材的引用 ---
        for character in self.characters:
            if character.actor_key is not None and character.actor_key not in actor_key_set:
                errors.append(
                    f"character '{character.character_key}' references unknown "
                    f"actor_key '{character.actor_key}'"
                )
            if character.costume_key is not None and character.costume_key not in costume_key_set:
                errors.append(
                    f"character '{character.character_key}' references unknown "
                    f"costume_key '{character.costume_key}'"
                )

        # --- 镜头级校验 ---
        sequences = [shot.sequence for shot in self.shots]
        _collect_duplicates(sequences, "shots[].sequence", errors)
        shot_ids = [shot.shot_id for shot in self.shots]
        _collect_duplicates(shot_ids, "shots[].shot_id", errors)

        for shot in self.shots:
            where = f"shot '{shot.shot_id}'"

            # dialogue.order 正且唯一（正性已由 Field(gt=0) 保证，这里查唯一）
            _collect_duplicates(
                [line.order for line in shot.dialogue], f"{where} dialogue.order", errors
            )

            # 出场角色键须存在
            for key in shot.character_keys:
                if key not in character_key_set:
                    errors.append(f"{where} references unknown character_key '{key}'")

            # 对白说话人须存在（若提供）
            for line in shot.dialogue:
                if line.character_key is not None and line.character_key not in character_key_set:
                    errors.append(
                        f"{where} dialogue order {line.order} references unknown "
                        f"character_key '{line.character_key}'"
                    )

            # 场景 / 道具 / 服装引用
            if shot.scene_key is not None and shot.scene_key not in scene_key_set:
                errors.append(f"{where} references unknown scene_key '{shot.scene_key}'")
            for key in shot.prop_keys:
                if key not in prop_key_set:
                    errors.append(f"{where} references unknown prop_key '{key}'")
            for key in shot.costume_keys:
                if key not in costume_key_set:
                    errors.append(f"{where} references unknown costume_key '{key}'")

        if errors:
            raise ValueError("EpisodePackage cross-reference validation failed: " + "; ".join(errors))
        return self


def _collect_duplicates(values: list, where: str, errors: list[str]) -> None:
    """辅助：把 ``values`` 中的重复项以可读信息追加到 ``errors``。

    参数：
        values: 待检查的键/序号列表。
        where: 出错位置的描述（用于定位）。
        errors: 错误累积列表（就地追加）。
    """
    seen: set = set()
    dups: set = set()
    for value in values:
        if value in seen:
            dups.add(value)
        seen.add(value)
    if dups:
        rendered = ", ".join(str(d) for d in sorted(dups, key=str))
        errors.append(f"{where} contains duplicate values: {rendered}")
