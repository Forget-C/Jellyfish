from __future__ import annotations

from dataclasses import dataclass
from threading import RLock

from fastapi import HTTPException, status

from app.models.llm import ModelCategoryKey


@dataclass(frozen=True, slots=True)
class ProviderSpec:
    key: str
    display_name: str
    aliases: tuple[str, ...]
    supported_categories: tuple[ModelCategoryKey, ...]
    default_base_url: str | None = None
    requires_api_key: bool = True
    requires_api_secret: bool = False
    is_experimental: bool = False


_SPECS_BY_KEY: dict[str, ProviderSpec] = {}
_KEY_BY_ALIAS: dict[str, str] = {}
_LOCK = RLock()


def _norm(value: str) -> str:
    return (value or "").strip().lower()


def register_provider(spec: ProviderSpec) -> None:
    key = _norm(spec.key)
    if not key:
        raise ValueError("provider key cannot be empty")
    if not spec.supported_categories:
        raise ValueError(f"provider {spec.key!r} must define supported_categories")

    aliases = tuple({a for a in (spec.aliases or ()) if _norm(a)})
    normalized_spec = ProviderSpec(
        key=key,
        display_name=(spec.display_name or spec.key).strip(),
        aliases=aliases,
        supported_categories=spec.supported_categories,
        default_base_url=(spec.default_base_url or "").strip() or None,
        requires_api_key=bool(spec.requires_api_key),
        requires_api_secret=bool(spec.requires_api_secret),
        is_experimental=bool(spec.is_experimental),
    )

    with _LOCK:
        existing = _SPECS_BY_KEY.get(key)
        if existing is not None and existing != normalized_spec:
            raise ValueError(f"provider key already registered with different spec: {key}")
        _SPECS_BY_KEY[key] = normalized_spec
        _KEY_BY_ALIAS[key] = key
        for alias in normalized_spec.aliases:
            alias_key = _norm(alias)
            if alias_key in _KEY_BY_ALIAS and _KEY_BY_ALIAS[alias_key] != key:
                raise ValueError(f"provider alias conflict: {alias!r}")
            _KEY_BY_ALIAS[alias_key] = key


def register_many(specs: list[ProviderSpec]) -> None:
    for spec in specs:
        register_provider(spec)


def list_registered_providers(category: ModelCategoryKey | None = None) -> list[ProviderSpec]:
    with _LOCK:
        values = list(_SPECS_BY_KEY.values())
    if category is None:
        return sorted(values, key=lambda x: x.key)
    return sorted((x for x in values if category in x.supported_categories), key=lambda x: x.key)


def get_provider_spec(provider_key: str) -> ProviderSpec:
    key = _norm(provider_key)
    with _LOCK:
        spec = _SPECS_BY_KEY.get(key)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Unsupported provider key: {provider_key!r}",
        )
    return spec


def resolve_provider_key_from_name(name: str) -> str:
    alias = _norm(name)
    with _LOCK:
        key = _KEY_BY_ALIAS.get(alias)
    if key:
        return key
    # 兼容历史“包含式”命名（如 Doubao Video / bytedance-xxx）。
    if "volc" in alias or "doubao" in alias or "bytedance" in alias:
        return "volcengine"
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"Unsupported provider name: {name!r}",
    )


def try_resolve_provider_key_from_name(name: str) -> str | None:
    """解析已注册供应商 key；未知名称视为自定义供应商并返回 None。"""
    try:
        return resolve_provider_key_from_name(name)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE and str(exc.detail).startswith(
            "Unsupported provider name:"
        ):
            return None
        raise


def is_provider_category_supported(provider_key: str, category: ModelCategoryKey) -> bool:
    spec = get_provider_spec(provider_key)
    return category in spec.supported_categories
