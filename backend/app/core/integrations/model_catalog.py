"""供应商模型目录发现：实时 `/models` 与内置官方目录。"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.contracts.model_catalog import ProviderModelCandidate, ProviderModelCatalog
from app.core.contracts.model_provider import ModelProviderConfig, ModelProviderConfigurationError
from app.models.llm import ModelCategoryKey


class OpenAICompatibleModelCatalog:
    """通过注入的客户端查询 OpenAI 兼容的模型目录。"""

    def __init__(self, config: ModelProviderConfig, client: httpx.AsyncClient) -> None:
        self._config = config
        self._client = client

    async def list_models(self) -> ProviderModelCatalog:
        cfg = self._config
        base_url = (cfg.base_url or "").rstrip("/")
        if not base_url:
            raise ModelProviderConfigurationError(f"Provider {cfg.provider} has no catalog base URL")
        response = await self._client.get(
            f"{base_url}/models", headers={"Authorization": f"Bearer {cfg.api_key}"}
        )
        response.raise_for_status()
        return _parse_remote_catalog(cfg.provider, response.json())


class BuiltinModelCatalog:
    """返回没有目录 API 的供应商所维护的内置目录。"""

    def __init__(self, provider: str, models: list[ProviderModelCandidate]) -> None:
        self._provider = provider
        self._models = models

    async def list_models(self) -> ProviderModelCatalog:
        return ProviderModelCatalog(
            provider_key=self._provider,
            source="provider_catalog",
            models=[model.model_copy(deep=True) for model in self._models],
        )


def _parse_remote_catalog(provider: str, payload: dict[str, Any]) -> ProviderModelCatalog:
    names = [
        str(item.get("id") or item.get("name") or "").strip()
        for item in (payload.get("data") or payload.get("models") or [])
        if isinstance(item, dict)
    ]
    candidates = [
        ProviderModelCandidate(name=name, category=_infer_category(name))
        for name in sorted(set(names))
        if name
    ]
    return ProviderModelCatalog(provider_key=provider, source="provider_api", models=candidates)


def _infer_category(model_name: str) -> ModelCategoryKey:
    """将兼容 API 未携带类别的模型名映射到 Jellyfish 的 text/image/video 三类。"""
    normalized = model_name.lower()
    if any(token in normalized for token in ("seedream", "image", "dall-e", "cogview")):
        return ModelCategoryKey.image
    if any(token in normalized for token in ("sora", "seedance", "video", "wanx")):
        return ModelCategoryKey.video
    # 方舟与兼容网关通常将聊天模型置于同一列表，未识别项按 text 处理。
    return ModelCategoryKey.text


VIDU_MODELS = [
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

# 可灵未提供适合管理端导入的标准模型列表接口。
# 因此保持为经过确认的官方模型白名单。
KLING_MODELS = [
    ProviderModelCandidate(
        name="kling-3.0-turbo",
        category="video",
        description="Kling 3.0 Turbo 文生视频",
    ),
    ProviderModelCandidate(
        name="kling-3.0",
        category="video",
        description="Kling 3.0 Omni 文生、首帧和首尾帧图生视频",
    ),
    ProviderModelCandidate(
        name="kling-v3",
        category="image",
        description="Kling Image 3.0 Omni 图片生成",
    ),
]
