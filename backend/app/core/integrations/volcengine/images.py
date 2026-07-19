"""火山方舟 ImageGenerations。"""

from __future__ import annotations

import time
from typing import Any

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


class VolcengineImageApiAdapter:
    """火山图片生成 HTTP；无状态，可单测替换。"""

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

        url = build_volcengine_image_generations_url(cfg.base_url)
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
            r.raise_for_status()
            data = r.json()

        return _parse_volcengine_images_payload(data)


def build_volcengine_image_generations_url(base_url: str | None) -> str:
    """规范化火山 Ark 基础地址，并返回图片生成的唯一正确端点。

    历史配置可能误将视频子路径 ``/contents/generations`` 保存为 Base URL。
    图片接口始终位于 Ark v3 根路径下的 ``/images/generations``，因此先移除
    已包含的图片或视频操作路径，避免拼出重复或跨能力的 URL。
    """
    normalized_base = (base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    for operation_path in ("/contents/generations", "/images/generations"):
        if normalized_base.endswith(operation_path):
            normalized_base = normalized_base[: -len(operation_path)]
            break
    return f"{normalized_base}/images/generations"


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
