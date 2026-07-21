"""可灵异步任务的跨模态调用辅助。"""

from __future__ import annotations

from typing import Any, Literal

from app.core.contracts.provider import ProviderConfig
from app.core.integrations.kling.client import KlingClient

KlingVideoState = Literal["submitted", "processing", "succeeded", "failed", "unknown"]
KlingImageState = Literal["submitted", "processing", "succeeded", "failed", "unknown"]


async def create_async_task(
    *, cfg: ProviderConfig, path: str, body: dict[str, Any], timeout_s: float, operation: str
) -> tuple[str, dict[str, Any]]:
    """提交异步创建请求，并从不同可灵响应封装中提取任务 ID。"""
    data = await KlingClient(cfg=cfg, timeout_s=timeout_s).post(path=path, body=body, operation=operation)
    task_id = extract_task_id(data)
    if not task_id:
        raise RuntimeError(f"Kling {operation} missing task id: {data!r}")
    return task_id, data


async def get_video_task(*, cfg: ProviderConfig, task_id: str, timeout_s: float) -> dict[str, Any]:
    """查询视频任务；可灵视频 API 通过 task_ids 查询单个任务。"""
    return await KlingClient(cfg=cfg, timeout_s=timeout_s).get(
        path="/tasks", params={"task_ids": task_id}, operation="get video task"
    )


async def get_image_task(*, cfg: ProviderConfig, task_id: str, timeout_s: float) -> dict[str, Any]:
    """查询图片任务；图片 API 使用资源式单任务路径。"""
    return await KlingClient(cfg=cfg, timeout_s=timeout_s).get(
        path=f"/v1/images/generations/{task_id}", params=None, operation="get image task"
    )


def extract_task_id(data: dict[str, Any]) -> str | None:
    """兼容顶层、data 与 task 嵌套响应，提取供应商任务 ID。"""
    for container in (data, data.get("data"), data.get("task")):
        if not isinstance(container, dict):
            continue
        for key in ("task_id", "taskId", "id"):
            value = container.get(key)
            if value:
                return str(value)
    return None


def unwrap_video_task(data: dict[str, Any]) -> dict[str, Any]:
    """从视频列表或单对象响应中提取单一任务对象。"""
    for container in (data, data.get("data")):
        if isinstance(container, list) and container and isinstance(container[0], dict):
            return container[0]
        if not isinstance(container, dict):
            continue
        for key in ("tasks", "task"):
            value = container.get(key)
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return value[0]
            if isinstance(value, dict):
                return value
    return data


def normalize_video_state(data: dict[str, Any]) -> KlingVideoState:
    """将可灵视频状态收敛为任务层可判断的有限状态集合。"""
    state = str(unwrap_video_task(data).get("status") or "").lower()
    if state in {"submitted", "processing", "succeeded", "failed"}:
        return state  # type: ignore[return-value]
    return "unknown"


def normalize_image_state(data: dict[str, Any]) -> KlingImageState:
    """将图片接口的 succeed/succeeded 等状态收敛为统一状态。"""
    task = data.get("data") if isinstance(data.get("data"), dict) else data
    state = str(task.get("task_status") or task.get("status") or task.get("state") or "").lower()
    if state in {"succeed", "succeeded", "success"}:
        return "succeeded"
    if state in {"failed", "fail"}:
        return "failed"
    if state in {"submitted", "processing", "pending", "running"}:
        return "submitted" if state == "submitted" else "processing"
    return "unknown"
