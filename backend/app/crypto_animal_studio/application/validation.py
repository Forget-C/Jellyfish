"""EpisodePackage 生命周期校验（application 层）。

阶段（累积执行，后一阶段包含前面全部规则）：
``design`` → ``pre_render_data_lock`` → ``provider_input`` → ``post_production`` → ``publish``

规范：docs/crypto-animal-studio/EpisodePackage-v1.1-proposal.md §9；决策：ADR-016 §7。

要点：
- 设计阶段允许 ``{{占位符}}``；data-lock 与 publish 阶段一律拒绝。
- 时长真相唯一来自 ``domain.runtime.derive_runtime``（不在本模块重复公式）。
- 传统 v1 包不会因为「没有 localization / 字幕 / fact card / market_data / references /
  post_production」而失败。
- 错误只报告字段路径与类别，**不回显疑似机密内容**。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.crypto_animal_studio.domain import market_facts, provider_safety
from app.crypto_animal_studio.domain.runtime import (
    RUNTIME_ASSERTION_TOLERANCE_MS,
    DerivedRuntime,
    derive_runtime,
    seconds_to_ms,
)
from app.crypto_animal_studio.schemas.episode_package import EpisodePackageV11

#: 镜头关联叠加/字幕的时间容差（毫秒）。
SHOT_ASSOCIATION_TOLERANCE_MS: int = 150

#: 发布时长范围（Bible / ADR-015 的 15–30 秒规则）。
PUBLISH_MIN_TOTAL_MS: int = 15_000
PUBLISH_MAX_TOTAL_MS: int = 30_000

#: 禁用措辞。刻意只拦「承诺式」表达，并豁免否定式：
#: - ``guaranteed``：前面紧跟 ``not `` 时豁免（"not guaranteed" 合法）；
#:   裸动词 ``guarantee``（如 "don't guarantee future performance"）不视为违规；
#: - ``financial advice``：前面紧跟 ``not `` 时豁免（免责声明用语合法）。
_PROHIBITED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("guaranteed", re.compile(r"(?<!not )\bguaranteed\b", re.IGNORECASE)),
    ("risk_free", re.compile(r"\brisk[\s-]?free\b", re.IGNORECASE)),
    ("buy_now", re.compile(r"\bbuy now\b", re.IGNORECASE)),
    ("sell_now", re.compile(r"\bsell now\b", re.IGNORECASE)),
    ("price_target", re.compile(r"\bprice target\b", re.IGNORECASE)),
    ("financial_advice", re.compile(r"(?<!not )\bfinancial advice\b", re.IGNORECASE)),
)


class ValidationStage(str, Enum):
    """校验阶段。"""

    design = "design"
    pre_render_data_lock = "pre_render_data_lock"
    provider_input = "provider_input"
    post_production = "post_production"
    publish = "publish"


#: 阶段顺序（用于累积执行）。
STAGE_ORDER: tuple[ValidationStage, ...] = (
    ValidationStage.design,
    ValidationStage.pre_render_data_lock,
    ValidationStage.provider_input,
    ValidationStage.post_production,
    ValidationStage.publish,
)


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """一条校验结论。``severity`` 为 ``error`` 或 ``warning``。"""

    severity: str
    code: str
    field_path: str
    message: str


@dataclass(slots=True)
class ValidationResult:
    """某一阶段的校验结果。"""

    stage: ValidationStage
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        """全部错误。"""
        return [item for item in self.issues if item.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        """全部告警。"""
        return [item for item in self.issues if item.severity == "warning"]

    @property
    def ok(self) -> bool:
        """无错误即通过（告警不阻断）。"""
        return not self.errors

    def codes(self) -> set[str]:
        """便于测试断言的错误码集合。"""
        return {item.code for item in self.issues}


class _Collector:
    """内部收集器。"""

    def __init__(self) -> None:
        self.issues: list[ValidationIssue] = []

    def error(self, code: str, field_path: str, message: str) -> None:
        """记录一条错误。"""
        self.issues.append(ValidationIssue("error", code, field_path, message))

    def warn(self, code: str, field_path: str, message: str) -> None:
        """记录一条告警。"""
        self.issues.append(ValidationIssue("warning", code, field_path, message))


# --------------------------------------------------------------------------- #
# 公开入口
# --------------------------------------------------------------------------- #
def validate_episode_package(package: Any, *, stage: ValidationStage) -> ValidationResult:
    """按阶段校验一个**已解析**的 EpisodePackage（v1 或 v1.1）。

    参数：
        package: ``EpisodePackage`` 或 ``EpisodePackageV11`` 实例。
        stage: 目标阶段；会累积执行该阶段及其之前的全部规则。
    返回：
        ``ValidationResult``（区分 error / warning，并给出字段路径）。
    """
    collector = _Collector()
    runtime = derive_runtime(package.shots, getattr(package, "fact_card", None))
    is_v11 = isinstance(package, EpisodePackageV11)
    target_index = STAGE_ORDER.index(stage)

    _validate_design(package, is_v11, runtime, collector)
    if target_index >= STAGE_ORDER.index(ValidationStage.pre_render_data_lock):
        _validate_pre_render(package, is_v11, runtime, collector)
    if target_index >= STAGE_ORDER.index(ValidationStage.provider_input):
        _validate_provider_input(package, is_v11, collector)
    if target_index >= STAGE_ORDER.index(ValidationStage.post_production):
        _validate_post_production(package, is_v11, runtime, collector)
    if target_index >= STAGE_ORDER.index(ValidationStage.publish):
        _validate_publish(package, is_v11, runtime, collector)

    return ValidationResult(stage=stage, issues=collector.issues)


def derived_runtime_for(package: Any) -> DerivedRuntime:
    """暴露权威派生时长（供 API/CLI/测试复用，避免重复公式）。"""
    return derive_runtime(package.shots, getattr(package, "fact_card", None))


# --------------------------------------------------------------------------- #
# 阶段实现
# --------------------------------------------------------------------------- #
def _shot_windows(package: Any) -> dict[str, tuple[int, int]]:
    """按 sequence 顺序计算每个镜头的 episode-absolute 毫秒窗口。"""
    windows: dict[str, tuple[int, int]] = {}
    cursor = 0
    for shot in sorted(package.shots, key=lambda item: item.sequence):
        span = seconds_to_ms(shot.duration_seconds)
        windows[shot.shot_id] = (cursor, cursor + span)
        cursor += span
    return windows


def _validate_design(package: Any, is_v11: bool, runtime: DerivedRuntime, out: _Collector) -> None:
    """结构、ID、引用、语言标签形状、时间结构与结构性供应商中立检查。"""
    # 供应商中立性：结构上可检测的部分（v1 与 v1.1 都查）。
    for finding in provider_safety.scan(package.model_dump(mode="json")):
        out.error(
            "provider_neutrality_violation",
            finding.field_path,
            f"forbidden content category '{finding.category}' detected (value not echoed)",
        )

    if not is_v11:
        return  # v1 包没有新增对象，设计阶段无附加规则

    character_keys = {item.character_key for item in package.characters}
    scene_keys = {item.scene_key for item in package.assets.scenes}
    prop_keys = {item.prop_key for item in package.assets.props}
    shot_ids = {shot.shot_id for shot in package.shots}

    localization = package.localization
    if localization is not None:
        if localization.spoken_language is not None and not market_facts.is_valid_language_tag(
            localization.spoken_language
        ):
            out.error("invalid_language_tag", "localization.spoken_language", "not a valid BCP 47 shape")
        for index, tag in enumerate(localization.required_publish_language_tags):
            if not market_facts.is_valid_language_tag(tag):
                out.error(
                    "invalid_language_tag",
                    f"localization.required_publish_language_tags[{index}]",
                    "not a valid BCP 47 shape",
                )
        seen_tracks: set[str] = set()
        for t_index, track in enumerate(localization.subtitle_tracks):
            path = f"localization.subtitle_tracks[{t_index}]"
            if not market_facts.is_valid_language_tag(track.language_tag):
                out.error("invalid_language_tag", f"{path}.language_tag", "not a valid BCP 47 shape")
            if track.language_tag in seen_tracks:
                out.error("duplicate_subtitle_track", f"{path}.language_tag", "duplicate subtitle track language")
            seen_tracks.add(track.language_tag)
            seen_cues: set[str] = set()
            for c_index, cue in enumerate(track.cues):
                cue_path = f"{path}.cues[{c_index}]"
                if cue.cue_id in seen_cues:
                    out.error("duplicate_cue_id", f"{cue_path}.cue_id", "duplicate cue_id within track")
                seen_cues.add(cue.cue_id)
                if cue.speaker_character_key is not None and cue.speaker_character_key not in character_keys:
                    out.error(
                        "unknown_character_reference",
                        f"{cue_path}.speaker_character_key",
                        f"unknown character_key '{cue.speaker_character_key}'",
                    )
                if cue.shot_id is not None and cue.shot_id not in shot_ids:
                    out.error("unknown_shot_reference", f"{cue_path}.shot_id", f"unknown shot_id '{cue.shot_id}'")

    post = package.post_production
    overlay_ids: set[str] = set()
    if post is not None:
        for o_index, overlay in enumerate(post.overlays):
            path = f"post_production.overlays[{o_index}]"
            if overlay.overlay_id in overlay_ids:
                out.error("duplicate_overlay_id", f"{path}.overlay_id", "duplicate overlay_id")
            overlay_ids.add(overlay.overlay_id)
            if overlay.shot_id is not None and overlay.shot_id not in shot_ids:
                out.error("unknown_shot_reference", f"{path}.shot_id", f"unknown shot_id '{overlay.shot_id}'")
            for l_index, copy in enumerate(overlay.localized):
                if not market_facts.is_valid_language_tag(copy.language_tag):
                    out.error(
                        "invalid_language_tag",
                        f"{path}.localized[{l_index}].language_tag",
                        "not a valid BCP 47 shape",
                    )

    for s_index, shot in enumerate(package.shots):
        for r_index, overlay_id in enumerate(shot.overlay_ids):
            if overlay_id not in overlay_ids:
                out.error(
                    "unknown_overlay_reference",
                    f"shots[{s_index}].overlay_ids[{r_index}]",
                    f"unknown overlay_id '{overlay_id}'",
                )

    fact_card = package.fact_card
    if fact_card is not None:
        for f_index, copy in enumerate(fact_card.localized):
            if not market_facts.is_valid_language_tag(copy.language_tag):
                out.error(
                    "invalid_language_tag",
                    f"fact_card.localized[{f_index}].language_tag",
                    "not a valid BCP 47 shape",
                )
        if any(shot.shot_id.strip().lower() in {"fact_card", "factcard"} for shot in package.shots):
            out.error("fact_card_as_shot", "shots[]", "fact card must not be represented as a generated shot")

    refs = package.references
    if refs is not None:
        for group, keys, attr in (
            ("characters", character_keys, "character_key"),
            ("environments", scene_keys, "scene_key"),
            ("props", prop_keys, "prop_key"),
        ):
            for index, asset in enumerate(getattr(refs, group)):
                path = f"references.{group}[{index}]"
                key_value = getattr(asset, attr)
                if key_value is None:
                    out.error("missing_reference_key", f"{path}.{attr}", f"{attr} is required for {group} references")
                elif key_value not in keys:
                    out.error("unknown_reference_key", f"{path}.{attr}", f"unknown {attr} '{key_value}'")
                if asset.path is not None:
                    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", asset.path.strip()):
                        out.error("invalid_asset_path", f"{path}.path", "asset path must be repository-relative")
                    elif asset.path.startswith("/") or ".." in asset.path:
                        out.error("invalid_asset_path", f"{path}.path", "asset path must not be absolute or traverse")

    if package.output is not None and not re.match(r"^\d+:\d+$", package.output.aspect_ratio):
        out.error("invalid_aspect_ratio", "output.aspect_ratio", "aspect_ratio must look like W:H")

    _ = runtime  # 设计阶段不做时长断言


def _validate_pre_render(package: Any, is_v11: bool, runtime: DerivedRuntime, out: _Collector) -> None:
    """事实解析、占位符清零、时长断言、输出格式与时间有效性。"""
    if not is_v11:
        return

    dumped = package.model_dump(mode="json")

    # 占位符：规范覆盖的字段子树
    for subtree in ("market_data", "fact_card", "post_production"):
        node = dumped.get(subtree)
        if node is None:
            continue
        for path in market_facts.iter_placeholder_paths(node, subtree):
            out.error("unresolved_placeholder", path, "unresolved {{placeholder}} is not allowed at data lock")

    market = package.market_data
    if market is not None:
        if market.data_lock.status != "locked":
            out.error(
                "data_lock_required",
                "market_data.data_lock.status",
                "market-data-dependent rendering requires data_lock.status == 'locked'",
            )
        for name in ("as_of_utc", "source_name", "factual_note"):
            value = getattr(market, name)
            if value is None or market_facts.is_blank(value):
                out.error("missing_required_market_fact", f"market_data.{name}", "required and must be non-empty")
        for name in ("price", "resistance_level"):
            value = getattr(market, name)
            if value is not None and market_facts.parse_decimal(value) is None:
                out.error("unparseable_decimal", f"market_data.{name}", "not a finite decimal value")
        for name in ("price_move_pct", "pullback_pct"):
            value = getattr(market, name)
            if value is not None and market_facts.parse_percentage(value) is None:
                out.error("unparseable_percentage", f"market_data.{name}", "not a finite percentage value")
        for name in ("event_timestamp_utc", "candle_close_timestamp_utc", "as_of_utc"):
            value = getattr(market, name)
            if value is not None and market_facts.parse_iso8601(value) is None:
                out.error("unparseable_timestamp", f"market_data.{name}", "not an ISO-8601 instant")

    # 时长断言（派生值权威；恰好 50 ms 允许）
    output = package.output
    if output is not None:
        if output.generated_footage_ms is not None:
            delta = abs(output.generated_footage_ms - runtime.generated_ms)
            if delta > RUNTIME_ASSERTION_TOLERANCE_MS:
                out.error(
                    "runtime_assertion_mismatch",
                    "output.generated_footage_ms",
                    f"assertion differs from derived value by {delta} ms (> {RUNTIME_ASSERTION_TOLERANCE_MS} ms)",
                )
        if output.total_runtime_ms is not None:
            delta = abs(output.total_runtime_ms - runtime.total_ms)
            if delta > RUNTIME_ASSERTION_TOLERANCE_MS:
                out.error(
                    "runtime_assertion_mismatch",
                    "output.total_runtime_ms",
                    f"assertion differs from derived value by {delta} ms (> {RUNTIME_ASSERTION_TOLERANCE_MS} ms)",
                )

    # target_duration_seconds 只产生告警
    target_ms = package.creative_direction.target_duration_seconds * 1000
    if target_ms != runtime.total_ms:
        out.warn(
            "target_duration_mismatch",
            "creative_direction.target_duration_seconds",
            f"author intent {target_ms} ms differs from derived {runtime.total_ms} ms (non-authoritative)",
        )

    # 每个镜头必须恰好一个运镜（canonical 路径）
    for index, shot in enumerate(package.shots):
        if shot.camera is None or shot.camera.movement is None:
            out.error(
                "missing_camera_movement",
                f"shots[{index}].camera.movement",
                "canonical episodes require exactly one dominant camera movement",
            )

    _validate_timing(package, runtime, out)


def _validate_timing(package: Any, runtime: DerivedRuntime, out: _Collector) -> None:
    """字幕 cue 与叠加的 episode-absolute 时间有效性 + 镜头关联交叉检查。"""
    windows = _shot_windows(package)

    localization = package.localization
    if localization is not None:
        for t_index, track in enumerate(localization.subtitle_tracks):
            previous_end: int | None = None
            for c_index, cue in enumerate(sorted(track.cues, key=lambda item: item.start_ms)):
                path = f"localization.subtitle_tracks[{t_index}].cues[{c_index}]"
                if cue.end_ms > runtime.total_ms:
                    out.error("cue_out_of_runtime", path, f"end_ms exceeds derived_total_ms ({runtime.total_ms})")
                if previous_end is not None and cue.start_ms < previous_end:
                    out.error("cue_overlap", path, "cues within a track must not overlap")
                previous_end = cue.end_ms
                if cue.shot_id is not None and cue.shot_id in windows:
                    start, end = windows[cue.shot_id]
                    if (
                        cue.start_ms < start - SHOT_ASSOCIATION_TOLERANCE_MS
                        or cue.end_ms > end + SHOT_ASSOCIATION_TOLERANCE_MS
                    ):
                        out.error(
                            "shot_association_mismatch",
                            path,
                            f"cue falls outside shot window [{start},{end}] ±{SHOT_ASSOCIATION_TOLERANCE_MS} ms",
                        )

    post = package.post_production
    if post is not None:
        for o_index, overlay in enumerate(post.overlays):
            path = f"post_production.overlays[{o_index}]"
            if overlay.start_ms is None or overlay.end_ms is None:
                continue
            if overlay.end_ms > runtime.total_ms:
                out.error("overlay_out_of_runtime", path, f"end_ms exceeds derived_total_ms ({runtime.total_ms})")
            if overlay.shot_id is not None and overlay.shot_id in windows:
                start, end = windows[overlay.shot_id]
                if (
                    overlay.start_ms < start - SHOT_ASSOCIATION_TOLERANCE_MS
                    or overlay.end_ms > end + SHOT_ASSOCIATION_TOLERANCE_MS
                ):
                    out.error(
                        "shot_association_mismatch",
                        path,
                        f"overlay falls outside shot window [{start},{end}] ±{SHOT_ASSOCIATION_TOLERANCE_MS} ms",
                    )


def _validate_provider_input(package: Any, is_v11: bool, out: _Collector) -> None:
    """生成输入与参考资产可解析；再次确认无禁止 URL/凭证（不发起任何网络请求）。"""
    for finding in provider_safety.scan(package.model_dump(mode="json")):
        out.error(
            "provider_neutrality_violation",
            finding.field_path,
            f"forbidden content category '{finding.category}' detected (value not echoed)",
        )
    if not is_v11:
        return

    refs = package.references
    if refs is not None:
        # 规范（§9.3 Provider-input）："resolvable references for every character **it uses**"。
        # 因此只要求**被镜头实际使用**的角色可解析；仅声明而未出场的角色不作要求。
        referenced = {item.character_key for item in refs.characters if item.character_key}
        for s_index, shot in enumerate(package.shots):
            for c_index, key in enumerate(shot.character_keys):
                if key not in referenced:
                    out.error(
                        "missing_character_reference",
                        f"shots[{s_index}].character_keys[{c_index}]",
                        f"no reference asset declared for character '{key}' used by this shot",
                    )
    for index, shot in enumerate(package.shots):
        if not shot.beginning_state.strip() or not shot.ending_state.strip():
            out.warn(
                "missing_shot_state",
                f"shots[{index}]",
                "beginning_state/ending_state recommended for generation input",
            )


def _validate_post_production(package: Any, is_v11: bool, runtime: DerivedRuntime, out: _Collector) -> None:
    """必需字幕语言、非空轨、可放置的必需叠加、fact card 起点与免责声明。"""
    if not is_v11:
        return

    localization = package.localization
    required_tags: list[str] = list(localization.required_publish_language_tags) if localization else []
    tracks = {track.language_tag: track for track in (localization.subtitle_tracks if localization else [])}

    # 声明即承诺：任何已声明的轨都不能为空
    if localization is not None:
        for t_index, track in enumerate(localization.subtitle_tracks):
            if not track.cues or all(not cue.text.strip() for cue in track.cues):
                out.error(
                    "empty_subtitle_track",
                    f"localization.subtitle_tracks[{t_index}].cues",
                    "declared subtitle track must contain at least one non-empty cue",
                )

    for index, tag in enumerate(required_tags):
        track = tracks.get(tag)  # 精确匹配，不做 locale 回落
        if track is None:
            out.error(
                "missing_required_subtitle_track",
                f"localization.required_publish_language_tags[{index}]",
                f"no subtitle track for required publish language '{tag}'",
            )
        elif not track.cues or all(not cue.text.strip() for cue in track.cues):
            out.error(
                "empty_required_subtitle_track",
                f"localization.subtitle_tracks[{tag}].cues",
                f"required publish language '{tag}' has no non-empty cue",
            )

    post = package.post_production
    if post is not None:
        for o_index, overlay in enumerate(post.overlays):
            path = f"post_production.overlays[{o_index}]"
            if overlay.required and (overlay.start_ms is None or overlay.end_ms is None):
                out.error("unplaceable_overlay", path, "required overlay must declare start_ms and end_ms")
            if overlay.type == "fact_card" and overlay.start_ms is not None:
                if package.fact_card is not None and package.fact_card.placement == "append_after_shots":
                    if overlay.start_ms != runtime.generated_ms:
                        out.error(
                            "fact_card_interval_mismatch",
                            f"{path}.start_ms",
                            f"appended fact card must begin at derived_generated_ms ({runtime.generated_ms})",
                        )

    fact_card = package.fact_card
    if fact_card is not None:
        for tag in required_tags:
            if not any(copy.language_tag == tag for copy in fact_card.localized):
                out.error(
                    "missing_fact_card_language",
                    "fact_card.localized",
                    f"no fact card copy for required publish language '{tag}'",
                )


def _validate_publish(package: Any, is_v11: bool, runtime: DerivedRuntime, out: _Collector) -> None:
    """发布闸门：占位符复检、禁用措辞、免责声明与 15–30 秒时长。"""
    if not (PUBLISH_MIN_TOTAL_MS <= runtime.total_ms <= PUBLISH_MAX_TOTAL_MS):
        out.error(
            "runtime_out_of_publish_range",
            "shots[].duration_seconds",
            f"derived_total_ms {runtime.total_ms} outside {PUBLISH_MIN_TOTAL_MS}-{PUBLISH_MAX_TOTAL_MS} ms",
        )

    dumped = package.model_dump(mode="json")

    # 占位符全文复检（data-lock 不被视为永久保证）
    for path in market_facts.iter_placeholder_paths(dumped):
        out.error("unresolved_placeholder", path, "unresolved {{placeholder}} is not allowed at publish")

    # 禁用措辞：对白 + 事实备注 + 卡面正文 + 叠加文案（免责声明字段本身豁免）
    texts: list[tuple[str, str]] = []
    for s_index, shot in enumerate(package.shots):
        for d_index, line in enumerate(shot.dialogue):
            texts.append((f"shots[{s_index}].dialogue[{d_index}].text", line.text))
    if is_v11:
        market = package.market_data
        if market is not None and market.factual_note:
            texts.append(("market_data.factual_note", market.factual_note))
        if package.fact_card is not None:
            for f_index, copy in enumerate(package.fact_card.localized):
                for b_index, body in enumerate(copy.body):
                    texts.append((f"fact_card.localized[{f_index}].body[{b_index}]", body))
        if package.post_production is not None:
            for o_index, overlay in enumerate(package.post_production.overlays):
                for l_index, copy in enumerate(overlay.localized):
                    texts.append((f"post_production.overlays[{o_index}].localized[{l_index}].text", copy.text))

    for path, text in texts:
        for code, pattern in _PROHIBITED_PATTERNS:
            if pattern.search(text):
                out.error("prohibited_phrase", path, f"prohibited phrasing category '{code}'")

    if is_v11:
        fact_card = package.fact_card
        if fact_card is not None:
            for f_index, copy in enumerate(fact_card.localized):
                if not copy.disclaimer.strip():
                    out.error(
                        "missing_disclaimer",
                        f"fact_card.localized[{f_index}].disclaimer",
                        "disclaimer is required for every published language",
                    )


__all__ = [
    "ValidationStage",
    "ValidationIssue",
    "ValidationResult",
    "validate_episode_package",
    "derived_runtime_for",
    "STAGE_ORDER",
    "SHOT_ASSOCIATION_TOLERANCE_MS",
    "PUBLISH_MIN_TOTAL_MS",
    "PUBLISH_MAX_TOTAL_MS",
]
