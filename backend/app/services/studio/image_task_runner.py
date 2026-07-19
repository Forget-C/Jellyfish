from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult
from app.core.contracts.provider import ProviderConfig
from app.core.tasks import ImageGenerationTask
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


async def _persist_images_to_assets(
    session: AsyncSession,
    *,
    task_id: str,
    relation_type: str,
    relation_entity_id: str,
    result: ImageGenerationResult,
) -> None:
    """将图片生成结果落库到 FileItem 与业务图片表。"""
    images = result.images or []
    if not images:
        return

    item = images[0]
    if not item.url:
        return

    file_obj = await create_file_from_url_or_b64(
        session,
        url=item.url,
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
    await db.commit()

    from app.tasks.execute_task import enqueue_task_execution

    enqueue_task_execution(task_record.id)
    return task_record.id


async def run_image_generation_task(
    task_id: str,
    run_args: dict,
) -> None:
    relation_type = str(run_args.get("relation_type") or "")
    relation_entity_id = str(run_args.get("relation_entity_id") or "")

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

            provider = str(run_args.get("provider") or "")
            api_key = str(run_args.get("api_key") or "")
            base_url = run_args.get("base_url")
            input_dict = dict(run_args.get("input") or {})

            task = ImageGenerationTask(
                provider_config=ProviderConfig(
                    provider=provider,  # type: ignore[arg-type]
                    api_key=api_key,
                    base_url=base_url,
                ),
                input_=ImageGenerationInput.model_validate(input_dict),
            )
            await task.run()
            result = await task.get_result()
            if result is None:
                # Task adapter 会捕获供应商异常；将其保留到 GenerationTask.error，
                # 避免任务中心只看到无法定位的“无结果”兜底文案。
                task_status = await task.status()
                adapter_error = str(task_status.get("error") or "")
                raise RuntimeError(adapter_error or "Image generation task returned no result")
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("image_generation", task_id, "cancelled", stage="after_execute")
                return

            result_payload = result.model_dump()
            render_context = run_args.get("render_context")
            if isinstance(render_context, dict):
                result_payload["render_context"] = render_context
            await store.set_result(task_id, result_payload)
            await _persist_images_to_assets(
                session,
                task_id=task_id,
                relation_type=relation_type,
                relation_entity_id=relation_entity_id,
                result=result,
            )
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("image_generation", task_id, "cancelled", stage="after_persist")
                return
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            related_shot_id = await _resolve_related_shot_id(
                session,
                relation_type=relation_type,
                relation_entity_id=relation_entity_id,
            )
            if related_shot_id:
                await recompute_shot_status(session, shot_id=related_shot_id)
            await session.commit()
            log_task_event("image_generation", task_id, "succeeded")
        except Exception as exc:  # noqa: BLE001
            await session.rollback()
            async with async_session_maker() as s2:
                store = SqlAlchemyTaskStore(s2)
                await store.set_error(task_id, str(exc))
                await store.set_status(task_id, TaskStatus.failed)
                related_shot_id = await _resolve_related_shot_id(
                    s2,
                    relation_type=relation_type,
                    relation_entity_id=relation_entity_id,
                )
                if related_shot_id:
                    await recompute_shot_status(s2, shot_id=related_shot_id)
                await s2.commit()
            log_task_failure("image_generation", task_id, str(exc))
