"""Unit tests for Novita provider registration and resolver behaviour."""

from __future__ import annotations

import pytest

from app.models.llm import ModelCategoryKey, Provider
from app.services.llm.provider_bootstrap import bootstrap_builtin_providers
from app.services.llm.provider_registry import (
    _KEY_BY_ALIAS,
    _LOCK,
    _SPECS_BY_KEY,
    get_provider_spec,
    list_registered_providers,
    resolve_provider_key_from_name,
)
from app.services.llm.provider_resolver import resolve_effective_base_url


def _reset_registry() -> None:
    with _LOCK:
        _SPECS_BY_KEY.clear()
        _KEY_BY_ALIAS.clear()


@pytest.fixture(autouse=True)
def isolated_registry() -> None:
    _reset_registry()
    bootstrap_builtin_providers()
    yield
    _reset_registry()


class TestNovitaRegistration:
    def test_novita_is_registered(self) -> None:
        spec = get_provider_spec("novita")
        assert spec.key == "novita"

    def test_novita_display_name(self) -> None:
        spec = get_provider_spec("novita")
        assert spec.display_name == "Novita"

    def test_novita_default_base_url(self) -> None:
        spec = get_provider_spec("novita")
        assert spec.default_base_url == "https://api.novita.ai/openai/v1"

    def test_novita_supports_text_category(self) -> None:
        spec = get_provider_spec("novita")
        assert ModelCategoryKey.text in spec.supported_categories

    def test_novita_does_not_support_image_category(self) -> None:
        spec = get_provider_spec("novita")
        assert ModelCategoryKey.image not in spec.supported_categories

    def test_novita_does_not_support_video_category(self) -> None:
        spec = get_provider_spec("novita")
        assert ModelCategoryKey.video not in spec.supported_categories

    def test_novita_requires_api_key(self) -> None:
        spec = get_provider_spec("novita")
        assert spec.requires_api_key is True

    def test_novita_resolve_by_alias(self) -> None:
        assert resolve_provider_key_from_name("novita_ai") == "novita"
        assert resolve_provider_key_from_name("novita-ai") == "novita"

    def test_novita_resolve_lowercase(self) -> None:
        assert resolve_provider_key_from_name("Novita") == "novita"

    def test_novita_appears_in_text_provider_list(self) -> None:
        keys = [p.key for p in list_registered_providers(category=ModelCategoryKey.text)]
        assert "novita" in keys

    def test_novita_not_in_image_provider_list(self) -> None:
        keys = [p.key for p in list_registered_providers(category=ModelCategoryKey.image)]
        assert "novita" not in keys

    def test_novita_not_in_video_provider_list(self) -> None:
        keys = [p.key for p in list_registered_providers(category=ModelCategoryKey.video)]
        assert "novita" not in keys


def test_resolve_effective_base_url_uses_novita_default_text_url() -> None:
    provider = Provider(id="p-novita", name="Novita", base_url="", api_key="k")

    assert (
        resolve_effective_base_url(provider=provider, category=ModelCategoryKey.text)
        == "https://api.novita.ai/openai/v1"
    )
