"""EpisodePackage v1.1 测试：版本分派、时长派生、字幕、市场事实、叠加时间、供应商中立性。

全部离线、确定性。既有 v1 样本与 v1 测试保持不变。
"""

from __future__ import annotations

import copy
import json
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.crypto_animal_studio.application.hashing import canonical_payload_hash
from app.crypto_animal_studio.application.parsing import (
    UnsupportedSchemaVersionError,
    parse_episode_package,
)
from app.crypto_animal_studio.application.validation import (
    PUBLISH_MAX_TOTAL_MS,
    SHOT_ASSOCIATION_TOLERANCE_MS,
    ValidationStage,
    derived_runtime_for,
    validate_episode_package,
)
from app.crypto_animal_studio.domain import market_facts, provider_safety
from app.crypto_animal_studio.domain.episode_package import SUPPORTED_SCHEMA_VERSIONS
from app.crypto_animal_studio.domain.runtime import derive_runtime, round_half_up, seconds_to_ms
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage, EpisodePackageV11

_REPO_ROOT = Path(__file__).resolve().parents[2]
_V1_SAMPLE = _REPO_ROOT / "samples" / "cas" / "demo_episode.json"
_V11_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "cas" / "ep001_shaped_v11.json"


def _v1() -> dict:
    return json.loads(_V1_SAMPLE.read_text(encoding="utf-8"))


def _v11() -> dict:
    return json.loads(_V11_FIXTURE.read_text(encoding="utf-8"))


def _validate(data: dict, stage: ValidationStage):
    return validate_episode_package(parse_episode_package(data), stage=stage)


# --------------------------------------------------------------------- #
# 版本兼容
# --------------------------------------------------------------------- #
def test_supported_versions_are_explicit() -> None:
    assert SUPPORTED_SCHEMA_VERSIONS == frozenset({"1.0", "1.1"})


def test_v1_sample_still_parses_and_is_v1_model() -> None:
    package = parse_episode_package(_v1())
    assert isinstance(package, EpisodePackage)
    assert not isinstance(package, EpisodePackageV11)
    assert package.schema_version == "1.0"


def test_v1_payload_hash_unchanged_under_new_parser() -> None:
    """v1 文档的规范化哈希不因新解析器而改变（与直接用 v1 模型一致）。"""
    data = _v1()
    assert canonical_payload_hash(parse_episode_package(data)) == canonical_payload_hash(
        EpisodePackage.model_validate(data)
    )


def test_no_silent_version_upgrade() -> None:
    """读取 v1 不会把 schema_version 改写为 1.1，也不会注入新可选对象。"""
    package = parse_episode_package(_v1())
    dumped = package.model_dump(mode="json")
    assert dumped["schema_version"] == "1.0"
    for key in ("output", "localization", "fact_card", "market_data", "references", "post_production"):
        assert key not in dumped


def test_full_v11_package_parses() -> None:
    package = parse_episode_package(_v11())
    assert isinstance(package, EpisodePackageV11)
    assert package.output is not None and package.localization is not None


def test_v11_with_all_optional_objects_omitted_parses() -> None:
    data = _v11()
    for key in ("output", "localization", "fact_card", "market_data", "references", "post_production"):
        data.pop(key, None)
    package = parse_episode_package(data)
    assert isinstance(package, EpisodePackageV11)
    assert package.output is None and package.fact_card is None


def test_missing_version_keeps_existing_missing_field_error() -> None:
    data = _v1()
    data.pop("schema_version")
    with pytest.raises(ValidationError) as info:
        parse_episode_package(data)
    assert any(err["loc"] == ("schema_version",) and err["type"] == "missing" for err in info.value.errors())


def test_unknown_version_fails_explicitly() -> None:
    data = _v1()
    data["schema_version"] = "2.0"
    with pytest.raises(UnsupportedSchemaVersionError):
        parse_episode_package(data)


def test_v11_payload_rejected_by_v1_model() -> None:
    """v1 模型不接受 1.1（显式分派，不会"意外"同时接受两个版本）。"""
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(_v11())


