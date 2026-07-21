"""可灵视频生成与查询 API 适配器。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.kling.task_api import create_async_task, get_video_task
from app.core.integrations.kling.video_payload import build_create_video_request


class KlingVideoApiAdapter:
    """封装可灵 3.0 视频异步创建和统一任务查询调用。"""

    async def create_video(
        self, *, cfg: ProviderConfig, input_: VideoGenerationInput, timeout_s: float
    ) -> str:
        """提交模型对应的视频请求，并返回可用于轮询的 task_id。"""
        path, body = build_create_video_request(input_)
        task_id, _ = await create_async_task(
            cfg=cfg, path=path, body=body, timeout_s=timeout_s, operation="create video task"
        )
        return task_id

    async def get_creation(
        self, *, cfg: ProviderConfig, task_id: str, timeout_s: float
    ) -> dict[str, Any]:
        """读取视频任务状态和成功后的 outputs 列表。"""
        return await get_video_task(cfg=cfg, task_id=task_id, timeout_s=timeout_s)
