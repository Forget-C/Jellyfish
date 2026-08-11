"""xAI Videos API：创建与查询。

与 OpenAI Videos API 的三点关键差异（均已通过真实调用验证）：
- 创建端点是 `POST /videos/generations`（非 `/videos`），响应体为 `{request_id}`。
- 查询用 `GET /videos/{request_id}`；status 取值为 `pending` / `done` / `failed`
  （非 OpenAI 的 `in_progress` / `completed` / `failed`）。
- 结果视频地址内联在轮询响应的 `video.url` 里，不需要（也没有）额外的
  `/videos/{id}/content` 端点。
"""

from __future__ import annotations

from typing import Any

from app.core.integrations.xai.video_payload import build_create_video_body
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput


class XAIVideoApiAdapter:
    """xAI 视频：POST /videos/generations 与 GET /videos/{request_id}。"""

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

        base_url = (cfg.base_url or "https://api.x.ai/v1").rstrip("/")
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }
        body = build_create_video_body(input_)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(f"{base_url}/videos/generations", headers=headers, json=body)
            r.raise_for_status()
            data: dict[str, Any] = r.json()
            request_id = str(data.get("request_id") or "")
            if not request_id:
                raise RuntimeError(f"xAI /videos/generations missing request_id: {data!r}")
            return request_id

    async def get_video(
        self,
        *,
        cfg: ProviderConfig,
        video_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        base_url = (cfg.base_url or "https://api.x.ai/v1").rstrip("/")
        headers = {"Authorization": f"Bearer {cfg.api_key}"}

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(f"{base_url}/videos/{video_id}", headers=headers)
            r.raise_for_status()
            return r.json()