def test_extra_fields_still_forbidden_in_v11() -> None:
    data = _v11()
    data["surprise"] = 1
    with pytest.raises(ValidationError):
        parse_episode_package(data)


# --------------------------------------------------------------------- #
# 时长派生与断言
# --------------------------------------------------------------------- #
def test_round_half_up_boundaries() -> None:
    assert round_half_up(Decimal("0.5")) == 1
    assert round_half_up(Decimal("1.5")) == 2  # 银行家取整会得到 2 -> 这里也是 2
    assert round_half_up(Decimal("2.5")) == 3  # 银行家取整会得到 2，本实现必须为 3
    assert round_half_up(Decimal("-2.5")) == -3
    assert seconds_to_ms(3.0005) == 3001
    assert seconds_to_ms(2.9995) == 3000


def test_ep001_shaped_runtime_is_24000() -> None:
    package = parse_episode_package(_v11())
    runtime = derived_runtime_for(package)
    assert runtime.per_shot_ms == (3000, 7000, 6500, 4500)
    assert runtime.generated_ms == 21000
    assert runtime.fact_card_ms == 3000
    assert runtime.total_ms == 24000


def test_non_appended_fact_card_does_not_extend_runtime() -> None:
    data = _v11()
    data["fact_card"]["placement"] = "overlay_tail"
    runtime = derived_runtime_for(parse_episode_package(data))
    assert runtime.fact_card_ms == 0
    assert runtime.total_ms == runtime.generated_ms == 21000


def test_assertion_mismatch_exactly_50ms_passes() -> None:
    data = _v11()
    data["output"]["total_runtime_ms"] = 24050
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "runtime_assertion_mismatch" not in result.codes()


def test_assertion_mismatch_51ms_fails() -> None:
    data = _v11()
    data["output"]["total_runtime_ms"] = 24051
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "runtime_assertion_mismatch" in {issue.code for issue in result.errors}


def test_target_duration_mismatch_is_warning_only() -> None:
    data = _v11()
    data["creative_direction"]["target_duration_seconds"] = 30
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "target_duration_mismatch" in {issue.code for issue in result.warnings}
    assert "target_duration_mismatch" not in {issue.code for issue in result.errors}


def test_fixture_passes_all_stages() -> None:
    for stage in ValidationStage:
        result = _validate(_v11(), stage)
        assert result.ok, f"{stage}: {[(i.code, i.field_path) for i in result.errors]}"


# --------------------------------------------------------------------- #
# 传统 v1 不因缺少新对象而失败
# --------------------------------------------------------------------- #
def test_legacy_v1_passes_stages_without_new_objects() -> None:
    """v1 包不因缺少 localization/字幕/fact card/market_data/references/post_production 而失败。"""
    for stage in (
        ValidationStage.design,
        ValidationStage.pre_render_data_lock,
        ValidationStage.provider_input,
        ValidationStage.post_production,
    ):
        result = _validate(_v1(), stage)
        assert result.ok, f"{stage}: {[(i.code, i.field_path) for i in result.errors]}"


def test_legacy_v1_publish_only_flags_runtime_not_missing_objects() -> None:
    """v1 样本总时长 39s，publish 只应因 15–30s 规则失败，而非因缺少新对象失败。"""
    result = _validate(_v1(), ValidationStage.publish)
    codes = {issue.code for issue in result.errors}
    assert codes == {"runtime_out_of_publish_range"}, codes


# --------------------------------------------------------------------- #
# 字幕
# --------------------------------------------------------------------- #
def test_v11_without_required_language_needs_no_track() -> None:
    data = _v11()
    data["localization"] = {"spoken_language": "en", "required_publish_language_tags": [], "subtitle_tracks": []}
    result = _validate(data, ValidationStage.publish)
    assert result.ok, [(i.code, i.field_path) for i in result.errors]


def test_missing_required_track_fails_post_production_and_publish() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"] = []
    for stage in (ValidationStage.post_production, ValidationStage.publish):
        result = _validate(data, stage)
        assert "missing_required_subtitle_track" in {i.code for i in result.errors}
    # 设计阶段允许（尚在编写）
    assert _validate(data, ValidationStage.design).ok


