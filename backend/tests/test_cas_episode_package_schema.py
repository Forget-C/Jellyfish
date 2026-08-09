"""EpisodePackage v1 schema 校验测试。

覆盖：有效样本加载、版本号、序号/ID 唯一性、跨引用完整性、时长约束、未知字段拒绝。
不依赖 FastAPI app 或数据库；仅校验 ``crypto_animal_studio.schemas`` 契约。
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.crypto_animal_studio.schemas.episode_package import EpisodePackage

# 仓库根：tests -> backend -> <repo root>
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE_PATH = _REPO_ROOT / "docs" / "crypto-animal-studio" / "samples" / "sample-episode-package-v1.json"


def _load_sample() -> dict:
    """加载有效样本 EpisodePackage 为 dict（每次返回独立深拷贝，便于就地改造出错例）。"""
    with _SAMPLE_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def test_valid_sample_loads_successfully() -> None:
    """有效样本应通过全部校验并成功构造模型。"""
    pkg = EpisodePackage.model_validate(_load_sample())
    assert pkg.schema_version == "1.0"
    assert pkg.episode_id == "CAS-E001"
    assert len(pkg.shots) >= 3
    # 样本至少包含 3 位常驻角色
    assert {"bull", "bear", "walter"}.issubset({c.character_key for c in pkg.characters})


def test_invalid_schema_version_fails() -> None:
    """schema_version 非 "1.0" 应失败（规则 1）。"""
    data = _load_sample()
    data["schema_version"] = "2.0"
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_empty_required_field_fails() -> None:
    """必填非空字段为空应失败（规则 2/3/4）。"""
    data = _load_sample()
    data["episode_id"] = ""
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_zero_target_duration_fails() -> None:
    """creative_direction.target_duration_seconds 必须大于零（规则 5）。"""
    data = _load_sample()
    data["creative_direction"]["target_duration_seconds"] = 0
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_empty_shots_fails() -> None:
    """shots 至少一个（规则 6）。"""
    data = _load_sample()
    data["shots"] = []
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_duplicate_shot_sequence_fails() -> None:
    """镜头 sequence 必须唯一（规则 7）。"""
    data = _load_sample()
    data["shots"][1]["sequence"] = data["shots"][0]["sequence"]
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_duplicate_shot_id_fails() -> None:
    """shot_id 必须唯一（规则 8）。"""
    data = _load_sample()
    data["shots"][1]["shot_id"] = data["shots"][0]["shot_id"]
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_zero_or_negative_shot_duration_fails() -> None:
    """镜头 duration_seconds 必须大于零（规则 9）。"""
    data = _load_sample()
    data["shots"][0]["duration_seconds"] = 0
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_duplicate_dialogue_order_fails() -> None:
    """镜头内 dialogue.order 必须唯一（规则 10）。"""
    data = _load_sample()
    lines = data["shots"][0]["dialogue"]
    lines[1]["order"] = lines[0]["order"]
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_character_reference_fails() -> None:
    """镜头 character_keys 引用不存在的角色应失败（规则 11）。"""
    data = _load_sample()
    data["shots"][0]["character_keys"].append("ghost")
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_actor_reference_fails() -> None:
    """character.actor_key 引用不存在的演员应失败（规则 12）。"""
    data = _load_sample()
    data["characters"][0]["actor_key"] = "actor_missing"
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_scene_reference_fails() -> None:
    """镜头 scene_key 引用不存在的场景应失败（规则 13）。"""
    data = _load_sample()
    data["shots"][0]["scene_key"] = "scene_missing"
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_prop_reference_fails() -> None:
    """镜头 prop_keys 引用不存在的道具应失败（规则 14）。"""
    data = _load_sample()
    data["shots"][0]["prop_keys"].append("prop_missing")
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_costume_reference_fails() -> None:
    """镜头 costume_keys 引用不存在的服装应失败（规则 15）。"""
    data = _load_sample()
    data["shots"][0]["costume_keys"].append("costume_missing")
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_duplicate_character_key_fails() -> None:
    """character_key 必须唯一（规则 16）。"""
    data = _load_sample()
    dup = copy.deepcopy(data["characters"][0])
    data["characters"].append(dup)
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_duplicate_asset_key_fails() -> None:
    """素材类别内 key 必须唯一（规则 17）。"""
    data = _load_sample()
    dup = copy.deepcopy(data["assets"]["props"][0])
    data["assets"]["props"].append(dup)
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_field_is_rejected() -> None:
    """未知字段应被拒绝（规则 18，extra="forbid"）。"""
    data = _load_sample()
    data["unexpected_field"] = "nope"
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_nested_field_is_rejected() -> None:
    """嵌套模型的未知字段同样应被拒绝（规则 18）。"""
    data = _load_sample()
    data["shots"][0]["bogus"] = 1
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_structured_camera_is_parsed() -> None:
    """camera 为结构化对象，应解析为 shot_type/angle/movement。"""
    pkg = EpisodePackage.model_validate(_load_sample())
    cam = pkg.shots[0].camera
    assert cam is not None
    assert cam.shot_type.value == "MS"
    assert cam.angle.value == "EYE_LEVEL"
    assert cam.movement.value == "STATIC"


def test_camera_is_optional() -> None:
    """camera 可省略（storyboard 未指定时留空）。"""
    data = _load_sample()
    data["shots"][0].pop("camera", None)
    pkg = EpisodePackage.model_validate(data)
    assert pkg.shots[0].camera is None


def test_invalid_camera_shot_type_fails() -> None:
    """camera.shot_type 取值必须属于 CAS 枚举，否则失败。"""
    data = _load_sample()
    data["shots"][0]["camera"]["shot_type"] = "WIDE"  # 非法景别
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_invalid_camera_movement_fails() -> None:
    """camera.movement 取值必须属于 CAS 枚举，否则失败。"""
    data = _load_sample()
    data["shots"][0]["camera"]["movement"] = "FLY"  # 非法运镜
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)


def test_unknown_camera_field_rejected() -> None:
    """camera 对象内的未知字段应被拒绝（extra="forbid"）。"""
    data = _load_sample()
    data["shots"][0]["camera"]["zoom_ratio"] = 2
    with pytest.raises(ValidationError):
        EpisodePackage.model_validate(data)
