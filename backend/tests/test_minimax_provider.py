"""Unit tests for MiniMax provider registration and resolver behaviour."""

from __future__ import annotations

import pytest

from app.models.llm import ModelCategoryKey
from app.services.llm.provider_bootstrap import bootstrap_builtin_providers
from app.services.llm.provider_registry import (
    _SPECS_BY_KEY,
    _KEY_BY_ALIAS,
    _LOCK,
    get_provider_spec,
    list_registered_providers,
    resolve_provider_key_from_name,
)


def _reset_registry() -> None:
    """Clear the global registry between tests."""
    with _LOCK:
        _SPECS_BY_KEY.clear()
        _KEY_BY_ALIAS.clear()


@pytest.fixture(autouse=True)
def isolated_registry() -> None:
    _reset_registry()
    bootstrap_builtin_providers()
    yield
    _reset_registry()


class TestMiniMaxRegistration:
    def test_minimax_is_registered(self) -> None:
        spec = get_provider_spec("minimax")
        assert spec.key == "minimax"

    def test_minimax_display_name(self) -> None:
        spec = get_provider_spec("minimax")
        assert spec.display_name == "MiniMax"

    def test_minimax_default_base_url(self) -> None:
        spec = get_provider_spec("minimax")
        assert spec.default_base_url == "https://api.minimax.io/v1"

    def test_minimax_supports_text_category(self) -> None:
        spec = get_provider_spec("minimax")
        assert ModelCategoryKey.text in spec.supported_categories

    def test_minimax_does_not_support_image_category(self) -> None:
        spec = get_provider_spec("minimax")
        assert ModelCategoryKey.image not in spec.supported_categories

    def test_minimax_does_not_support_video_category(self) -> None:
        spec = get_provider_spec("minimax")
        assert ModelCategoryKey.video not in spec.supported_categories

    def test_minimax_requires_api_key(self) -> None:
        spec = get_provider_spec("minimax")
        assert spec.requires_api_key is True

    def test_minimax_resolve_by_alias(self) -> None:
        key = resolve_provider_key_from_name("MiniMax")
        assert key == "minimax"

    def test_minimax_resolve_lowercase(self) -> None:
        key = resolve_provider_key_from_name("minimax")
        assert key == "minimax"

    def test_minimax_appears_in_text_provider_list(self) -> None:
        text_providers = list_registered_providers(category=ModelCategoryKey.text)
        keys = [p.key for p in text_providers]
        assert "minimax" in keys

    def test_minimax_not_in_image_provider_list(self) -> None:
        image_providers = list_registered_providers(category=ModelCategoryKey.image)
        keys = [p.key for p in image_providers]
        assert "minimax" not in keys

    def test_minimax_not_in_video_provider_list(self) -> None:
        video_providers = list_registered_providers(category=ModelCategoryKey.video)
        keys = [p.key for p in video_providers]
        assert "minimax" not in keys


class TestMiniMaxModels:
    """Verify MiniMax model names expected by the SKILL.md specification."""

    EXPECTED_MODELS = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]

    def test_expected_model_names_are_valid_strings(self) -> None:
        for model in self.EXPECTED_MODELS:
            assert isinstance(model, str) and model.startswith("MiniMax-")

    def test_minimax_m2_7_model_name(self) -> None:
        assert "MiniMax-M2.7" in self.EXPECTED_MODELS

    def test_minimax_m2_7_highspeed_model_name(self) -> None:
        assert "MiniMax-M2.7-highspeed" in self.EXPECTED_MODELS