def test_empty_required_track_passes_design_fails_post_production() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["cues"] = []
    assert _validate(data, ValidationStage.design).ok
    codes = {i.code for i in _validate(data, ValidationStage.post_production).errors}
    assert "empty_subtitle_track" in codes or "empty_required_subtitle_track" in codes


def test_no_locale_fallback_zh_does_not_satisfy_zh_hant() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["language_tag"] = "zh"
    result = _validate(data, ValidationStage.post_production)
    assert "missing_required_subtitle_track" in {i.code for i in result.errors}


def test_zero_length_cue_rejected_by_schema() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["cues"][0]["end_ms"] = data["localization"]["subtitle_tracks"][0][
        "cues"
    ][0]["start_ms"]
    with pytest.raises(ValidationError):
        parse_episode_package(data)


def test_negative_cue_start_rejected_by_schema() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["cues"][0]["start_ms"] = -1
    with pytest.raises(ValidationError):
        parse_episode_package(data)


def test_cue_beyond_runtime_fails() -> None:
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["cues"][-1]["end_ms"] = 24001
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "cue_out_of_runtime" in {i.code for i in result.errors}


def test_cue_ending_exactly_at_total_runtime_passes() -> None:
    data = _v11()
    cue = data["localization"]["subtitle_tracks"][0]["cues"][-1]
    cue["shot_id"] = None  # 落在 fact card 区间，不再关联镜头
    cue["start_ms"] = 23000
    cue["end_ms"] = 24000
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "cue_out_of_runtime" not in {i.code for i in result.errors}


def test_cue_overlap_within_track_fails() -> None:
    data = _v11()
    cues = data["localization"]["subtitle_tracks"][0]["cues"]
    cues[1]["start_ms"] = cues[0]["end_ms"] - 10
    cues[1]["shot_id"] = None
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "cue_overlap" in {i.code for i in result.errors}


def test_invalid_language_tag_shape_fails_design() -> None:
    data = _v11()
    data["localization"]["required_publish_language_tags"] = ["zz--bad"]
    result = _validate(data, ValidationStage.design)
    assert "invalid_language_tag" in {i.code for i in result.errors}


def test_language_tag_shapes_accepted() -> None:
    for tag in ("en", "zh-Hant", "zh-Hant-TW", "de-DE"):
        assert market_facts.is_valid_language_tag(tag), tag
    for tag in ("", "e", "toolongtag", "zh_Hant"):
        assert not market_facts.is_valid_language_tag(tag), tag


# --------------------------------------------------------------------- #
# 市场事实
# --------------------------------------------------------------------- #
def test_design_stage_allows_placeholders() -> None:
    data = _v11()
    data["market_data"]["resistance_level"] = "{{RESISTANCE_LEVEL}}"
    data["market_data"]["data_lock"] = {"status": "unresolved", "locked_at_utc": None}
    assert _validate(data, ValidationStage.design).ok


def test_locked_package_with_placeholder_fails_data_lock() -> None:
    data = _v11()
    data["market_data"]["price"] = "{{BTC_PRICE}}"
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "unresolved_placeholder" in {i.code for i in result.errors}


def test_placeholder_fails_publish_stage() -> None:
    data = _v11()
    data["fact_card"]["localized"][0]["body"][0] = "Above {{RESISTANCE_LEVEL}} is only a signal."
    result = _validate(data, ValidationStage.publish)
    assert "unresolved_placeholder" in {i.code for i in result.errors}


def test_unresolved_status_fails_data_lock() -> None:
    data = _v11()
    data["market_data"]["data_lock"]["status"] = "unresolved"
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "data_lock_required" in {i.code for i in result.errors}


@pytest.mark.parametrize("bad", ["", "   ", "NaN", "inf", "infinity", "None", "null", "TBD", "?", "abc"])
def test_invalid_market_numbers_fail(bad: str) -> None:
    data = _v11()
    data["market_data"]["price"] = bad
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert {i.code for i in result.errors} & {"unparseable_decimal", "missing_required_market_fact"}


