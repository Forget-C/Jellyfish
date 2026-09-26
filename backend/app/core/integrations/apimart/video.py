"""APIMart 视频任务 HTTP：创建与查询。

与内置适配器的差别（实测 2026-09-17）：
  - 创建路径是 ``/videos/generations``，响应的 ``data`` 是**数组**；
  - 查询路径是 ``/tasks/{task_id}``，状态词是 ``processing / completed / failed / cancelled``；
    （不是 OpenAI 的 ``completed/failed``，也不是火山的 ``succeeded``）
  - 任务成功后视频地址在 ``data.result.videos[*]``，且是**临时链接**（有 expires_at），
    调用侧应在拿到后尽快转存。
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.apimart.video_payload import build_create_task_body

DEFAULT_BASE_URL = "https://api.apimart.ai/v1"

#: APIMart 侧的终态状态词。
TERMINAL_STATUSES = ("completed", "failed", "cancelled")


def _extract_first_url(value: Any) -> str | None:
    """从 ``str | list[str] | {"url": ...}`` 里取第一个非空 URL。

    APIMart 同一字段在不同模型下形态不一致（图片是 list，视频实测有 str），
    这里统一做宽容解析，避免因形状差异整条链路失败。
    """
    if isinstance(value, str):
        v = value.strip()
        return v or None
    if isinstance(value, (list, tuple)):
        for item in value:
            found = _extract_first_url(item)
            if found:
                return found
        return None
    if isinstance(value, dict):
        for key in ("url", "video_url", "download_url"):
            if key in value:
                found = _extract_first_url(value.get(key))
                if found:
                    return found
    return None


def extract_video_url(meta: dict[str, Any]) -> str | None:
    """从任务查询响应里取视频 URL（兼容多种字段布局）。"""
    data = meta.get("data") if isinstance(meta.get("data"), dict) else meta
    if not isinstance(data, dict):
        return None
    result = data.get("result")
    if isinstance(result, dict):
        for key in ("videos", "video", "output", "outputs"):
            if key in result:
                found = _extract_first_url(result.get(key))
                if found:
                    return found
    for key in ("video_url", "url", "output_url"):
        if key in data:
            found = _extract_first_url(data.get(key))
            if found:
                return found
    return None


def extract_error(meta: dict[str, Any]) -> str:
    """从任务查询响应里取错误描述。"""
    data = meta.get("data") if isinstance(meta.get("data"), dict) else meta
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or err)
        if err:
            return str(err)
        if data.get("message"):
            return str(data["message"])
    err = meta.get("error")
    if isinstance(err, dict):
        return str(err.get("message") or err)
    return str(err or "")


class ApimartVideoApiAdapter:
    """APIMart 视频任务 HTTP。"""

    async def create_task(
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

        base_url = (cfg.base_url or DEFAULT_BASE_URL).rstrip("/")
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }
        body = build_create_task_body(input_)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(f"{base_url}/videos/generations", headers=headers, json=body)
            r.raise_for_status()
            data: Any = r.json()

        task_id = _parse_created_task_id(data)
        if not task_id:
            raise RuntimeError(f"APIMart create missing task_id: {data!r}")
        return task_id

    async def get_task(
        self,
        *,
        cfg: ProviderConfig,
        task_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        try:
            import httpx
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from e

        base_url = (cfg.base_url or DEFAULT_BASE_URL).rstrip("/")
        headers = {"Authorization": f"Bearer {cfg.api_key}"}

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(f"{base_url}/tasks/{task_id}", headers=headers)
            r.raise_for_status()
            payload: dict[str, Any] = r.json()
        return payload


def _parse_created_task_id(data: Any) -> str | None:
    """创建响应的 ``data`` 既可能是数组也可能是对象，两种都要认。"""
    node = data.get("data") if isinstance(data, dict) and "data" in data else data
    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict):
                tid = str(item.get("task_id") or item.get("id") or "").strip()
                if tid:
                    return tid
        return None
    if isinstance(node, dict):
        tid = str(node.get("task_id") or node.get("id") or "").strip()
        return tid or None
    return None
