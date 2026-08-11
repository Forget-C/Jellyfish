"""OpenAI Images API（generations / edits）。"""

from __future__ import annotations

import time
from typing import Any

from app.core.integrations.http_logging import (
    json_dumps_for_log,
    log_image_http_request,
    log_image_http_response,
    safe_body_for_log_openai,
)
from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
)
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.image_capabilities import resolve_image_size
from app.core.integrations.openai.image_capabilities import validate_openai_image_options


class OpenAIImageApiAdapter:
    """OpenAI 图片生成 HTTP；无状态，可单测替换。

    `PROVIDER_LABEL` 仅用于日志与结果里的 provider 标识；子类（如 xAI，请求/响应形状与
    OpenAI 完全一致）可以只覆盖这个类属性来复用全部 HTTP 逻辑，而不需要重写 `generate()`。
    """

    PROVIDER_LABEL: str = "openai"

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

        base_url = (cfg.base_url or "https://api.openai.com/v1").rstrip("/")
        resolved_size = resolve_image_size(
            provider="openai",
            model=inp.model,
            purpose=inp.purpose,
            target_ratio=inp.target_ratio,
            resolution_profile=inp.resolution_profile,
            requested_size=inp.size,
        )
        resolved_input = inp.model_copy(update={"size": resolved_size})
        validate_openai_image_options(resolved_input)
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            if resolved_input.images:
                body: dict[str, Any] = {
                    "prompt": resolved_input.prompt,
                    "n": resolved_input.n,
                }
                if resolved_input.model:
                    body["model"] = resolved_input.model
                if resolved_input.size:
                    body["size"] = resolved_input.size
                if resolved_input.watermark is not None:
                    body["watermark"] = bool(resolved_input.watermark)

                body["images"] = [
                    {
                        **({"file_id": ref.file_id} if ref.file_id else {}),
                        **({"image_url": ref.image_url} if ref.image_url else {}),
                    }
                    for ref in resolved_input.images
                ]

                url = f"{base_url}/images/edits"
                t0 = time.perf_counter()
                log_image_http_request(
                    provider=self.PROVIDER_LABEL,
                    method="POST",
                    url=url,
                    headers=headers,
                    body_log=json_dumps_for_log(safe_body_for_log_openai(body)),
                )
                r = await client.post(url, headers=headers, json=body)
            else:
                body = {
                    "prompt": resolved_input.prompt,
                    "n": resolved_input.n,
                    "response_format": resolved_input.response_format,
                }
                if resolved_input.model:
                    body["model"] = resolved_input.model
                if resolved_input.size:
                    body["size"] = resolved_input.size
                if resolved_input.watermark is not None:
                    body["watermark"] = bool(resolved_input.watermark)

                url = f"{base_url}/images/generations"
                t0 = time.perf_counter()
                log_image_http_request(
                    provider=self.PROVIDER_LABEL,
                    method="POST",
                    url=url,
                    headers=headers,
                    body_log=json_dumps_for_log(safe_body_for_log_openai(body)),
                )
                r = await client.post(url, headers=headers, json=body)

            dt_ms = int((time.perf_counter() - t0) * 1000)
            resp_text = ""
            try:
                resp_text = r.text or ""
            except Exception:  # noqa: BLE001
                resp_text = ""
            log_image_http_response(
                provider=self.PROVIDER_LABEL,
                status_code=r.status_code,
                elapsed_ms=dt_ms,
                resp_headers=dict(r.headers),
                resp_text=resp_text,
            )

            r.raise_for_status()
            data = r.json()

        return _parse_openai_images_payload(data, provider=self.PROVIDER_LABEL)


def _parse_openai_images_payload(data: dict[str, Any], *, provider: str = "openai") -> ImageGenerationResult:
    raw_items = data.get("data") or []
    images: list[ImageItem] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        b64 = item.get("b64_json")
        if not url and not b64:
            continue
        images.append(ImageItem(url=url, b64_json=b64))

    if not images:
        raise RuntimeError(f"OpenAI images response has no usable data: {data!r}")

    return ImageGenerationResult(
        images=images,
        provider=provider,  # type: ignore[arg-type]
        provider_task_id=None,
        status=str(data.get("status") or "succeeded"),
    )