def test_valid_decimal_percentage_timestamp_parse() -> None:
    assert market_facts.parse_decimal("$71,842.10") == Decimal("71842.10")
    assert market_facts.parse_percentage("2.4%") == Decimal("2.4")
    assert market_facts.parse_percentage("-0.8 %") == Decimal("-0.8")
    assert market_facts.parse_iso8601("2026-01-02T08:40:00Z") is not None
    assert market_facts.parse_iso8601("not-a-date") is None


def test_malformed_timestamp_fails_data_lock() -> None:
    data = _v11()
    data["market_data"]["as_of_utc"] = "2026-13-45T99:99:99Z"
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "unparseable_timestamp" in {i.code for i in result.errors}


def test_validation_does_not_mutate_source_values() -> None:
    data = _v11()
    snapshot = copy.deepcopy(data)
    _validate(data, ValidationStage.publish)
    assert data == snapshot


def test_placeholder_syntax_is_narrow() -> None:
    assert market_facts.contains_placeholder("{{X}}")
    assert not market_facts.contains_placeholder("a { brace } in prose")
    assert not market_facts.contains_placeholder("f-string like {value}")


# --------------------------------------------------------------------- #
# 叠加时间
# --------------------------------------------------------------------- #
def test_fact_card_overlay_interval_passes() -> None:
    result = _validate(_v11(), ValidationStage.post_production)
    assert "fact_card_interval_mismatch" not in {i.code for i in result.errors}


def test_fact_card_overlay_wrong_start_fails() -> None:
    data = _v11()
    for overlay in data["post_production"]["overlays"]:
        if overlay["type"] == "fact_card":
            overlay["start_ms"] = 20000
    result = _validate(data, ValidationStage.post_production)
    assert "fact_card_interval_mismatch" in {i.code for i in result.errors}


def test_overlay_beyond_runtime_fails() -> None:
    data = _v11()
    data["post_production"]["overlays"][0]["end_ms"] = 24500
    data["post_production"]["overlays"][0]["shot_id"] = None
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "overlay_out_of_runtime" in {i.code for i in result.errors}


def test_negative_overlay_start_rejected_by_schema() -> None:
    data = _v11()
    data["post_production"]["overlays"][0]["start_ms"] = -1
    with pytest.raises(ValidationError):
        parse_episode_package(data)


def test_shot_association_within_tolerance_passes() -> None:
    data = _v11()
    # SC01 窗口 [0,3000]；容差内结束
    data["post_production"]["overlays"][0]["end_ms"] = 3000 + SHOT_ASSOCIATION_TOLERANCE_MS
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "shot_association_mismatch" not in {i.code for i in result.errors}


def test_shot_association_beyond_tolerance_fails() -> None:
    data = _v11()
    data["post_production"]["overlays"][0]["end_ms"] = 3000 + SHOT_ASSOCIATION_TOLERANCE_MS + 1
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "shot_association_mismatch" in {i.code for i in result.errors}


def test_shot_relative_offset_field_rejected() -> None:
    data = _v11()
    data["post_production"]["overlays"][0]["offset_ms"] = 100
    with pytest.raises(ValidationError):
        parse_episode_package(data)


def test_unknown_overlay_reference_fails_design() -> None:
    data = _v11()
    data["shots"][0]["overlay_ids"] = ["ov_missing"]
    result = _validate(data, ValidationStage.design)
    assert "unknown_overlay_reference" in {i.code for i in result.errors}


# --------------------------------------------------------------------- #
# 供应商中立性
# --------------------------------------------------------------------- #
def test_allowed_provenance_url_and_asset_paths_pass() -> None:
    assert provider_safety.classify_string("https://example-exchange.test/markets/btc-usd") is None
    assert provider_safety.classify_string("assets/cas/bruno/front.png") is None
    assert provider_safety.classify_string("cas/bruno/identity/front") is None
    result = _validate(_v11(), ValidationStage.provider_input)
    assert "provider_neutrality_violation" not in {i.code for i in result.errors}


