"""ComfyUI：以其常规 HTTP API 提交工作流、查询历史、定位并取回视频产物。

约定与其他 adapter 一致：本模块只做 HTTP 与响应解析，轮询节奏由 Task 层控制。

ComfyUI 是自托管服务，通常无 API key；``ProviderConfig.base_url`` 即实例地址。
不使用浏览器自动化。
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

#: 视为「视频」的产物后缀（ComfyUI 常见视频节点输出）。
VIDEO_SUFFIXES: tuple[str, ...] = (".mp4", ".webm", ".mov", ".mkv", ".gif")

#: history 里可能承载产物列表的键（不同视频节点命名不一）。
_OUTPUT_COLLECTION_KEYS: tuple[str, ...] = ("videos", "gifs", "images", "files")


class ComfyUIError(RuntimeError):
    """ComfyUI 交互失败（结构化，供上层映射为任务失败原因）。"""


def _require_httpx():
    """延迟导入 httpx，保持与既有 adapter 相同的失败语义。"""
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover - 环境缺依赖
        raise ComfyUIError("httpx is required for ComfyUI video generation") from exc
    return httpx


def _base_url(cfg: Any) -> str:
    """取实例地址；缺失时明确报错，绝不猜测机器地址。"""
    base = (getattr(cfg, "base_url", None) or "").strip()
    if not base:
        raise ComfyUIError(
            "ComfyUI base_url is not configured; set it in the provider configuration"
        )
    return base.rstrip("/")


def is_video_filename(filename: str) -> bool:
    """按后缀判断是否为受支持的视频产物。"""
    lowered = (filename or "").lower()
    return lowered.endswith(VIDEO_SUFFIXES)


def extract_video_output(history_entry: dict[str, Any], output_node: str) -> dict[str, str]:
    """从 history 条目中定位输出节点的视频产物。

    返回 ``{"filename", "subfolder", "type"}``。
    找不到视频产物时抛 ComfyUIError —— 不允许把非视频结果当作成功。
    """
    outputs = history_entry.get("outputs")
    if not isinstance(outputs, dict):
        raise ComfyUIError("ComfyUI history entry has no 'outputs'")
    node_output = outputs.get(output_node)
    if not isinstance(node_output, dict):
        raise ComfyUIError(f"ComfyUI history has no output for node {output_node!r}")

    for key in _OUTPUT_COLLECTION_KEYS:
        items = node_output.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            filename = str(item.get("filename") or "")
            if filename and is_video_filename(filename):
                return {
                    "filename": filename,
                    "subfolder": str(item.get("subfolder") or ""),
                    "type": str(item.get("type") or "output"),
                }
    raise ComfyUIError(
        f"node {output_node!r} produced no video output "
        f"(supported suffixes: {', '.join(VIDEO_SUFFIXES)})"
    )


class ComfyUIVideoApiAdapter:
    """ComfyUI 视频工作流 HTTP。"""

    async def submit_prompt(
        self,
        *,
        cfg: Any,
        prompt: dict[str, Any],
        client_id: str,
        timeout_s: float,
    ) -> str:
        """提交工作流，返回 ``prompt_id``。"""
        httpx = _require_httpx()
        base = _base_url(cfg)
        body = {"prompt": prompt, "client_id": client_id}
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(f"{base}/prompt", json=body)
            if response.status_code >= 400:
                # ComfyUI 会在 400 里返回节点级校验错误，对诊断很有价值。
                raise ComfyUIError(
                    f"ComfyUI rejected the workflow (HTTP {response.status_code}): "
                    f"{response.text[:500]}"
                )
            data: dict[str, Any] = response.json()
        prompt_id = str(data.get("prompt_id") or "")
        if not prompt_id:
            raise ComfyUIError(f"ComfyUI /prompt returned no prompt_id: {data!r}")
        return prompt_id

    async def get_history(self, *, cfg: Any, prompt_id: str, timeout_s: float) -> dict[str, Any] | None:
        """查询某次执行的历史；尚未产生记录时返回 None（表示仍在排队/执行）。"""
        httpx = _require_httpx()
        base = _base_url(cfg)
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(f"{base}/history/{prompt_id}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data: dict[str, Any] = response.json()
        entry = data.get(prompt_id)
        return entry if isinstance(entry, dict) else None

    def build_view_url(self, *, cfg: Any, output: dict[str, str]) -> str:
        """拼出产物下载地址（``/view``）。"""
        base = _base_url(cfg)
        query = urlencode(
            {
                "filename": output.get("filename", ""),
                "subfolder": output.get("subfolder", ""),
                "type": output.get("type", "output"),
            }
        )
        return f"{base}/view?{query}"


def read_execution_status(entry: dict[str, Any]) -> tuple[str, str]:
    """把 history 条目解析为 ``(status, message)``。

    ComfyUI 的 ``status.status_str`` 常见值为 ``success`` / ``error``；
    没有该字段时按「仍在执行」处理。
    """
    status = entry.get("status")
    if not isinstance(status, dict):
        return "running", ""
    status_str = str(status.get("status_str") or "").lower()
    if status_str == "error" or status.get("completed") is False and status_str:
        messages = status.get("messages")
        detail = ""
        if isinstance(messages, list) and messages:
            detail = str(messages[-1])[:500]
        return "error", detail or "ComfyUI reported an execution error"
    if status_str == "success" or status.get("completed") is True:
        return "success", ""
    return "running", ""


__all__ = [
    "VIDEO_SUFFIXES",
    "ComfyUIError",
    "ComfyUIVideoApiAdapter",
    "extract_video_output",
    "is_video_filename",
    "read_execution_status",
]
