"""Vidu Reference to Image API。"""

from __future__ import annotations

import time
from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, ImageItem
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.http_logging import (
    json_dumps_for_log,
    log_image_http_request,
    log_image_http_response,
    safe_body_for_log_vidu,
)
from app.core.integrations.image_capabilities import resolve_image_size
from app.core.integrations.vidu.image_capabilities import validate_vidu_image_options

_DEFAULT_BASE_URL = "https://api.vidu.cn"


class ViduImageApiAdapter:
    """Vidu 图片异步任务 HTTP 适配器，负责创建任务与读取最终图片 URL。"""

    async def create_image(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> str:
        """提交 Reference to Image 任务，返回 Vidu task_id。"""
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for image generation tasks") from e

        body = build_create_image_body(inp)
        base_url = (cfg.base_url or _DEFAULT_BASE_URL).rstrip("/")
        url = f"{base_url}/ent/v2/reference2image"
        headers = {"Authorization": f"Token {cfg.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            started_at = time.perf_counter()
            log_image_http_request(
                provider="vidu",
                method="POST",
                url=url,
                headers=headers,
                body_log=json_dumps_for_log(safe_body_for_log_vidu(body)),
            )
            response = await client.post(url, headers=headers, json=body)
            _log_response(response=response, started_at=started_at)
            _raise_for_status(response=response, operation="create image task")
            data: dict[str, Any] = response.json()

        task_id = str(data.get("task_id") or "")
        if not task_id:
            raise RuntimeError(f"Vidu image creation missing task_id: {data!r}")
        return task_id

    async def get_creation(
        self,
        *,
        cfg: ProviderConfig,
        task_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        """读取 Vidu 异步任务状态及完成后的 creations。"""
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for image generation tasks") from e

        base_url = (cfg.base_url or _DEFAULT_BASE_URL).rstrip("/")
        headers = {"Authorization": f"Token {cfg.api_key}"}
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(f"{base_url}/ent/v2/tasks/{task_id}/creations", headers=headers)
            _raise_for_status(response=response, operation="get image task")
            return response.json()


def build_create_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    """将通用图片输入映射为 Vidu Reference to Image 请求体。"""
    model = (inp.model or "").strip()
    if not model:
        raise ValueError("Vidu image generation requires model")
    validate_vidu_image_options(inp)
    size = resolve_image_size(
        provider="vidu",
        model=model,
        purpose=inp.purpose,
        target_ratio=inp.target_ratio,
        resolution_profile=inp.resolution_profile,
        requested_size=inp.size,
    )
    body: dict[str, Any] = {"model": model, "prompt": inp.prompt}
    images = _resolve_reference_images(inp)
    # Vidu 将 viduq2 的“0 张参考图”定义为合法输入，但中国站服务端仍要求
    # images 字段存在；因此文生图必须显式传空数组，不能省略该字段。
    body["images"] = images
    if inp.target_ratio:
        body["aspect_ratio"] = inp.target_ratio
    if size:
        body["resolution"] = size
    if inp.seed is not None:
        body["seed"] = int(inp.seed)
    return body


def parse_vidu_image_creation(*, task_id: str, data: dict[str, Any]) -> ImageGenerationResult:
    """将已成功的 Vidu creation 响应转换为通用图片结果。"""
    images = [
        ImageItem(url=url)
        for item in (data.get("creations") or [])
        if isinstance(item, dict) and isinstance((url := item.get("url")), str) and url
    ]
    if not images:
        raise RuntimeError(f"Vidu image task succeeded without creations: {data!r}")
    return ImageGenerationResult(
        images=images,
        provider="vidu",
        provider_task_id=task_id,
        status=str(data.get("state") or "success"),
    )


def _resolve_reference_images(inp: ImageGenerationInput) -> list[str]:
    """提取 Vidu 可接受的 URL 或 data URL 参考图，拒绝仅有 OpenAI file_id 的输入。"""
    images: list[str] = []
    for ref in inp.images:
        if ref.image_url:
            images.append(ref.image_url)
            continue
        raise ValueError("Vidu image references require image_url; file_id is not supported")
    return images


def _log_response(*, response: Any, started_at: float) -> None:
    """记录 Vidu 图片创建响应，同时保持认证头和参考图内容脱敏。"""
    try:
        response_text = response.text or ""
    except Exception:  # noqa: BLE001
        response_text = ""
    log_image_http_response(
        provider="vidu",
        status_code=response.status_code,
        elapsed_ms=int((time.perf_counter() - started_at) * 1000),
        resp_headers=dict(response.headers),
        resp_text=response_text,
    )


def _raise_for_status(*, response: Any, operation: str) -> None:
    """将 Vidu 非成功响应转为可存入任务中心的脱敏错误摘要。"""
    if not response.is_error:
        return
    try:
        response_text = (response.text or "").strip()
    except Exception:  # noqa: BLE001
        response_text = ""
    summary = response_text[:1000] if response_text else "no response body"
    raise RuntimeError(f"Vidu {operation} failed: HTTP {response.status_code}; response={summary}")