@pytest.mark.parametrize(
    "value,category",
    [
        ("https://api.openai.com/v1/images/generations", "provider_api_endpoint"),
        ("https://host.test/x?X-Amz-Signature=abcdef123456", "signed_or_expiring_url"),
        ("https://host.test/download?Expires=1699999999", "signed_or_expiring_url"),
        ("https://user:secretpw@host.test/asset.png", "credentials_in_url"),
        ("https://host.test/accounts/12345/generate", "account_scoped_url"),
        ("sk-abcdefghijklmnopqrstuvwxyz012345", "api_key"),
        ("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6", "bearer_token"),
        ("Authorization: Bearer xyztokenvalue", "authorization_header"),
    ],
)
def test_forbidden_url_and_secret_categories_detected(value: str, category: str) -> None:
    assert provider_safety.classify_string(value) == category


def test_forbidden_value_in_package_fails_and_does_not_echo_secret() -> None:
    data = _v11()
    secret = "sk-abcdefghijklmnopqrstuvwxyz012345"
    data["market_data"]["source_url"] = secret
    result = _validate(data, ValidationStage.provider_input)
    violations = [i for i in result.errors if i.code == "provider_neutrality_violation"]
    assert violations
    assert all(secret not in issue.message for issue in violations)
    assert any("market_data.source_url" in issue.field_path for issue in violations)


def test_provider_native_payload_key_in_freeform_metadata_fails() -> None:
    data = _v11()
    data["shots"][0]["metadata"]["provider_request"] = {"model": "x"}
    result = _validate(data, ValidationStage.design)
    assert "provider_neutrality_violation" in {i.code for i in result.errors}


# --------------------------------------------------------------------- #
# 发布闸门
# --------------------------------------------------------------------- #
def test_prohibited_phrase_fails_publish() -> None:
    data = _v11()
    data["shots"][0]["dialogue"][0]["text"] = "This is guaranteed money."
    result = _validate(data, ValidationStage.publish)
    assert "prohibited_phrase" in {i.code for i in result.errors}


def test_disclaimer_wording_not_flagged() -> None:
    """免责声明中的 "not financial advice" 与 "don't guarantee" 属合法用语。"""
    result = _validate(_v11(), ValidationStage.publish)
    assert "prohibited_phrase" not in {i.code for i in result.errors}


def test_runtime_outside_publish_range_fails() -> None:
    data = _v11()
    data["shots"][0]["duration_seconds"] = 40.0
    data["output"]["generated_footage_ms"] = None
    data["output"]["total_runtime_ms"] = None
    result = _validate(data, ValidationStage.publish)
    assert "runtime_out_of_publish_range" in {i.code for i in result.errors}
    assert derive_runtime(parse_episode_package(data).shots, None).generated_ms > PUBLISH_MAX_TOTAL_MS


def test_missing_camera_movement_fails_pre_render() -> None:
    data = _v11()
    data["shots"][0]["camera"]["movement"] = None
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "missing_camera_movement" in {i.code for i in result.errors}


def test_fixture_shape_matches_ep001_acceptance_scenarios() -> None:
    """夹具体现 EP001 验收要点（四镜、24s、9:16、zh-Hant、Milo 台词、无第五镜）。"""
    package = parse_episode_package(_v11())
    assert package.schema_version == "1.1"
    assert len(package.shots) == 4
    runtime = derived_runtime_for(package)
    assert (runtime.generated_ms, runtime.fact_card_ms, runtime.total_ms) == (21000, 3000, 24000)
    assert package.output.aspect_ratio == "9:16" and package.output.fps == 30
    assert package.output.width == 1080 and package.output.height == 1920
    assert package.localization.spoken_language == "en"
    assert package.localization.required_publish_language_tags == ["zh-Hant"]
    track = package.localization.subtitle_tracks[0]
    assert track.language_tag == "zh-Hant" and len(track.cues) == 4
    final_line = package.shots[-1].dialogue[0].text
    assert final_line == "Your confetti arrives before candle close."
    assert any(o.type == "notification" and not o.required for o in package.post_production.overlays)
    assert package.market_data.data_lock.status == "locked"
    assert package.references.bible_version == "1.0"
    assert all(copy_.disclaimer.strip() for copy_ in package.fact_card.localized)
    assert package.fact_card.placement == "append_after_shots"


