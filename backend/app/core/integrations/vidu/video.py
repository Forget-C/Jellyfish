"""Vidu 视频生成与任务查询 API。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.vidu.video_payload import build_create_video_request

_DEFAULT_BASE_URL = "https://api.vidu.cn"


class ViduVideoApiAdapter:
    """Vidu 视频异步任务 HTTP 适配器。"""

    async def create_video(
        self,
        *,
        cfg: ProviderConfig,
        input_: VideoGenerationInput,
        timeout_s: float,
    ) -> str:
        """提交视频任务，并返回供应商 task_id。"""
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        path, body = build_create_video_request(input_)
        base_url = (cfg.base_url or _DEFAULT_BASE_URL).rstrip("/")
        headers = {"Authorization": f"Token {cfg.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(f"{base_url}{path}", headers=headers, json=body)
            response.raise_for_status()
            data: dict[str, Any] = response.json()
        task_id = str(data.get("task_id") or "")
        if not task_id:
            raise RuntimeError(f"Vidu video creation missing task_id: {data!r}")
        return task_id

    async def get_creation(
        self,
        *,
        cfg: ProviderConfig,
        task_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        """读取视频任务状态及完成后的结果 URL。"""
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        base_url = (cfg.base_url or _DEFAULT_BASE_URL).rstrip("/")
        headers = {"Authorization": f"Token {cfg.api_key}"}
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(f"{base_url}/ent/v2/tasks/{task_id}/creations", headers=headers)
            response.raise_for_status()
            return response.json()
