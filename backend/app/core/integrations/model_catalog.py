"""供应商模型目录发现：实时 `/models` 与内置官方目录。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.model_catalog import ProviderModelCandidate, ProviderModelCatalog
from app.core.contracts.provider import ProviderConfig


async def discover_provider_models(*, cfg: ProviderConfig) -> ProviderModelCatalog:
    """按供应商协议获取可导入模型，Vidu 使用其未提供列表 API 时的官方目录。"""
    if cfg.provider == "vidu":
        return ProviderModelCatalog(
            provider_key="vidu",
            source="provider_catalog",
            models=_VIDU_MODELS,
        )
    return await _discover_openai_compatible_models(cfg=cfg)


async def _discover_openai_compatible_models(*, cfg: ProviderConfig) -> ProviderModelCatalog:
    """读取 OpenAI 兼容供应商的 `/models` 响应，并按模型命名规则推断项目类别。"""
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("httpx is required for provider model discovery") from exc

    base_url = (cfg.base_url or "").rstrip("/")
    if not base_url:
        raise ValueError(f"Provider {cfg.provider} has no base_url for model discovery")
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(f"{base_url}/models", headers=headers)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()

    names = [
        str(item.get("id") or item.get("name") or "").strip()
        for item in (payload.get("data") or payload.get("models") or [])
        if isinstance(item, dict)
    ]
    candidates = [
        ProviderModelCandidate(name=name, category=_infer_category(cfg.provider, name))
        for name in sorted(set(names))
        if name
    ]
    return ProviderModelCatalog(provider_key=cfg.provider, source="provider_api", models=candidates)


def _infer_category(provider_key: str, model_name: str):
    """将兼容 API 未携带类别的模型名映射到 Jellyfish 的 text/image/video 三类。"""
    from app.models.llm import ModelCategoryKey

    normalized = model_name.lower()
    if any(token in normalized for token in ("seedream", "image", "dall-e", "cogview")):
        return ModelCategoryKey.image
    if any(token in normalized for token in ("sora", "seedance", "video", "wanx")):
        return ModelCategoryKey.video
    # 方舟与兼容网关通常将聊天模型置于同一列表，未识别项按 text 处理。
    _ = provider_key
    return ModelCategoryKey.text


_VIDU_MODELS = [
    ProviderModelCandidate(name="viduq2", category="image", description="文生图、参考图生图和图片编辑"),
    ProviderModelCandidate(name="viduq1", category="image", description="参考图生图"),
    ProviderModelCandidate(name="viduq3-pro", category="video", description="高质量文生、单图和首尾帧视频"),
    ProviderModelCandidate(name="viduq3-mix", category="video", description="多参考图一致性视频"),
    ProviderModelCandidate(name="viduq3-drama", category="video", description="短剧/漫画场景视频"),
    ProviderModelCandidate(name="viduq3-ad", category="video", description="广告场景视频"),
    ProviderModelCandidate(name="viduq3-turbo", category="video", description="快速视频生成"),
    ProviderModelCandidate(name="viduq2-pro", category="video", description="参考图与视频编辑"),
    ProviderModelCandidate(name="viduq2", category="video", description="文生与多参考图视频"),
    ProviderModelCandidate(name="viduq2-turbo", category="video", description="快速单图视频"),
    ProviderModelCandidate(name="viduq1", category="video", description="稳定镜头视频"),
    ProviderModelCandidate(name="viduq1-classic", category="video", description="丰富运镜视频"),
    ProviderModelCandidate(name="vidu2.0", category="video", description="Vidu 2.0 视频"),
]