# --------------------------------------------------------------------- #
# Step 4.5 审计新增：references 政策（规范为「镜头实际使用的角色」）
# --------------------------------------------------------------------- #
def test_partial_references_valid_when_unused_character_lacks_reference() -> None:
    """只声明、未出场的角色无需参考资产（规范只要求"每个镜头使用到的角色"可解析）。"""
    data = _v11()
    data["characters"].append(
        {
            "character_key": "fox_cameo",
            "display_name": "Unused Cameo",
            "role": "",
            "description": "declared but never used in any shot",
            "actor_key": None,
            "costume_key": None,
            "voice_profile": None,
            "continuity_notes": "",
        }
    )
    result = _validate(data, ValidationStage.provider_input)
    assert "missing_character_reference" not in {i.code for i in result.errors}
    assert result.ok, [(i.code, i.field_path) for i in result.errors]


def test_used_character_without_reference_fails_provider_input() -> None:
    """镜头使用的角色缺少参考资产 → provider_input 失败。"""
    data = _v11()
    data["references"]["characters"] = [
        item for item in data["references"]["characters"] if item["character_key"] != "milo_cat"
    ]
    result = _validate(data, ValidationStage.provider_input)
    errors = [i for i in result.errors if i.code == "missing_character_reference"]
    assert errors and any("milo_cat" in i.message for i in errors)


def test_references_absent_imposes_no_reference_requirement() -> None:
    """references 未声明 ⇒ 身份不受约束（不得因此失败）。"""
    data = _v11()
    data.pop("references")
    result = _validate(data, ValidationStage.provider_input)
    assert "missing_character_reference" not in {i.code for i in result.errors}


# --------------------------------------------------------------------- #
# Step 4.5 审计新增：此前缺少直接覆盖的生命周期规则
# --------------------------------------------------------------------- #
def test_missing_fact_card_language_fails_post_production() -> None:
    """必需发布语言缺少 fact card 文案 → post_production 失败。"""
    data = _v11()
    data["fact_card"]["localized"] = [c for c in data["fact_card"]["localized"] if c["language_tag"] != "zh-Hant"]
    result = _validate(data, ValidationStage.post_production)
    assert "missing_fact_card_language" in {i.code for i in result.errors}


def test_required_overlay_without_timing_is_unplaceable() -> None:
    """required=True 的叠加必须可放置（需给出 start/end）。"""
    data = _v11()
    for overlay in data["post_production"]["overlays"]:
        if overlay["overlay_id"] == "ov_disclaimer":
            overlay["start_ms"] = None
            overlay["end_ms"] = None
    result = _validate(data, ValidationStage.post_production)
    assert "unplaceable_overlay" in {i.code for i in result.errors}


def test_market_fact_parsing_repeated_at_publish() -> None:
    """市场事实解析在 publish 阶段（累积）仍然生效。"""
    data = _v11()
    data["market_data"]["pullback_pct"] = "not-a-number"
    result = _validate(data, ValidationStage.publish)
    assert "unparseable_percentage" in {i.code for i in result.errors}


def test_generated_footage_assertion_mismatch_fails() -> None:
    """generated_footage_ms 断言同样受 ±50 ms 约束。"""
    data = _v11()
    data["output"]["generated_footage_ms"] = 21051
    result = _validate(data, ValidationStage.pre_render_data_lock)
    assert "runtime_assertion_mismatch" in {i.code for i in result.errors}
    data["output"]["generated_footage_ms"] = 21050
    assert "runtime_assertion_mismatch" not in {i.code for i in _validate(data, ValidationStage.pre_render_data_lock).errors}


