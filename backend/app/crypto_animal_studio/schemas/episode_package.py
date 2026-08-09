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

from typing import ClassVar, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.crypto_animal_studio.domain.episode_package import (
    SCHEMA_VERSION,
    SCHEMA_VERSION_V1_1,
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

    #: 本模型接受的版本集合。v1 模型只接受 "1.0"；v1.1 子类覆盖为 {"1.1"}。
    #: 以显式成员判断实现版本分派，避免一个模型「意外地」同时接受两个版本。
    allowed_schema_versions: ClassVar[frozenset[str]] = frozenset({SCHEMA_VERSION})

    @field_validator("schema_version")
    @classmethod
    def _check_schema_version(cls, value: str) -> str:
        """规则 1：schema_version 必须属于本模型允许的版本集合。"""
        if value not in cls.allowed_schema_versions:
            expected = " or ".join(f'"{item}"' for item in sorted(cls.allowed_schema_versions))
            raise ValueError(f'schema_version must equal {expected}, got "{value}"')
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
        actor_key_set, scene_key_set, prop_key_set, costume_key_set = _collect_asset_key_sets(
            self.assets, errors
        )

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


def _collect_asset_key_sets(
    assets: "AssetLibrary", errors: list[str]
) -> tuple[set[str], set[str], set[str], set[str]]:
    """辅助：校验四类素材各自的 key 唯一性（规则 17），并返回四个键集合。

    抽成模块级函数而非在校验器内内联，是为了让 ``assets`` 拥有显式的参数注解：
    astroid/pylint 依据参数注解解析 ``AssetLibrary`` 的成员，而在模型方法内直接访问
    ``self.assets`` 时会把 Pydantic v2 的类属性推断为 ``FieldInfo``（误报 E1101）。
    运行时行为与内联写法完全等价。

    参数：
        assets: 待检查的素材库。
        errors: 错误累积列表（就地追加）。

    返回：
        ``(actor_keys, scene_keys, prop_keys, costume_keys)`` 四个集合。
    """
    actor_keys = [a.actor_key for a in assets.actors]
    scene_keys = [s.scene_key for s in assets.scenes]
    prop_keys = [p.prop_key for p in assets.props]
    costume_keys = [c.costume_key for c in assets.costumes]
    _collect_duplicates(actor_keys, "assets.actors[].actor_key", errors)
    _collect_duplicates(scene_keys, "assets.scenes[].scene_key", errors)
    _collect_duplicates(prop_keys, "assets.props[].prop_key", errors)
    _collect_duplicates(costume_keys, "assets.costumes[].costume_key", errors)
    return set(actor_keys), set(scene_keys), set(prop_keys), set(costume_keys)


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


# --------------------------------------------------------------------------- #
# EpisodePackage v1.1 —— 附加式扩展（全部可选）
#
# 规范：docs/crypto-animal-studio/EpisodePackage-v1.1-proposal.md
# 决策：docs/adr/ADR-016-episode-package-v1-1.md（Status: Proposed）
#
# 纪律：
# - v1 模型与字段一律不改名、不改类型、不改语义；
# - 新增字段全部可选，因此 "1.0" 文档在 v1.1 解析器下依然有效；
# - 不新增第二个连续性字段（沿用 ``shots[].continuity_notes``）；
# - 不新增第二个运镜字段（沿用 ``shots[].camera.movement``）；
# - 不引入镜头相对时间（overlay/cue 一律 episode-absolute 毫秒）；
# - 不引入任何供应商执行字段。
# --------------------------------------------------------------------------- #
class SafeArea(BaseModel):
    """安全区元数据（百分比）。"""

    model_config = ConfigDict(extra="forbid")

    subtitle_bottom_pct: float = Field(18, ge=0, le=50, description="字幕安全带（画面底部百分比）")
    margin_pct: float = Field(6, ge=0, le=25, description="通用安全边距（百分比）")


class OutputSpec(BaseModel):
    """输出规格；``*_ms`` 断言永不覆盖派生时长。"""

    model_config = ConfigDict(extra="forbid")

    aspect_ratio: str = Field("9:16", description="画面比例，形如 W:H")
    width: int = Field(1080, gt=0, description="渲染宽度（像素）")
    height: int = Field(1920, gt=0, description="渲染高度（像素）")
    fps: int = Field(30, gt=0, description="帧率")
    orientation: Literal["vertical", "horizontal", "square"] = Field("vertical", description="画面方向")
    generated_footage_ms: Optional[int] = Field(None, ge=0, description="生成footage总毫秒（可选断言）")
    total_runtime_ms: Optional[int] = Field(None, gt=0, description="最终成片总毫秒（可选断言）")
    safe_area: SafeArea = Field(default_factory=SafeArea, description="安全区元数据")


class SubtitleCue(BaseModel):
    """字幕单条 cue；时间为 episode-absolute 整数毫秒。"""

    model_config = ConfigDict(extra="forbid")

    cue_id: str = Field(..., min_length=1, description="cue 稳定 ID（轨内唯一）")
    start_ms: int = Field(..., ge=0, description="入点（episode-absolute 毫秒）")
    end_ms: int = Field(..., gt=0, description="出点（必须大于 start_ms）")
    text: str = Field(..., min_length=1, description="译文（非空）")
    speaker_character_key: Optional[str] = Field(None, description="说话角色键（须存在于 characters）")
    shot_id: Optional[str] = Field(None, description="关联镜头（仅关联，不构成第二套时间真相）")

    @model_validator(mode="after")
    def _check_span(self) -> "SubtitleCue":
        """cue 时长必须为正（禁止零长度/负长度）。"""
        if self.end_ms <= self.start_ms:
            raise ValueError(f"cue '{self.cue_id}': end_ms must be greater than start_ms")
        return self


class SubtitleTrack(BaseModel):
    """一条字幕轨。渲染默认属于后期，不进入 AI 生成。"""

    model_config = ConfigDict(extra="forbid")

    language_tag: str = Field(..., min_length=1, description="BCP 47 语言标签，如 zh-Hant")
    is_primary: bool = Field(False, description="是否为主轨")
    rendering: Literal["post_production", "burned_in", "sidecar"] = Field(
        "post_production", description="渲染方式（声明性；默认后期）"
    )
    cues: list[SubtitleCue] = Field(..., description="cue 列表（可为空，但后期阶段起视为无效）")


class Localization(BaseModel):
    """口语与字幕本地化。字幕结构上可选；必需语言只来自 required_publish_language_tags。"""

    model_config = ConfigDict(extra="forbid")

    spoken_language: Optional[str] = Field(None, description="对白语言（缺省回落到根 language）")
    required_publish_language_tags: list[str] = Field(
        default_factory=list, description="发布前必须具备字幕的语言标签；空表示无要求"
    )
    subtitle_tracks: list[SubtitleTrack] = Field(default_factory=list, description="字幕轨列表")


class FactCardLocalizedCopy(BaseModel):
    """fact card 的单语言文案。"""

    model_config = ConfigDict(extra="forbid")

    language_tag: str = Field(..., min_length=1, description="BCP 47 语言标签")
    body: list[str] = Field(..., description="教育性正文行（每行非空）")
    disclaimer: str = Field(..., min_length=1, description="免责声明（非空）")
    cta: Optional[str] = Field(None, description="可选 CTA")

    @model_validator(mode="after")
    def _check_body(self) -> "FactCardLocalizedCopy":
        """正文行必须存在且非空白。"""
        if not self.body or any(not line.strip() for line in self.body):
            raise ValueError(f"fact_card localized '{self.language_tag}': body lines must be non-empty")
        return self


class FactCard(BaseModel):
    """后期 fact card；**永远不是第五个生成镜头**。"""

    model_config = ConfigDict(extra="forbid")

    duration_ms: int = Field(..., gt=0, description="卡片时长（毫秒）")
    placement: Literal["append_after_shots", "overlay_tail"] = Field(
        "append_after_shots", description="追加式才计入总时长"
    )
    readable_text_in_post: Literal[True] = Field(True, description="卡面文字一律后期合成")
    localized: list[FactCardLocalizedCopy] = Field(..., min_length=1, description="各语言文案")


class DataLock(BaseModel):
    """市场数据锁定状态。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["unresolved", "locked"] = Field("unresolved", description="锁定状态")
    locked_at_utc: Optional[str] = Field(None, description="锁定时间（ISO-8601）")


class MarketData(BaseModel):
    """市场事实溯源。数值刻意为「可含占位符的字符串」（最小化 v1.1 折衷）。"""

    model_config = ConfigDict(extra="forbid")

    instrument: str = Field(..., min_length=1, description="标的，如 BTC-USD")
    timeframe: str = Field(..., min_length=1, description="确认所用周期，如 4h")
    resistance_level: Optional[str] = Field(None, description="被突破的阻力位")
    price: Optional[str] = Field(None, description="事件时价格")
    price_move_pct: Optional[str] = Field(None, description="区间涨跌幅")
    pullback_pct: Optional[str] = Field(None, description="回撤幅度")
    event_timestamp_utc: Optional[str] = Field(None, description="事件时间")
    candle_close_timestamp_utc: Optional[str] = Field(None, description="确认K棒收盘时间")
    as_of_utc: Optional[str] = Field(None, description="数据 as-of 时间")
    source_name: Optional[str] = Field(None, description="数据来源名称")
    source_url: Optional[str] = Field(None, description="公开溯源 URL（仅证据，非执行端点）")
    factual_note: Optional[str] = Field(None, description="人工核对备注")
    ath_context: Optional[str] = Field(None, description="可选前高背景")
    data_lock: DataLock = Field(default_factory=DataLock, description="锁定状态")


class ReferenceAsset(BaseModel):
    """一条参考资产：稳定 asset_id + 可选仓库相对路径（禁止供应商 URL）。"""

    model_config = ConfigDict(extra="forbid")

    character_key: Optional[str] = Field(None, description="角色键（角色参考用）")
    scene_key: Optional[str] = Field(None, description="场景键（环境参考用）")
    prop_key: Optional[str] = Field(None, description="道具键（道具参考用）")
    asset_id: str = Field(..., min_length=1, description="稳定不透明资产 ID")
    kind: Literal["identity", "episode"] = Field("identity", description="不可变身份参考 vs 本集专用")
    view: Optional[str] = Field(None, description="视角提示，如 front")
    path: Optional[str] = Field(None, description="仓库相对路径；**不得**为供应商 URL")


class References(BaseModel):
    """Bible 版本与参考资产集合。"""

    model_config = ConfigDict(extra="forbid")

    bible_version: Optional[str] = Field(None, description="Bible 版本，如 1.0")
    canon_decision: Optional[str] = Field(None, description="治理决策，如 ADR-015")
    characters: list[ReferenceAsset] = Field(default_factory=list, description="角色参考")
    environments: list[ReferenceAsset] = Field(default_factory=list, description="环境参考")
    props: list[ReferenceAsset] = Field(default_factory=list, description="道具参考")


class OverlayLocalizedText(BaseModel):
    """叠加图形的单语言文案。"""

    model_config = ConfigDict(extra="forbid")

    language_tag: str = Field(..., min_length=1, description="BCP 47 语言标签")
    text: str = Field(..., description="文案")


class PostProductionOverlay(BaseModel):
    """后期叠加图形；时间为 episode-absolute 毫秒，shot_id 仅作关联。"""

    model_config = ConfigDict(extra="forbid")

    overlay_id: str = Field(..., min_length=1, description="稳定 ID（被 shots[].overlay_ids 引用）")
    type: Literal["chart_label", "subtitle", "notification", "fact_card", "disclaimer", "cta", "other"] = Field(
        ..., description="叠加类型"
    )
    shot_id: Optional[str] = Field(None, description="关联镜头（null 表示 episode 级）")
    start_ms: Optional[int] = Field(None, ge=0, description="入点（episode-absolute 毫秒）")
    end_ms: Optional[int] = Field(None, gt=0, description="出点（episode-absolute 毫秒）")
    required: bool = Field(True, description="是否必需（可选叠加允许省略）")
    anchor: Literal["lower_safe", "upper_safe", "centre", "prop_local"] = Field(
        "lower_safe", description="安全区锚点"
    )
    localized: list[OverlayLocalizedText] = Field(default_factory=list, description="各语言文案")

    @model_validator(mode="after")
    def _check_span(self) -> "PostProductionOverlay":
        """两端同时给出时，出点必须大于入点。"""
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError(f"overlay '{self.overlay_id}': end_ms must be greater than start_ms")
        return self


class PostProduction(BaseModel):
    """后期叠加计划：所有可读金融文字都在这里，不进入生成画面。"""

    model_config = ConfigDict(extra="forbid")

    overlays: list[PostProductionOverlay] = Field(default_factory=list, description="叠加列表")


class RegenerationFallback(BaseModel):
    """重生成兜底（仅恢复手段，不是同等生产选项）。"""

    model_config = ConfigDict(extra="forbid")

    camera_movement: Optional[CasCameraMovement] = Field(None, description="兜底运镜（复用既有枚举）")
    note: str = Field("", description="适用条件说明")


class ShotV11(Shot):
    """v1.1 镜头：在 v1 ``Shot`` 之上仅新增五个可选字段。

    刻意不新增：连续性字段（用 ``continuity_notes``）、运镜字段（用 ``camera.movement``）、
    任何镜头相对时间字段。
    """

    beginning_state: str = Field("", description="起始状态（生成用）")
    ending_state: str = Field("", description="结束状态（生成用）")
    generation_risks: list[str] = Field(default_factory=list, description="已知生成风险")
    regeneration_fallback: Optional[RegenerationFallback] = Field(None, description="仅恢复用兜底方案")
    overlay_ids: list[str] = Field(default_factory=list, description="关联的后期叠加 ID")


class EpisodePackageV11(EpisodePackage):
    """EpisodePackage v1.1 根对象：v1 全部字段 + 六个可选顶层对象；shots 使用 ShotV11。"""

    allowed_schema_versions: ClassVar[frozenset[str]] = frozenset({SCHEMA_VERSION_V1_1})

    shots: list[ShotV11] = Field(..., min_length=1, description="镜头列表（至少一个）")

    output: Optional[OutputSpec] = Field(None, description="输出规格（缺省时用文档化默认值）")
    localization: Optional[Localization] = Field(None, description="口语与字幕")
    fact_card: Optional[FactCard] = Field(None, description="后期 fact card")
    market_data: Optional[MarketData] = Field(None, description="市场事实溯源")
    references: Optional[References] = Field(None, description="Bible 与参考资产")
    post_production: Optional[PostProduction] = Field(None, description="后期叠加计划")


#: 缺省 output（仅用于派生视图，绝不写回源文档）。
DEFAULT_OUTPUT_SPEC = OutputSpec()


# --------------------------------------------------------------------------- #
# 版本联合类型（供 API 请求模型复用）
#
# 用法：``episode_package: AnyEpisodePackage = Field(..., union_mode="left_to_right")``
#
# 为什么用 left_to_right：
# - 先尝试 ``EpisodePackageV11``（只接受 "1.1"），再回落到 ``EpisodePackage``（只接受 "1.0"）；
# - 版本选择依然由各模型的 ``allowed_schema_versions`` 单一真相决定，不重复实现分派逻辑；
# - 默认的 smart union 会因为 V11 是 EpisodePackage 的子类而可能"降级"匹配到父类
#   （静默丢弃 v1.1 字段），left_to_right 明确避免这一点；
# - 缺失 ``schema_version`` 仍产生既有的 ``missing`` 错误；未知版本产生 422 校验错误；
# - 不改写、不升级、不修改任何 payload。
# --------------------------------------------------------------------------- #
AnyEpisodePackage = Union[EpisodePackageV11, EpisodePackage]

#: 请求模型声明该字段时应使用的 union 模式。
EPISODE_PACKAGE_UNION_MODE = "left_to_right"
