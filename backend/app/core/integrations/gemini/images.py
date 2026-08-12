"""Gemini 图片生成：原生多模态 generateContent，非 Imagen :predict。

Imagen 经典的 `:predict` REST 端点已对新用户下线（实测返回 404，提示改用
Interactions API）。当前实际可用路径是通过 Gemini 原生多模态模型
（如 `gemini-2.5-flash-image`）的 `generateContent` 接口——请求体是标准的
`{"contents": [{"parts": [...]}]}`，图片以 `inlineData`（base64）形式随文本一起
出现在 `candidates[0].content.parts[]` 里，不是一个可直接下载的 URL。

认证方式也与 OpenAI/火山不同：Gemini 用 `x-goog-api-key` 请求头，不是
`Authorization: Bearer`。
"""

from __future__ import annotations

import base64
from typing import Any

from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
    InputImageRef,
)
from app.core.contracts.provider import ProviderConfig

DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"


async def _resolve_reference_image_part(client: Any, ref: InputImageRef) -> dict[str, Any] | None:
    """把参考图引用解析为 Gemini 的 inlineData part；支持 data URL 或需要拉取的远程 URL。"""
    if not ref.image_url:
        return None
    value = ref.image_url.strip()
    if value.startswith("data:"):
        header, _, encoded = value.partition(",")
        mime_type = header[5:].split(";")[0] or "image/png"
        return {"inlineData": {"mimeType": mime_type, "data": encoded}}

    resp = await client.get(value)
    resp.raise_for_status()
    mime_type = resp.headers.get("Content-Type", "image/png").split(";")[0]
    return {
        "inlineData": {
            "mimeType": mime_type,
            "data": base64.b64encode(resp.content).decode("ascii"),
        }
    }


class GeminiImageApiAdapter:
    """Gemini 原生多模态图片生成 HTTP；无状态，可单测替换。"""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for image generation tasks") from e

        base_url = (cfg.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        model = inp.model or DEFAULT_GEMINI_IMAGE_MODEL
        headers = {
            "x-goog-api-key": cfg.api_key,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            parts: list[dict[str, Any]] = [{"text": inp.prompt}]
            for ref in inp.images:
                part = await _resolve_reference_image_part(client, ref)
                if part is not None:
                    parts.append(part)

            body = {"contents": [{"parts": parts}]}
            url = f"{base_url}/models/{model}:generateContent"
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()

        return _parse_gemini_image_payload(data)


def _parse_gemini_image_payload(data: dict[str, Any]) -> ImageGenerationResult:
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini generateContent response has no candidates: {data!r}")

    images: list[ImageItem] = []
    for part in (candidates[0].get("content") or {}).get("parts") or []:
        inline = part.get("inlineData")
        if isinstance(inline, dict) and inline.get("data"):
            images.append(ImageItem(b64_json=inline["data"]))

    if not images:
        raise RuntimeError(f"Gemini generateContent response has no inline image data: {data!r}")

    return ImageGenerationResult(
        images=images,
        provider="gemini",
        provider_task_id=None,
        status="succeeded",
    )