def test_cue_shot_association_tolerance_boundaries() -> None:
    """cue 与关联镜头窗口的 ±150 ms 容差：边界通过、越界失败。"""
    data = _v11()
    cue = data["localization"]["subtitle_tracks"][0]["cues"][0]  # SC01 窗口 [0,3000]
    cue["end_ms"] = 3000 + SHOT_ASSOCIATION_TOLERANCE_MS
    assert "shot_association_mismatch" not in {
        i.code for i in _validate(data, ValidationStage.pre_render_data_lock).errors
    }
    cue["end_ms"] = 3000 + SHOT_ASSOCIATION_TOLERANCE_MS + 1
    assert "shot_association_mismatch" in {
        i.code for i in _validate(data, ValidationStage.pre_render_data_lock).errors
    }


def test_duplicate_ids_fail_design() -> None:
    """cue_id / overlay_id / 字幕轨语言重复 → design 失败。"""
    data = _v11()
    data["localization"]["subtitle_tracks"][0]["cues"][1]["cue_id"] = "c1"
    assert "duplicate_cue_id" in {i.code for i in _validate(data, ValidationStage.design).errors}

    data = _v11()
    data["post_production"]["overlays"][1]["overlay_id"] = "ov_chart_label_01"
    assert "duplicate_overlay_id" in {i.code for i in _validate(data, ValidationStage.design).errors}

    data = _v11()
    track = copy.deepcopy(data["localization"]["subtitle_tracks"][0])
    data["localization"]["subtitle_tracks"].append(track)
    assert "duplicate_subtitle_track" in {i.code for i in _validate(data, ValidationStage.design).errors}


def test_unknown_reference_key_and_bad_asset_path_fail_design() -> None:
    """参考资产键必须可解析；path 必须是仓库相对路径。"""
    data = _v11()
    data["references"]["characters"][0]["character_key"] = "ghost"
    assert "unknown_reference_key" in {i.code for i in _validate(data, ValidationStage.design).errors}

    data = _v11()
    data["references"]["characters"][0]["path"] = "/etc/passwd"
    assert "invalid_asset_path" in {i.code for i in _validate(data, ValidationStage.design).errors}

    data = _v11()
    data["references"]["characters"][0]["path"] = "../secrets/key.pem"
    assert "invalid_asset_path" in {i.code for i in _validate(data, ValidationStage.design).errors}


def test_missing_reference_group_key_fails_design() -> None:
    """environments 组必须给出 scene_key。"""
    data = _v11()
    data["references"]["environments"][0]["scene_key"] = None
    assert "missing_reference_key" in {i.code for i in _validate(data, ValidationStage.design).errors}


def test_fact_card_as_shot_guard() -> None:
    """fact card 不得以镜头形式出现。"""
    data = _v11()
    data["shots"][3]["shot_id"] = "fact_card"
    data["localization"]["subtitle_tracks"][0]["cues"][3]["shot_id"] = "fact_card"
    data["post_production"]["overlays"][2]["shot_id"] = "fact_card"
    assert "fact_card_as_shot" in {i.code for i in _validate(data, ValidationStage.design).errors}


def test_invalid_aspect_ratio_fails_design() -> None:
    data = _v11()
    data["output"]["aspect_ratio"] = "vertical"
    assert "invalid_aspect_ratio" in {i.code for i in _validate(data, ValidationStage.design).errors}


def test_publish_disclaimer_enforcement_when_blank_is_impossible_by_schema() -> None:
    """免责声明结构上非空（min_length=1）；空白字符串在 schema 层即被拒绝。"""
    data = _v11()
    data["fact_card"]["localized"][0]["disclaimer"] = ""
    with pytest.raises(ValidationError):
        parse_episode_package(data)


def test_cli_routes_through_version_dispatch() -> None:
    """CLI 的显式解析已走版本分派（v1 行为不变，同时可读 v1.1）。"""
    from app.crypto_animal_studio.production import cli as production_cli

    source = Path(production_cli.__file__).read_text(encoding="utf-8")
    assert "parse_episode_package(" in source
    assert "EpisodePackage.model_validate(" not in source
