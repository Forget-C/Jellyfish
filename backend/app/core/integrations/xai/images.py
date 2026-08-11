"""xAI Images API（generations）。

xAI 的 `/images/generations` 请求体与响应体（`data: [{url, mime_type}]`）与 OpenAI Images API 完全一致，
因此完整复用 `OpenAIImageApiAdapter` 的 HTTP 实现——只覆盖 `PROVIDER_LABEL`，
日志与结果里的 provider 标识就会正确显示为 "xai" 而不是 "openai"。
"""

from __future__ import annotations

from app.core.integrations.openai.images import OpenAIImageApiAdapter


class XAIImageApiAdapter(OpenAIImageApiAdapter):
    """xAI 图片生成；HTTP 细节继承自 OpenAI 适配器，请求/响应形状相同。"""

    PROVIDER_LABEL = "xai"
