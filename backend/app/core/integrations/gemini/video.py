"""Gemini (Veo) Videos API：创建与查询。

与 OpenAI/xAI 都不同的第三种形状（均已通过真实调用验证）：
- 创建：`POST /models/{model}:predictLongRunning`，响应是标准 Google 长时任务对象
  `{"name": "models/{model}/operations/{id}"}`（不是 xAI 的 `request_id`，也不是
  OpenAI 的 `id`）。
- 查询：`GET /{name}`（`name` 就是上面拿到的完整路径，不是单独拼 `/videos/{id}`），
  轮询到 `done: true`。成功时结果在
  `response.generateVideoResponse.generatedSamples[0].video.uri`；
  如果内容被安全过滤拦截，`done` 仍然是 `true`，但 `generatedSamples` 为空，
  原因在 `response.generateVideoResponse.raiMediaFilteredReasons`（未被计费）。
- 鉴权用 `x-goog-api-key` 请求头，不是 `Authorization: Bearer`。
- 下载最终视频同样需要 `x-goog-api-key`，而且请求会先 302 到
  `.../download/v1beta/files/...`——调用方必须跟随重定向并带上同一个鉴权头，
  否则会拿到一段很短的 JSON 错误而不是视频内容。
"""

from __future__ import annotations

from typing import Any

from app.core.integrations.gemini.video_payload import build_create_video_body, resolve_video_model
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput


class GeminiVideoApiAdapter:
    """Gemini 视频：POST /models/{model}:predictLongRunning 与 GET /{operation_name}。"""

    async def create_video(
        self,
        *,
        cfg: ProviderConfig,
        input_: VideoGenerationInput,
        timeout_s: float,
    ) -> str:
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        base_url = (cfg.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        headers = {
            "x-goog-api-key": cfg.api_key,
            "Content-Type": "application/json",
        }
        model = resolve_video_model(input_)
        body = build_create_video_body(input_)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(f"{base_url}/models/{model}:predictLongRunning", headers=headers, json=body)
            r.raise_for_status()
            data: dict[str, Any] = r.json()
            operation_name = str(data.get("name") or "")
            if not operation_name:
                raise RuntimeError(f"Gemini predictLongRunning missing operation name: {data!r}")
            return operation_name

    async def get_operation(
        self,
        *,
        cfg: ProviderConfig,
        operation_name: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        base_url = (cfg.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        headers = {"x-goog-api-key": cfg.api_key}

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(f"{base_url}/{operation_name}", headers=headers)
            r.raise_for_status()
            return r.json()
