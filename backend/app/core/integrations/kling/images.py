"""可灵 Image 3.0 Omni 图片生成与任务解析。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, ImageItem
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.kling.task_api import create_async_task, get_image_task

_IMAGE_MODEL = "kling-v3"


class KlingImageApiAdapter:
    """封装可灵 Image 3.0 Omni 的异步创建与单任务查询。"""

    async def create_image(self, *, cfg: ProviderConfig, inp: ImageGenerationInput, timeout_s: float) -> str:
        """提交图片生成任务并返回供应商 task_id。"""
        task_id, _ = await create_async_task(
            cfg=cfg,
            path="/v1/images/generations",
            body=build_create_image_body(inp),
            timeout_s=timeout_s,
            operation="create image task",
        )
        return task_id

    async def get_creation(self, *, cfg: ProviderConfig, task_id: str, timeout_s: float) -> dict[str, Any]:
        """读取图片任务状态和成功后的 task_result.images。"""
        return await get_image_task(cfg=cfg, task_id=task_id, timeout_s=timeout_s)


def build_create_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    """将项目通用图片输入映射为可灵 Image 3.0 Omni 请求体。"""
    model = (inp.model or "").strip().lower()
    if model != _IMAGE_MODEL:
        raise ValueError("Kling image model must be kling-v3")
    body: dict[str, Any] = {"model_name": model, "prompt": inp.prompt, "n": inp.n}
    if inp.target_ratio:
        body["aspect_ratio"] = inp.target_ratio
    if inp.size:
        body["resolution"] = inp.size
    elif inp.resolution_profile:
        body["resolution"] = "2k" if inp.resolution_profile == "high" else "1k"
    if inp.watermark is not None:
        body["watermark_info"] = {"enabled": inp.watermark}
    if inp.images:
        body["image"] = _reference_image(inp)
    return body


def parse_kling_image_creation(*, task_id: str, data: dict[str, Any]) -> ImageGenerationResult:
    """将可灵成功图片任务转换为项目统一图片结果。"""
    task = data.get("data") if isinstance(data.get("data"), dict) else data
    result = task.get("task_result") if isinstance(task.get("task_result"), dict) else task
    images = [
        ImageItem(url=str(item["url"]))
        for item in (result.get("images") or [])
        if isinstance(item, dict) and item.get("url")
    ]
    if not images:
        raise RuntimeError(f"Kling image task succeeded without images: {data!r}")
    return ImageGenerationResult(
        images=images,
        provider="kling",  # type: ignore[arg-type]
        provider_task_id=task_id,
        status=str(task.get("task_status") or task.get("status") or "succeed"),
    )


def _reference_image(inp: ImageGenerationInput) -> str:
    """提取单张可灵参考图，并规范化 Base64 表示。"""
    if len(inp.images) != 1:
        raise ValueError("Kling Image 3.0 supports exactly one reference image")
    value = inp.images[0].image_url
    if not value:
        raise ValueError("Kling image references require image_url; file_id is not supported")
    marker = ";base64,"
    if value.startswith("data:") and marker in value:
        return value.split(marker, 1)[1]
    return value
