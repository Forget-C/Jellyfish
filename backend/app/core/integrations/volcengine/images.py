"""火山方舟 ImageGenerations。"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.integrations.http_logging import (
    json_dumps_for_log,
    log_image_http_request,
    log_image_http_response,
    safe_body_for_log_volcengine_image,
)
from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
)
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.image_capabilities import resolve_image_size
from app.core.integrations.volcengine.image_capabilities import validate_volcengine_image_options


def _volcengine_http_error_detail(response: httpx.Response) -> str | None:
    """从方舟错误 JSON 中提取可读说明（优先于 httpx 默认文案）。"""
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return None
    err = data.get("error")
    if isinstance(err, dict):
        code = err.get("code")
        msg = err.get("message")
        parts = [str(x) for x in (code, msg) if x]
        if parts:
            return ": ".join(parts) if len(parts) > 1 else parts[0]
    if isinstance(err, str) and err.strip():
        return err.strip()
    return None


class VolcengineImageApiAdapter:
    """火山图片生成 HTTP；无状态，可单测替换。"""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        base_url = (cfg.base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        resolved_size = resolve_image_size(
            provider="volcengine",
            model=inp.model,
            purpose=inp.purpose,
            target_ratio=inp.target_ratio,
            resolution_profile=inp.resolution_profile,
            requested_size=inp.size,
        )
        resolved_input = inp.model_copy(update={"size": resolved_size})
        validate_volcengine_image_options(resolved_input)
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }

        body = _build_image_body(resolved_input)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            url = f"{base_url}/images/generations"
            t0 = time.perf_counter()
            log_image_http_request(
                provider="volcengine",
                method="POST",
                url=url,
                headers=headers,
                body_log=json_dumps_for_log(safe_body_for_log_volcengine_image(body)),
            )
            r = await client.post(url, headers=headers, json=body)
            dt_ms = int((time.perf_counter() - t0) * 1000)
            resp_text = ""
            try:
                resp_text = r.text or ""
            except Exception:  # noqa: BLE001
                resp_text = ""
            log_image_http_response(
                provider="volcengine",
                status_code=r.status_code,
                elapsed_ms=dt_ms,
                resp_headers=dict(r.headers),
                resp_text=resp_text,
            )
            if r.status_code >= 400:
                detail = _volcengine_http_error_detail(r)
                if detail:
                    raise RuntimeError(detail)
            r.raise_for_status()
            data = r.json()

        return _parse_volcengine_images_payload(data)


def _build_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    body: dict[str, Any] = {
        "prompt": inp.prompt,
        "n": inp.n,
    }
    if inp.model:
        body["model"] = inp.model
    if inp.size:
        body["size"] = inp.size
    if inp.seed is not None:
        body["seed"] = int(inp.seed)
    if inp.watermark is not None:
        body["watermark"] = bool(inp.watermark)
    if inp.images:
        body["image"] = [
            ref.image_url or ref.file_id
            for ref in inp.images
            if (ref.image_url or ref.file_id)
        ]
    if inp.response_format:
        body["response_format"] = inp.response_format
    return body


def _parse_volcengine_images_payload(data: dict[str, Any]) -> ImageGenerationResult:
    raw_items = data.get("data") or []
    images: list[ImageItem] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("image_url")
        b64 = item.get("b64_json")
        if not url and not b64:
            continue
        images.append(ImageItem(url=url, b64_json=b64))

    if not images:
        raise RuntimeError(f"Volcengine ImageGenerations response has no usable data: {data!r}")

    provider_task_id = str(data.get("id") or data.get("task_id") or "")

    return ImageGenerationResult(
        images=images,
        provider="volcengine",
        provider_task_id=provider_task_id or None,
        status=str(data.get("status") or "succeeded"),
    )
