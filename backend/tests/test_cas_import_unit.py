"""CAS 导入器纯逻辑单测：canonical 哈希与 domain 映射（不触库、不依赖 app）。"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from app.crypto_animal_studio.application.hashing import canonical_payload_hash
from app.crypto_animal_studio.domain import mapping
from app.crypto_animal_studio.schemas.episode_package import CameraSpec, EpisodePackage

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE = _REPO_ROOT / "docs" / "crypto-animal-studio" / "samples" / "sample-episode-package-v1.json"


def _load_pkg() -> EpisodePackage:
    return EpisodePackage.model_validate(json.loads(_SAMPLE.read_text(encoding="utf-8")))


# --- hashing ---
def test_hash_is_deterministic() -> None:
    """相同 payload → 相同哈希（与字段书写顺序无关）。"""
    assert canonical_payload_hash(_load_pkg()) == canonical_payload_hash(_load_pkg())


def test_hash_changes_on_payload_change() -> None:
    """payload 变化 → 哈希变化。"""
    data = json.loads(_SAMPLE.read_text(encoding="utf-8"))
    h1 = canonical_payload_hash(EpisodePackage.model_validate(data))
    data["title"] = data["title"] + " (edit)"
    h2 = canonical_payload_hash(EpisodePackage.model_validate(data))
    assert h1 != h2
    assert len(h1) == 64  # sha256 hex


# --- mapping ---
def test_normalize_key_trims_and_lowercases() -> None:
    assert mapping.normalize_key("  Bull  ") == "bull"
    assert mapping.normalize_key("WALTER") == "walter"


def test_resolve_camera_defaults_and_warns_when_missing() -> None:
    shot_type, angle, movement, warnings = mapping.resolve_camera(None)
    assert (shot_type, angle, movement) == ("MS", "EYE_LEVEL", "STATIC")
    assert warnings and "camera missing" in warnings[0]


def test_resolve_camera_uses_provided_values() -> None:
    cam = CameraSpec(shot_type="CU", angle="LOW_ANGLE", movement="PAN")
    shot_type, angle, movement, warnings = mapping.resolve_camera(cam)
    assert (shot_type, angle, movement) == ("CU", "LOW_ANGLE", "PAN")
    assert warnings == []


def test_resolve_line_mode_valid_and_invalid() -> None:
    assert mapping.resolve_line_mode("VOICE_OVER") == ("VOICE_OVER", None)
    code, warning = mapping.resolve_line_mode("SINGING")
    assert code == "DIALOGUE" and warning is not None


def test_round_duration_minimum_one() -> None:
    assert mapping.round_duration(8.4) == 8
    assert mapping.round_duration(0.2) == 1


def test_assemble_raw_text_is_nonempty_and_ordered() -> None:
    pkg = _load_pkg()
    text = mapping.assemble_raw_text(pkg)
    assert "Champagne Before Confirmation" in text
    # 镜头按 sequence 顺序出现
    assert text.index("[1]") < text.index("[2]") < text.index("[3]")
    # 保留 action 与对白
    assert "(action)" in text
    assert pkg.shots[0].action in text
    assert pkg.shots[0].dialogue[0].text in text


def test_assemble_raw_text_is_deterministic() -> None:
    pkg = _load_pkg()
    assert mapping.assemble_raw_text(pkg) == mapping.assemble_raw_text(_load_pkg())
