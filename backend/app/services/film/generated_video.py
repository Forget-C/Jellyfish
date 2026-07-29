from __future__ import annotations

import base64
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.generation import ResolvedGenerationSnapshot
from app.core.contracts.media import VideoMediaInput
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.tasks import VideoGenerationTask
from app.models.llm import ModelCategoryKey, ModelConfigRevision, Provider, ProviderStatus
from app.models.task import GenerationTask
from app.models.experiment_sessions import ExperimentMessage
from app.services.generation.files import FileResolver
from app.services.generation.publishers import ShotVideoPublisher
from app.services.generation.runtime import ArtifactStore
from app.services.studio.shot_status import recompute_shot_status
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure


async def _resolve_snapshot_provider_config(
    session: AsyncSession,
    *,
    snapshot: ResolvedGenerationSnapshot,
) -> ProviderConfig:
    """按冻结 revision 和动态 credential_ref 构造视频 Provider 配置。

    任务 payload 不保存任何凭据或 endpoint；模型名和 endpoint 来自不可变
    revision，API key 只在 Worker 执行时通过 credential_ref 指向的 Provider 读取。
    """
    revision = await session.get(ModelConfigRevision, snapshot.model_revision_id)
    if revision is None or revision.model_id != snapshot.model_id or revision.category != ModelCategoryKey.video:
        raise RuntimeError("video generation model revision is unavailable")
    credential_ref = (revision.credential_ref or "").strip()
    if not credential_ref.startswith("provider:"):
        raise RuntimeError("video generation credential reference is unavailable")
    provider_id = credential_ref.removeprefix("provider:").strip()
    provider = await session.get(Provider, provider_id) if provider_id else None
    if provider is None or provider.status == ProviderStatus.disabled:
        raise RuntimeError("video generation provider is unavailable")
    api_key = (provider.api_key or "").strip()
    if not api_key:
        raise RuntimeError("video generation provider credential is unavailable")
    endpoint_config = dict(revision.endpoint_config or {})
    base_url = endpoint_config.get("video_base_url") or endpoint_config.get("base_url") or None
    return ProviderConfig(
        provider=revision.provider_key,  # type: ignore[arg-type]
        api_key=api_key,
        base_url=str(base_url).strip() or None if base_url else None,
    )


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
    revision = await session.get(ModelConfigRevision, snapshot.model_revision_id)
    if revision is None:
        raise RuntimeError("video generation model revision is unavailable")
    # ``model_construct`` 有意绕过已迁移到 file_id 的 API 契约：此对象仅在
    # Worker 内存中作为旧 Provider adapter 的短生命周期投影。
    return VideoGenerationInput.model_construct(
        prompt=snapshot.execution_prompt,
        model=revision.model_name,
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


async def _run_snapshot_video_generation(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot_payload: dict,
) -> dict:
    """执行 P3 提交的视频任务，并以 Artifact + CAS Publisher 完成落库。"""
    snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
    provider_config = await _resolve_snapshot_provider_config(session, snapshot=snapshot)
    input_ = await _resolve_snapshot_video_input(session, task_id=task_id, snapshot=snapshot)
    provider_task = VideoGenerationTask(provider_config=provider_config, input_=input_)
    await provider_task.run()
    raw_result = await provider_task.get_result()
    if raw_result is None:
        status_payload = await provider_task.status()
        raise RuntimeError(str(status_payload.get("error") or "Video generation task returned no result"))
    result = VideoGenerationResult.model_validate(raw_result.model_dump())
    headers = {"Authorization": f"Bearer {provider_config.api_key}"} if provider_config.provider == "openai" else None
    artifact = await ArtifactStore().store_video(
        session,
        task_id=task_id,
        result=result,
        name=f"shot-{snapshot.canonical_target.entity_id}-video",
        storage_prefix=f"generated-videos/shots/{snapshot.canonical_target.entity_id}",
        url_request_headers=headers,
        httpx_timeout=600.0,
    )
    await ShotVideoPublisher().publish_terminal(session, snapshot=snapshot, artifacts=[artifact])
    result_payload = result.model_dump()
    result_payload["file_id"] = artifact.file_id
    result_payload["publish_status"] = artifact.publish_status.value
    return result_payload

async def run_video_generation_task(
    task_id: str,
    run_args: dict,  # pylint: disable=unused-argument
) -> None:
    """执行统一编排的视频快照任务。

    ``GenerationSubmitter`` 已将可执行命令冻结到任务 payload；Worker 必须从
    snapshot 读取模型、目标和媒体，绝不能读取历史 ``run_args``，以免凭据或
    Data URL 再次进入任务持久化层。参数仅为当前异步执行器调用约定保留。
    """
    shot_id: str | None = None
    async with async_session_maker() as session:
        try:
            store = SqlAlchemyTaskStore(session)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_progress(task_id, 10)
            await session.commit()
            log_task_event("video_generation", task_id, "running")
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("video_generation", task_id, "cancelled", stage="before_execute")
                return

            task_row = await session.get(GenerationTask, task_id)
            snapshot_payload = (task_row.payload or {}).get("snapshot") if task_row is not None else None
            if not isinstance(snapshot_payload, dict):
                raise RuntimeError("video generation task requires a unified snapshot payload")
            snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
            shot_id = snapshot.canonical_target.entity_id
            result_payload = await _run_snapshot_video_generation(
                session,
                task_id=task_id,
                snapshot_payload=snapshot_payload,
            )
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("video_generation", task_id, "cancelled", stage="after_execute")
                return
            await store.set_result(task_id, result_payload)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("video_generation", task_id, "cancelled", stage="after_persist")
                return
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            message_row = (await session.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
            if message_row is not None:
                message_row.status = "succeeded"
                message_row.payload = {**message_row.payload, "result": result_payload, "progress": 100}
            if shot_id:
                await recompute_shot_status(session, shot_id=shot_id)
            await session.commit()
            log_task_event("video_generation", task_id, "succeeded")
        except Exception as exc:  # noqa: BLE001
            await session.rollback()
            async with async_session_maker() as s2:
                store = SqlAlchemyTaskStore(s2)
                await store.set_error(task_id, str(exc))
                await store.set_status(task_id, TaskStatus.failed)
                message_row = (await s2.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
                if message_row is not None:
                    message_row.status = "failed"
                    message_row.payload = {**message_row.payload, "error": str(exc)}
                if shot_id:
                    await recompute_shot_status(s2, shot_id=shot_id)
                await s2.commit()
            log_task_failure("video_generation", task_id, str(exc))
