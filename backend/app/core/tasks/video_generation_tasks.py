"""视频生成任务（Task）：对接 OpenAI Videos API 与火山方舟内容生成。

HTTP 细节在 `app.core.integrations`；本模块保留轮询节奏与 BaseTask 契约。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, AsyncIterator

from app.core.integrations.openai.video import OpenAIVideoApiAdapter
from app.core.integrations.volcengine.video import VolcengineVideoApiAdapter
from app.core.contracts.provider import ProviderConfig
from app.core.tasks.registry import resolve_task_adapter
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.task_manager.types import BaseTask

if TYPE_CHECKING:  # pragma: no cover - 仅供类型检查
    from app.core.integrations.comfyui import ComfyUIVideoApiAdapter, WorkflowMapping

__all__ = [
    "VideoGenerationInput",
    "VideoGenerationResult",
    "AbstractVideoGenerationTask",
    "OpenAIVideoGenerationTask",
    "VolcengineVideoGenerationTask",
    "ComfyUIVideoGenerationTask",
    "VideoGenerationTask",
]

#: ComfyUI 工作流缺省帧率（用于把 seconds 换算为 frames）。
_DEFAULT_FPS = 24

#: 各宽高比对应的渲染分辨率。9:16 与 EP001 的 1080×1920 输出规格一致。
_RATIO_DIMENSIONS: dict[str, tuple[int, int]] = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1": (1024, 1024),
    "4:3": (1440, 1080),
    "3:4": (1080, 1440),
    "21:9": (2560, 1080),
}


def _dimensions_for_ratio(ratio: str) -> tuple[int, int]:
    """把业务侧的宽高比解析为像素宽高。"""
    try:
        return _RATIO_DIMENSIONS[ratio]
    except KeyError as exc:  # pragma: no cover - 契约已限制取值
        raise RuntimeError(f"no dimensions configured for ratio {ratio!r}") from exc


class AbstractVideoGenerationTask(BaseTask, ABC):
    """视频生成任务基类：公共状态与 run/status/is_done/get_result。"""

    def __init__(
        self,
        *,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> None:
        self._cfg = provider_config
        self._input = input_
        self._poll_interval_s = poll_interval_s
        self._timeout_s = timeout_s
        self._provider_task_id: str | None = None
        self._result: VideoGenerationResult | None = None
        self._error: str = ""

    async def _sleep_poll(self) -> None:
        await asyncio.sleep(self._poll_interval_s)

    @abstractmethod
    async def _create_task(self) -> None:
        """发起供应商创建任务请求，并设置 self._provider_task_id。"""

    @abstractmethod
    async def _poll_and_get_result(self) -> VideoGenerationResult:
        """轮询至终态并解析为 VideoGenerationResult。"""

    async def run(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any] | None:  # type: ignore[override]
        try:
            await self._create_task()
            self._result = await self._poll_and_get_result()
            if self._result is not None:
                self._provider_task_id = self._result.provider_task_id
        except Exception as exc:  # noqa: BLE001
            self._error = str(exc)
            self._result = None
        return None

    async def status(self) -> dict[str, Any]:  # type: ignore[override]
        return {
            "task": "video_generation",
            "provider": self._cfg.provider,
            "provider_task_id": self._provider_task_id,
            "done": await self.is_done(),
            "has_result": self._result is not None,
            "error": self._error,
            "status": self._result.status if self._result else None,
        }

    async def is_done(self) -> bool:  # type: ignore[override]
        return self._result is not None or bool(self._error)

    async def get_result(self) -> VideoGenerationResult | None:  # type: ignore[override]
        return self._result


class OpenAIVideoGenerationTask(AbstractVideoGenerationTask):
    """OpenAI Videos：adapter 负责 HTTP，Task 负责轮询间隔。"""

    def __init__(
        self,
        *,
        adapter: OpenAIVideoApiAdapter | None = None,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> None:
        super().__init__(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )
        self._adapter = adapter or OpenAIVideoApiAdapter()

    async def _create_task(self) -> None:
        self._provider_task_id = await self._adapter.create_video(
            cfg=self._cfg,
            input_=self._input,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> VideoGenerationResult:
        video_id = self._provider_task_id or ""
        if not video_id:
            raise RuntimeError("OpenAI poll missing provider task id")

        base_url = (self._cfg.base_url or "https://api.openai.com/v1").rstrip("/")
        status_val = ""
        while True:
            meta = await self._adapter.get_video(
                cfg=self._cfg,
                video_id=video_id,
                timeout_s=self._timeout_s,
            )
            status_val = str(meta.get("status") or "")
            if status_val in ("completed", "failed"):
                if status_val == "failed":
                    raise RuntimeError(f"OpenAI video failed: {meta.get('error')!r}")
                break
            await self._sleep_poll()

        return VideoGenerationResult(
            url=f"{base_url}/videos/{video_id}/content",
            file_id=None,
            provider_task_id=video_id,
            provider="openai",
            status=status_val or "completed",
        )


class VolcengineVideoGenerationTask(AbstractVideoGenerationTask):
    """火山内容生成任务：adapter 负责 HTTP，Task 负责轮询。"""

    def __init__(
        self,
        *,
        adapter: VolcengineVideoApiAdapter | None = None,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> None:
        super().__init__(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )
        self._adapter = adapter or VolcengineVideoApiAdapter()

    async def _create_task(self) -> None:
        self._provider_task_id = await self._adapter.create_contents_task(
            cfg=self._cfg,
            input_=self._input,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> VideoGenerationResult:
        task_id = self._provider_task_id or ""
        if not task_id:
            raise RuntimeError("Volcengine poll missing provider task id")

        base_url = (self._cfg.base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        status_val = ""
        video_url: str | None = None
        while True:
            meta = await self._adapter.get_contents_task(
                cfg=self._cfg,
                task_id=task_id,
                timeout_s=self._timeout_s,
            )
            status_val = str(meta.get("status") or "")
            content = meta.get("content") or {}
            if isinstance(content, dict):
                vu = content.get("video_url")
                if isinstance(vu, str) and vu:
                    video_url = vu
            if status_val in ("succeeded", "failed", "cancelled"):
                if status_val != "succeeded":
                    raise RuntimeError(f"Volcengine task not succeeded: status={status_val!r} meta={meta!r}")
                break
            await self._sleep_poll()

        if not video_url:
            video_url = f"{base_url}/contents/generations/tasks/{task_id}"

        return VideoGenerationResult(
            url=video_url,
            file_id=None,
            provider_task_id=task_id,
            provider="volcengine",
            status=status_val or "succeeded",
        )


class ComfyUIVideoGenerationTask(AbstractVideoGenerationTask):
    """ComfyUI 自托管工作流：提交 prompt → 轮询 history → 定位视频产物。

    工作流与节点映射来自配置（见 ``app.core.integrations.comfyui.workflow``），
    不在代码里假设任何节点 ID。轮询受 ``timeout_s`` 约束，超时映射为结构化失败。
    """

    def __init__(
        self,
        *,
        adapter: "ComfyUIVideoApiAdapter | None" = None,
        mapping: "WorkflowMapping | None" = None,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
        workflow_mapping_path: str | None = None,
        client_id: str | None = None,
    ) -> None:
        super().__init__(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )
        from app.core.integrations.comfyui import (  # 局部导入：保持模块导入开销不变
            ComfyUIVideoApiAdapter as _Adapter,
            WorkflowConfigError,
            load_mapping,
        )

        self._adapter = adapter or _Adapter()
        self._client_id = client_id or f"jellyfish-cas-{uuid.uuid4().hex[:12]}"
        self._output: dict[str, str] | None = None
        if mapping is not None:
            self._mapping = mapping
        else:
            path = (workflow_mapping_path or "").strip()
            if not path:
                # 配置缺失必须清晰失败，绝不退化到假供应商。
                raise WorkflowConfigError(
                    "ComfyUI workflow mapping path is not configured "
                    "(set CAS_COMFYUI_WORKFLOW_MAPPING)"
                )
            self._mapping = load_mapping(path)

    def _build_workflow_values(self) -> dict[str, Any]:
        """把统一的 VideoGenerationInput 映射为工作流输入值。"""
        from app.core.integrations.video_capabilities import ALLOWED_RATIOS

        width, height = _dimensions_for_ratio(self._input.ratio)
        values: dict[str, Any] = {
            "positive_prompt": (self._input.prompt or "").strip(),
            "width": width,
            "height": height,
        }
        if self._input.seed is not None and self._input.seed >= 0:
            values["seed"] = self._input.seed
        if self._input.seconds is not None and self._input.seconds > 0:
            fps = _DEFAULT_FPS
            values["fps"] = fps
            values["frames"] = int(self._input.seconds * fps)
        if self._input.ratio not in ALLOWED_RATIOS:  # pragma: no cover - 契约已限制
            raise RuntimeError(f"unsupported ratio for ComfyUI: {self._input.ratio!r}")
        return values

    async def _create_task(self) -> None:
        from app.core.integrations.comfyui import apply_inputs

        prompt = apply_inputs(self._mapping, self._build_workflow_values())
        self._provider_task_id = await self._adapter.submit_prompt(
            cfg=self._cfg,
            prompt=prompt,
            client_id=self._client_id,
            timeout_s=self._timeout_s,
        )

    async def _poll_and_get_result(self) -> VideoGenerationResult:
        from app.core.integrations.comfyui import (
            ComfyUIError,
            extract_video_output,
            read_execution_status,
        )

        prompt_id = self._provider_task_id or ""
        if not prompt_id:
            raise ComfyUIError("ComfyUI poll missing prompt id")

        deadline = time.monotonic() + self._timeout_s
        while True:
            entry = await self._adapter.get_history(
                cfg=self._cfg, prompt_id=prompt_id, timeout_s=self._timeout_s
            )
            if entry is not None:
                status_val, message = read_execution_status(entry)
                if status_val == "error":
                    raise ComfyUIError(f"ComfyUI execution failed: {message}")
                if status_val == "success":
                    self._output = extract_video_output(entry, self._mapping.output_node)
                    break
            if time.monotonic() >= deadline:
                raise ComfyUIError(
                    f"ComfyUI render timed out after {self._timeout_s:.0f}s "
                    f"(prompt_id={prompt_id})"
                )
            await self._sleep_poll()

        return VideoGenerationResult(
            url=self._adapter.build_view_url(cfg=self._cfg, output=self._output or {}),
            file_id=None,
            provider_task_id=prompt_id,
            provider="comfyui",
            status="succeeded",
        )


class VideoGenerationTask(BaseTask):
    """按 provider 分派到 OpenAI / 火山 / ComfyUI 实现；对外构造函数签名保持不变。"""

    def __init__(
        self,
        *,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> None:
        from app.bootstrap import bootstrap_all_registries

        bootstrap_all_registries()
        factory = resolve_task_adapter("video_generation", provider_config.provider)
        self._impl: AbstractVideoGenerationTask = factory(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )  # type: ignore[assignment]

    @staticmethod
    def _build_openai_impl(
        *,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> AbstractVideoGenerationTask:
        return OpenAIVideoGenerationTask(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )

    @staticmethod
    def _build_volcengine_impl(
        *,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> AbstractVideoGenerationTask:
        return VolcengineVideoGenerationTask(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
        )

    @staticmethod
    def _build_comfyui_impl(
        *,
        provider_config: ProviderConfig,
        input_: VideoGenerationInput,
        poll_interval_s: float = 2.0,
        timeout_s: float = 120.0,
    ) -> AbstractVideoGenerationTask:
        """从设置读取工作流映射路径；缺失时由构造函数明确报错。"""
        from app.config import settings

        return ComfyUIVideoGenerationTask(
            provider_config=provider_config,
            input_=input_,
            poll_interval_s=poll_interval_s,
            timeout_s=timeout_s,
            workflow_mapping_path=getattr(settings, "cas_comfyui_workflow_mapping", None),
        )

    async def run(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any] | None:  # type: ignore[override]
        return await self._impl.run(*args, **kwargs)

    async def status(self) -> dict[str, Any]:  # type: ignore[override]
        return await self._impl.status()

    async def is_done(self) -> bool:  # type: ignore[override]
        return await self._impl.is_done()

    async def get_result(self) -> VideoGenerationResult | None:  # type: ignore[override]
        return await self._impl.get_result()
