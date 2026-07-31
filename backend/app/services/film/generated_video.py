from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.core.contracts.media import VideoMediaInput
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.tasks import VideoGenerationTask
from app.models.llm import Model, ModelCategoryKey, Provider
from app.services.generation.files import FileResolver
from app.services.generation.runtime.delivery import validate_workflow_execution
from app.services.llm.provider_resolver import resolve_provider_config_from_provider


async def _resolve_snapshot_provider_config(
    session: AsyncSession,
    *,
    snapshot: ResolvedGenerationSnapshot,
) -> ProviderConfig:
    """在执行期读取当前视频模型与 Provider，保证使用最新配置和密钥。"""
    model = await _resolve_current_video_model(session, snapshot=snapshot)
    provider = await session.get(Provider, model.provider_id)
    if provider is None:
        raise RuntimeError("video generation provider is unavailable")
    resolved = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.video)
    return ProviderConfig(
        provider=resolved.provider_key,  # type: ignore[arg-type]
        api_key=resolved.api_key,
        base_url=resolved.base_url,
    )


async def _resolve_current_video_model(session: AsyncSession, *, snapshot: ResolvedGenerationSnapshot) -> Model:
    """解析任务指定的当前视频模型，拒绝删除或跨模态配置。"""
    model = await session.get(Model, snapshot.model_id)
    if model is None or model.category != ModelCategoryKey.video:
        raise RuntimeError("video generation model is unavailable")
    return model


async def _resolve_snapshot_video_input(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot: ResolvedGenerationSnapshot,
) -> VideoGenerationInput:
    """将安全 ``file_id`` 快照在执行期解析为旧 Provider adapter 所需的 data URL。

    Provider adapter 仍消费字符串媒体，因此只在内存中构造兼容投影；下载内容
    不会进入 GenerationTask payload、日志或 Artifact 元数据。
    """
    operation_input = snapshot.operation_input
    ratio = getattr(operation_input, "ratio", None)
    if not ratio:
        raise RuntimeError("video generation snapshot ratio is unavailable")
    media = snapshot.media
    if media is not None and not isinstance(media, VideoMediaInput):
        raise RuntimeError("video generation snapshot media must be video media")
    resolver = FileResolver(session)

    async def to_data_url(reference) -> str:  # noqa: ANN001
        resolved = await resolver.resolve_task_reference(task_id=task_id, reference=reference)
        content_type = resolved.content_type or f"{reference.media_kind}/png"
        if not content_type.startswith(f"{reference.media_kind}/"):
            raise RuntimeError(f"resolved media type mismatch for file_id={reference.file_id}")
        encoded = base64.b64encode(resolved.content).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    first_frame = last_frame = None
    key_frames: list[str] = []
    subjects: list[SimpleNamespace] = []
    if media is not None:
        first_frame = await to_data_url(media.frames.first) if media.frames.first else None
        last_frame = await to_data_url(media.frames.last) if media.frames.last else None
        key_frames = [await to_data_url(reference) for reference in media.frames.keys]
        for subject in media.subjects:
            values = [await to_data_url(reference) for reference in subject.media]
            subjects.append(
                SimpleNamespace(
                    name=subject.name,
                    images=[value for reference, value in zip(subject.media, values) if reference.media_kind == "image"],
                    videos=[value for reference, value in zip(subject.media, values) if reference.media_kind == "video"],
                )
            )
    model = await _resolve_current_video_model(session, snapshot=snapshot)
    # ``model_construct`` 有意绕过已迁移到 file_id 的 API 契约：此对象仅在
    # Worker 内存中作为旧 Provider adapter 的短生命周期投影。
    return VideoGenerationInput.model_construct(
        prompt=snapshot.execution_prompt,
        model=model.name,
        ratio=ratio,
        seconds=getattr(operation_input, "seconds", None),
        seed=getattr(operation_input, "seed", None),
        watermark=None,
        frame_references=SimpleNamespace(
            first_frame=first_frame,
            last_frame=last_frame,
            key_frames=key_frames,
        ),
        subject_references=subjects,
    )


async def execute_snapshot_video_generation(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot: ResolvedGenerationSnapshot,
    provider_task_id: str | None = None,
    on_provider_accepted: Callable[[str], Awaitable[bool]] | None = None,
) -> tuple[VideoGenerationResult, ProviderConfig]:
    """执行或恢复视频 Provider；异步任务在轮询前持久化其供应商 ID。"""
    await validate_workflow_execution(
        session,
        task_id=task_id,
        operation=GenerationOperation.video_generation,
        snapshot=snapshot,
    )
    provider_config = await _resolve_snapshot_provider_config(session, snapshot=snapshot)
    input_ = await _resolve_snapshot_video_input(session, task_id=task_id, snapshot=snapshot)
    provider_task = VideoGenerationTask(provider_config=provider_config, input_=input_)
    accepted_id = provider_task_id or await provider_task.create_provider_task()
    if accepted_id and provider_task_id is None and on_provider_accepted and not await on_provider_accepted(accepted_id):
        raise RuntimeError("generation run lost provider acceptance lease")
    result = VideoGenerationResult.model_validate((await provider_task.poll_provider_task(provider_task_id=accepted_id)).model_dump())
    return result, provider_config
