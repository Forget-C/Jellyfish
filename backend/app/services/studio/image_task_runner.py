from __future__ import annotations

import base64

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.core.contracts.generation import (
    GenerationTargetKind,
    ImageGenerationOperationInput,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.tasks import ImageGenerationTask
from app.models.llm import ModelCategoryKey, ModelConfigRevision, Provider, ProviderStatus
from app.models.task import GenerationTask
from app.models.studio import (
    ActorImage,
    AssetQualityLevel,
    AssetViewAngle,
    CharacterImage,
    CostumeImage,
    PropImage,
    SceneImage,
    ShotDetail,
    ShotFrameImage,
)
from app.models.task_links import GenerationTaskLink
from app.models.experiment_sessions import ExperimentMessage
from app.models.types import FileUsageKind
from app.services.studio.file_usages import (
    first_project_id_for_actor,
    first_project_id_for_costume,
    first_project_id_for_prop,
    first_project_id_for_scene,
    sync_usage_from_character,
    sync_usage_from_shot_context,
    upsert_file_usage,
)
from app.services.studio.shot_status import mark_shot_generating, recompute_shot_status
from app.services.studio.image_tasks import load_provider_config, resolve_image_model
from app.services.generation.files import FileResolver
from app.services.generation.publishers import AssetImagePublisher, ShotFramePublisher
from app.services.generation.runtime import ArtifactStore
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure
from app.utils.files import create_file_from_url_or_b64


class _CreateOnlyTask:
    """仅用于 TaskManager.create：提供 __class__.__name__，避免传入 lambda。"""

    async def run(self, *args: object, **kwargs: object):  # noqa: ANN001, ANN003
        return None

    async def status(self) -> dict[str, object]:
        return {}

    async def is_done(self) -> bool:
        return False

    async def get_result(self) -> object:
        return None


async def _resolve_snapshot_provider_config(
    session: AsyncSession,
    *,
    snapshot: ResolvedGenerationSnapshot,
) -> ProviderConfig:
    """按冻结图片 revision 与动态 credential_ref 构造执行期 Provider 配置。

    图片任务 payload 不保留 API key 或 endpoint；Worker 仅在执行时读取 revision
    和被其引用的 Provider，确保队列与日志中没有供应商凭据。
    """
    revision = await session.get(ModelConfigRevision, snapshot.model_revision_id)
    if revision is None or revision.model_id != snapshot.model_id or revision.category != ModelCategoryKey.image:
        raise RuntimeError("image generation model revision is unavailable")
    credential_ref = (revision.credential_ref or "").strip()
    if not credential_ref.startswith("provider:"):
        raise RuntimeError("image generation credential reference is unavailable")
    provider_id = credential_ref.removeprefix("provider:").strip()
    provider = await session.get(Provider, provider_id) if provider_id else None
    if provider is None or provider.status == ProviderStatus.disabled:
        raise RuntimeError("image generation provider is unavailable")
    api_key = (provider.api_key or "").strip()
    if not api_key:
        raise RuntimeError("image generation provider credential is unavailable")
    endpoint_config = dict(revision.endpoint_config or {})
    base_url = endpoint_config.get("image_base_url") or endpoint_config.get("base_url") or None
    return ProviderConfig(
        provider=revision.provider_key,  # type: ignore[arg-type]
        api_key=api_key,
        base_url=str(base_url).strip() or None if base_url else None,
    )


async def _resolve_snapshot_image_input(
    session: AsyncSession,
    *,
    snapshot: ResolvedGenerationSnapshot,
) -> ImageGenerationInput:
    """将安全的 ``file_id`` 参考图投影为旧 Provider adapter 的内存 Data URL。

    ``InputImageRef`` 的公共契约只允许 ``file_id``。旧 adapter 仍需要 URL 形式
    的参考图，因此这里有意使用 ``model_construct`` 创建仅在当前进程存活的兼容
    对象；媒体正文不会回写到任务 payload、Artifact 元数据或日志。
    """
    operation_input = snapshot.operation_input
    if not isinstance(operation_input, ImageGenerationOperationInput):
        raise RuntimeError("image generation snapshot operation is unavailable")
    if not snapshot.execution_prompt:
        raise RuntimeError("image generation snapshot prompt is unavailable")
    revision = await session.get(ModelConfigRevision, snapshot.model_revision_id)
    if revision is None:
        raise RuntimeError("image generation model revision is unavailable")

    references: list[InputImageRef] = []
    in_memory_image_urls: list[str] = []
    media = snapshot.media
    if media is not None:
        if not hasattr(media, "references"):
            raise RuntimeError("image generation snapshot media is invalid")
        resolver = FileResolver(session)
        for reference in media.references:
            resolved = await resolver.resolve(reference)
            content_type = resolved.content_type or "image/png"
            if not content_type.startswith("image/"):
                raise RuntimeError(f"resolved media type mismatch for file_id={reference.file_id}")
            data_url = f"data:{content_type};base64,{base64.b64encode(resolved.content).decode('ascii')}"
            # 先保留合法 file_id 通过外层 Pydantic 嵌套校验，再在返回前清空它，
            # 避免 OpenAI adapter 同时把项目 FileItem ID 当作供应商 file_id 发送。
            references.append(InputImageRef.model_construct(file_id=reference.file_id))
            in_memory_image_urls.append(data_url)

    purpose = "asset_image" if snapshot.canonical_target.kind is GenerationTargetKind.asset_image_slot else "video_reference"
    input_ = ImageGenerationInput(
        prompt=snapshot.execution_prompt,
        model=revision.model_name,
        images=references,
        target_ratio=operation_input.target_ratio,
        resolution_profile=operation_input.resolution_profile,
        purpose=purpose,
        n=operation_input.count,
    )
    for reference, data_url in zip(input_.images, in_memory_image_urls):
        reference.file_id = None  # type: ignore[assignment]
        object.__setattr__(reference, "image_url", data_url)
    return input_


async def _run_snapshot_image_generation(
    session: AsyncSession,
    *,
    task_id: str,
    snapshot_payload: dict,
) -> tuple[dict, ResolvedGenerationSnapshot]:
    """执行统一提交的图片任务，并通过 Artifact 与 CAS Publisher 发布结果。"""
    snapshot = ResolvedGenerationSnapshot.model_validate(snapshot_payload)
    provider_config = await _resolve_snapshot_provider_config(session, snapshot=snapshot)
    input_ = await _resolve_snapshot_image_input(session, snapshot=snapshot)
    provider_task = ImageGenerationTask(provider_config=provider_config, input_=input_)
    await provider_task.run()
    result = await provider_task.get_result()
    if result is None:
        status_payload = await provider_task.status()
        raise RuntimeError(str(status_payload.get("error") or "Image generation task returned no result"))
    artifacts = await ArtifactStore().store_images(
        session,
        task_id=task_id,
        result=result,
        name_prefix=f"image-{snapshot.canonical_target.entity_id}",
        storage_prefix=f"generated-images/{snapshot.canonical_target.kind.value}",
    )
    publisher = {
        GenerationTargetKind.asset_image_slot: AssetImagePublisher(),
        GenerationTargetKind.shot_frame_slot: ShotFramePublisher(),
    }.get(snapshot.canonical_target.kind)
    if publisher is None:
        raise RuntimeError("image generation snapshot target is unsupported")
    await publisher.publish_terminal(session, snapshot=snapshot, artifacts=artifacts)
    result_payload = result.model_dump()
    if artifacts:
        result_payload["file_id"] = artifacts[0].file_id
        result_payload["publish_status"] = artifacts[0].publish_status.value
    return result_payload, snapshot


async def _persist_images_to_assets(
    session: AsyncSession,
    *,
    task_id: str,
    relation_type: str,
    relation_entity_id: str,
    result: ImageGenerationResult,
) -> str | None:
    """将首张图片结果落库并返回 file_id，供实验会话恢复稳定预览。"""
    images = result.images or []
    if not images:
        return None

    item = images[0]
    if not item.url and not item.b64_json:
        return None

    file_obj = await create_file_from_url_or_b64(
        session,
        url=item.url,
        b64_data=item.b64_json,
        name=f"{relation_type}-{relation_entity_id}",
        prefix=f"generated-images/{relation_type}/{relation_entity_id}",
    )
    file_id = file_obj.id

    link_stmt = (
        select(GenerationTaskLink)
        .where(
            GenerationTaskLink.task_id == task_id,
            GenerationTaskLink.relation_type == relation_type,
            GenerationTaskLink.relation_entity_id == relation_entity_id,
        )
        .limit(1)
    )
    link_row = (await session.execute(link_stmt)).scalars().first()
    if link_row is not None:
        link_row.file_id = file_id

    if relation_type == "actor_image":
        image_row = await session.get(ActorImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            pid = await first_project_id_for_actor(session, image_row.actor_id)
            if pid:
                await upsert_file_usage(
                    session,
                    file_id=file_id,
                    project_id=pid,
                    chapter_id=None,
                    shot_id=None,
                    usage_kind=FileUsageKind.asset_image,
                    source_ref=f"actor_image:{image_row.id}",
                )
    elif relation_type == "scene_image":
        image_row = await session.get(SceneImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            pid = await first_project_id_for_scene(session, image_row.scene_id)
            if pid:
                await upsert_file_usage(
                    session,
                    file_id=file_id,
                    project_id=pid,
                    chapter_id=None,
                    shot_id=None,
                    usage_kind=FileUsageKind.asset_image,
                    source_ref=f"scene_image:{image_row.id}",
                )
    elif relation_type == "prop_image":
        image_row = await session.get(PropImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            pid = await first_project_id_for_prop(session, image_row.prop_id)
            if pid:
                await upsert_file_usage(
                    session,
                    file_id=file_id,
                    project_id=pid,
                    chapter_id=None,
                    shot_id=None,
                    usage_kind=FileUsageKind.asset_image,
                    source_ref=f"prop_image:{image_row.id}",
                )
    elif relation_type == "costume_image":
        image_row = await session.get(CostumeImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            pid = await first_project_id_for_costume(session, image_row.costume_id)
            if pid:
                await upsert_file_usage(
                    session,
                    file_id=file_id,
                    project_id=pid,
                    chapter_id=None,
                    shot_id=None,
                    usage_kind=FileUsageKind.asset_image,
                    source_ref=f"costume_image:{image_row.id}",
                )
    elif relation_type == "character_image":
        image_row = await session.get(CharacterImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            await sync_usage_from_character(
                session,
                file_id=file_id,
                character_id=image_row.character_id,
                usage_kind=FileUsageKind.character_image,
                source_ref=f"character_image:{image_row.id}",
            )
    elif relation_type == "character":
        character_id = relation_entity_id
        stmt_ci = (
            select(CharacterImage)
            .where(
                CharacterImage.character_id == character_id,
                CharacterImage.quality_level == AssetQualityLevel.low,
                CharacterImage.view_angle == AssetViewAngle.front,
            )
            .order_by(CharacterImage.id.asc())
            .limit(1)
        )
        ci = (await session.execute(stmt_ci)).scalars().first()
        if ci is not None:
            ci.file_id = file_id
            ci.format = getattr(ci, "format", "") or "png"
        else:
            ci = CharacterImage(
                character_id=character_id,
                file_id=file_id,
                quality_level=AssetQualityLevel.low,
                view_angle=AssetViewAngle.front,
                width=None,
                height=None,
                format="png",
                is_primary=True,
            )
            session.add(ci)

        if ci is not None and getattr(ci, "is_primary", False) is True and getattr(ci, "id", None) is not None:
            stmt_clear = (
                CharacterImage.__table__.update()  # type: ignore[attr-defined]
                .where(CharacterImage.character_id == character_id, CharacterImage.id != ci.id)
                .values(is_primary=False)
            )
            await session.execute(stmt_clear)
        await session.flush()
        if ci is not None:
            await sync_usage_from_character(
                session,
                file_id=file_id,
                character_id=character_id,
                usage_kind=FileUsageKind.character_image,
                source_ref=f"character_image:{ci.id}",
            )
    elif relation_type == "shot_frame_image":
        image_row = await session.get(ShotFrameImage, int(relation_entity_id))
        if image_row is not None:
            image_row.file_id = file_id
            detail = await session.get(ShotDetail, image_row.shot_detail_id)
            if detail is not None:
                await sync_usage_from_shot_context(
                    session,
                    file_id=file_id,
                    shot_id=detail.id,
                    usage_kind=FileUsageKind.shot_frame,
                    source_ref=f"shot_frame_image:{image_row.id}",
                )
    return file_id


async def _resolve_related_shot_id(
    session: AsyncSession,
    *,
    relation_type: str,
    relation_entity_id: str,
) -> str | None:
    """仅解析和镜头直接相关的生成任务。"""
    if relation_type != "shot_frame_image":
        return None
    image_row = await session.get(ShotFrameImage, int(relation_entity_id))
    if image_row is None:
        return None
    return image_row.shot_detail_id


async def create_image_task_and_link(
    *,
    db: AsyncSession,
    model_id: str | None,
    relation_type: str,
    relation_entity_id: str,
    prompt: str,
    images: list[dict[str, str]] | None = None,
    target_ratio: str | None = None,
    resolution_profile: str | None = None,
    purpose: str = "generic",
    render_context: dict | None = None,
    commit: bool = True,
    enqueue: bool = True,
) -> str:
    """创建图片生成任务，并建立任务关联。"""
    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})

    model = await resolve_image_model(db, model_id)
    provider_cfg = await load_provider_config(db, model.provider_id)

    run_args: dict = {
        "provider": provider_cfg.provider,
        "api_key": provider_cfg.api_key,
        "base_url": provider_cfg.base_url,
        "relation_type": relation_type,
        "relation_entity_id": relation_entity_id,
        "input": {
            "prompt": prompt,
            "model": model.name,
            "target_ratio": target_ratio,
            "resolution_profile": resolution_profile,
            "purpose": purpose,
        },
    }
    if images:
        run_args["input"]["images"] = images
    if render_context:
        run_args["render_context"] = render_context

    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="image_generation",
        run_args=run_args,
    )

    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="image",
            relation_type=relation_type,
            relation_entity_id=relation_entity_id,
        )
    )
    related_shot_id = await _resolve_related_shot_id(
        db,
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
    )
    if related_shot_id:
        await mark_shot_generating(db, shot_id=related_shot_id)
    if commit:
        await db.commit()
    if enqueue:
        from app.tasks.execute_task import enqueue_task_execution

        enqueue_task_execution(task_record.id)
    return task_record.id


async def run_image_generation_task(
    task_id: str,
    run_args: dict,
) -> None:
    """执行图片 Worker；统一任务只从已持久化的安全 snapshot 读取输入。

    ``run_args`` 为 Task 执行器的历史调用签名保留，但不再用于读取供应商凭据、
    endpoint、prompt 或媒体。没有 snapshot 的旧图片任务会失败，这是本阶段允许
    的短暂不可用边界，后续执行器/提交入口迁移完成后将不再产生此类任务。
    """
    del run_args

    async with async_session_maker() as session:
        try:
            store = SqlAlchemyTaskStore(session)
            await store.set_status(task_id, TaskStatus.running)
            await store.set_progress(task_id, 10)
            await session.commit()
            log_task_event("image_generation", task_id, "running")
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("image_generation", task_id, "cancelled", stage="before_execute")
                return

            task_row = await session.get(GenerationTask, task_id)
            snapshot_payload = (task_row.payload or {}).get("snapshot") if task_row is not None else None
            if not isinstance(snapshot_payload, dict):
                raise RuntimeError("image generation task snapshot is unavailable")
            result_payload, snapshot = await _run_snapshot_image_generation(
                session,
                task_id=task_id,
                snapshot_payload=snapshot_payload,
            )
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("image_generation", task_id, "cancelled", stage="after_execute")
                return

            # 归档与 CAS 发布完成后再写任务结果，避免轮询读到未发布的文件快照。
            await store.set_result(task_id, result_payload)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("image_generation", task_id, "cancelled", stage="after_persist")
                return
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            message_row = (await session.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == task_id))).scalars().first()
            if message_row is not None:
                message_row.status = "succeeded"
                message_row.payload = {**message_row.payload, "result": result_payload}
            if snapshot.canonical_target.kind is GenerationTargetKind.shot_frame_slot:
                await recompute_shot_status(session, shot_id=snapshot.canonical_target.entity_id)
            await session.commit()
            log_task_event("image_generation", task_id, "succeeded")
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
                await s2.commit()
            log_task_failure("image_generation", task_id, str(exc))
