from __future__ import annotations

import base64
import mimetypes

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.db import async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.tasks import VideoGenerationTask
from app.models.llm import Model, ModelCategoryKey, ModelSettings
from app.models.task_links import GenerationTaskLink
from app.models.experiment_sessions import ExperimentMessage
from app.models.studio import FileItem, Shot, ShotDetail, ShotFrameType
from app.models.types import FileUsageKind
from app.services.common import entity_not_found
from app.services.llm.provider_resolver import resolve_provider_config_by_model
from app.services.studio.file_usages import sync_usage_from_shot_context
from app.services.studio.generation.video import (
    REQUIRED_FRAMES_BY_MODE,
    build_video_base_draft,
    build_video_context,
    build_video_submission_payload,
    validate_images_count,
)
from app.services.studio.shot_status import recompute_shot_status
from app.services.worker.async_task_support import cancel_if_requested_async
from app.services.worker.task_logging import log_task_event, log_task_failure
from app.utils.files import create_file_from_url_or_b64

async def validate_shot_and_duration(db: AsyncSession, shot_id: str) -> ShotDetail:
    shot = await db.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Shot"))
    shot_detail = await db.get(ShotDetail, shot_id)
    if shot_detail is None:
        raise HTTPException(status_code=404, detail=entity_not_found("ShotDetail"))
    if shot_detail.duration is None or shot_detail.duration <= 0:
        raise HTTPException(status_code=400, detail="Shot duration is not configured; please set shot duration first")
    return shot_detail


async def file_id_to_data_url(db: AsyncSession, *, file_id: str) -> str:
    file_obj = await db.get(FileItem, file_id)
    if file_obj is None or not file_obj.storage_key:
        raise HTTPException(status_code=400, detail=f"Invalid image file_id: {file_id}")
    try:
        content = await storage.download_file(key=file_obj.storage_key)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid image file_id: {file_id}") from None
    if not content:
        raise HTTPException(status_code=400, detail=f"Invalid image file_id: {file_id}")

    content_type: str | None = None
    try:
        info = await storage.get_file_info(key=file_obj.storage_key)
        content_type = (info.content_type or "").strip().lower() or None
    except Exception:  # noqa: BLE001
        content_type = None
    if not content_type:
        guessed_type, _ = mimetypes.guess_type(file_obj.storage_key)
        content_type = (guessed_type or "").strip().lower() or None
    if not content_type or not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Invalid image file_id: {file_id}")

    image_format = content_type.split("/", 1)[1].split(";", 1)[0].strip().lower() or "png"
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:image/{image_format};base64,{encoded}"


async def preview_prompt_and_images(
    db: AsyncSession,
    *,
    shot_id: str,
    reference_mode: str,
    prompt: str | None,
    images: list[str] | None = None,
) -> tuple[str, list[str], dict | None]:
    await validate_shot_and_duration(db, shot_id)
    base = build_video_base_draft(shot_id=shot_id, prompt=prompt)
    context = await build_video_context(
        db,
        shot_id=shot_id,
        reference_mode=reference_mode,
        images=images,
    )
    submission = await build_video_submission_payload(db, base=base, context=context)
    if not submission.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    prompt_preview_payload = submission.extra.get("prompt_preview")
    if isinstance(prompt_preview_payload, dict):
        pack = prompt_preview_payload.get("pack")
        return submission.prompt, submission.images, pack if isinstance(pack, dict) else None
    return submission.prompt, submission.images, None


async def resolve_default_video_model(db: AsyncSession) -> Model:
    settings_row = await db.get(ModelSettings, 1)
    model_id = settings_row.default_video_model_id if settings_row else None
    if not model_id:
        raise HTTPException(
            status_code=503,
            detail="No default video model configured; please set ModelSettings.default_video_model_id first",
        )
    model = await db.get(Model, model_id)
    if model is None:
        raise HTTPException(status_code=503, detail=f"Configured default video model not found: {model_id}")
    if model.category != ModelCategoryKey.video:
        raise HTTPException(
            status_code=503,
            detail=f"Configured default video model is not video category: {model_id} (category={model.category})",
        )
    return model


async def resolve_video_model_by_id(db: AsyncSession, *, model_id: str) -> Model:
    """解析实验室主动选择的视频模型，并确保类别与供应商配置可用。"""
    model = await db.get(Model, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Video model not found: {model_id}")
    if model.category != ModelCategoryKey.video:
        raise HTTPException(status_code=400, detail=f"Configured model is not video category: {model_id}")
    return model


async def load_provider_config_by_model(db: AsyncSession, model: Model) -> ProviderConfig:
    resolved = await resolve_provider_config_by_model(db, model=model)
    return ProviderConfig(
        provider=resolved.provider_key,  # type: ignore[arg-type]
        api_key=resolved.api_key,
        base_url=resolved.base_url,
    )


def _normalize_optional_text(value: str | None) -> str | None:
    """归一化可选文本参数：空字符串视为未设置。"""
    normalized = (value or "").strip()
    return normalized or None


async def resolve_effective_video_options(
    requested_ratio: str | None,
) -> str:
    """解析视频比例：请求参数为唯一主参数。"""
    req_ratio = _normalize_optional_text(requested_ratio)
    if not req_ratio:
        raise HTTPException(status_code=400, detail="ratio is required")
    return req_ratio


async def build_run_args(
    db: AsyncSession,
    *,
    shot_id: str,
    reference_mode: str,
    prompt: str | None,
    images: list[str],
    ratio: str | None,
) -> dict:
    model = await resolve_default_video_model(db)
    provider_cfg = await load_provider_config_by_model(db, model)
    shot_detail = await validate_shot_and_duration(db, shot_id)
    resolved_ratio = await resolve_effective_video_options(requested_ratio=ratio)
    base = build_video_base_draft(shot_id=shot_id, prompt=prompt)
    context = await build_video_context(
        db,
        shot_id=shot_id,
        reference_mode=reference_mode,
        images=images,
    )
    submission = await build_video_submission_payload(db, base=base, context=context)
    validate_images_count(reference_mode, submission.images)

    final_prompt = submission.prompt.strip()
    if not final_prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    required_frames = tuple(ShotFrameType(item) for item in REQUIRED_FRAMES_BY_MODE[reference_mode])
    frame_data_urls = [await file_id_to_data_url(db, file_id=file_id) for file_id in submission.images]
    frame_map = {ft: frame_data_urls[i] for i, ft in enumerate(required_frames)}

    run_args = {
        "shot_id": shot_id,
        "provider": provider_cfg.provider,
        "api_key": provider_cfg.api_key,
        "base_url": provider_cfg.base_url,
        "input": {
            "prompt": final_prompt,
            "first_frame_base64": frame_map.get(ShotFrameType.first),
            "last_frame_base64": frame_map.get(ShotFrameType.last),
            "key_frame_base64": frame_map.get(ShotFrameType.key),
            "model": model.name,
            "ratio": resolved_ratio,
            "seconds": shot_detail.duration,
        },
    }
    prompt_preview_payload = submission.extra.get("prompt_preview")
    if isinstance(prompt_preview_payload, dict):
        run_args["prompt_preview"] = prompt_preview_payload
    return run_args


async def build_video_lab_run_args(
    db: AsyncSession,
    *,
    model_id: str,
    prompt: str,
    ratio: str,
    first_frame_file_id: str | None,
    last_frame_file_id: str | None,
    key_frame_file_id: str | None,
) -> dict:
    """为独立视频实验构建可异步执行的供应商输入，不读取或修改镜头数据。"""
    model = await resolve_video_model_by_id(db, model_id=model_id)
    provider_cfg = await load_provider_config_by_model(db, model)
    resolved_ratio = await resolve_effective_video_options(requested_ratio=ratio)
    frame_ids = {
        "first_frame_base64": first_frame_file_id,
        "last_frame_base64": last_frame_file_id,
        "key_frame_base64": key_frame_file_id,
    }
    input_payload = {
        "prompt": prompt.strip(),
        "model": model.name,
        "ratio": resolved_ratio,
    }
    for field_name, file_id in frame_ids.items():
        if file_id:
            input_payload[field_name] = await file_id_to_data_url(db, file_id=file_id)
    VideoGenerationInput.model_validate(input_payload)
    return {
        "source": "video_lab",
        "provider": provider_cfg.provider,
        "api_key": provider_cfg.api_key,
        "base_url": provider_cfg.base_url,
        "input": input_payload,
    }


async def persist_generated_video_to_shot(
    session: AsyncSession,
    *,
    task_id: str,
    shot_id: str,
    result: VideoGenerationResult,
    provider: str,
    api_key: str,
) -> FileItem:
    url = (result.url or "").strip()
    if not url:
        raise RuntimeError("Video generation result has no download url")

    url_headers: dict[str, str] | None = None
    if provider == "openai":
        url_headers = {"Authorization": f"Bearer {api_key}"}

    file_obj = await create_file_from_url_or_b64(
        session,
        url=url,
        name=f"shot-{shot_id}-video",
        prefix=f"generated-videos/shots/{shot_id}",
        url_request_headers=url_headers,
        httpx_timeout=600.0,
    )

    link_stmt = (
        select(GenerationTaskLink)
        .where(
            GenerationTaskLink.task_id == task_id,
            GenerationTaskLink.resource_type == "video",
            GenerationTaskLink.relation_type == "video",
            GenerationTaskLink.relation_entity_id == shot_id,
        )
        .limit(1)
    )
    link_row = (await session.execute(link_stmt)).scalars().first()
    if link_row is not None:
        link_row.file_id = file_obj.id

    shot = await session.get(Shot, shot_id)
    if shot is not None:
        shot.generated_video_file_id = file_obj.id

    await sync_usage_from_shot_context(
        session,
        file_id=file_obj.id,
        shot_id=shot_id,
        usage_kind=FileUsageKind.generated_video,
        source_ref=f"shot:{shot_id}:generated_video",
    )

    return file_obj


async def persist_generated_video_to_library(
    session: AsyncSession,
    *,
    task_id: str,
    result: VideoGenerationResult,
    provider: str,
    api_key: str,
) -> FileItem:
    """将实验室视频写入全局资料库，并更新其任务关联记录。"""
    url = (result.url or "").strip()
    if not url:
        raise RuntimeError("Video generation result has no download url")
    url_headers = {"Authorization": f"Bearer {api_key}"} if provider == "openai" else None
    file_obj = await create_file_from_url_or_b64(
        session,
        url=url,
        name=f"video-lab-{task_id}",
        prefix="generated-videos/video-lab",
        url_request_headers=url_headers,
        httpx_timeout=600.0,
    )
    link_stmt = (
        select(GenerationTaskLink)
        .where(
            GenerationTaskLink.task_id == task_id,
            GenerationTaskLink.resource_type == "video",
            GenerationTaskLink.relation_type == "video_lab",
        )
        .limit(1)
    )
    link_row = (await session.execute(link_stmt)).scalars().first()
    if link_row is not None:
        link_row.file_id = file_obj.id
    return file_obj


async def run_video_generation_task(
    task_id: str,
    run_args: dict,
) -> None:
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

            provider = str(run_args.get("provider") or "")
            api_key = str(run_args.get("api_key") or "")
            base_url = run_args.get("base_url")
            input_dict = dict(run_args.get("input") or {})

            task = VideoGenerationTask(
                provider_config=ProviderConfig(
                    provider=provider,  # type: ignore[arg-type]
                    api_key=api_key,
                    base_url=base_url,
                ),
                input_=VideoGenerationInput.model_validate(input_dict),
            )
            await task.run()
            result = await task.get_result()
            if result is None:
                status_dict = await task.status()
                detailed_error = ""
                if isinstance(status_dict, dict):
                    detailed_error = str(status_dict.get("error") or "")
                msg = detailed_error or "Video generation task returned no result"
                raise RuntimeError(msg)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("video_generation", task_id, "cancelled", stage="after_execute")
                return

            shot_id = str(run_args.get("shot_id") or "")
            if shot_id:
                file_obj = await persist_generated_video_to_shot(
                    session,
                    task_id=task_id,
                    shot_id=shot_id,
                    result=result,
                    provider=provider,
                    api_key=api_key,
                )
            elif run_args.get("source") == "video_lab":
                file_obj = await persist_generated_video_to_library(
                    session,
                    task_id=task_id,
                    result=result,
                    provider=provider,
                    api_key=api_key,
                )
            else:
                raise RuntimeError("run_args missing video generation source")

            result_payload = result.model_dump()
            result_payload["file_id"] = file_obj.id
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
                shot_id = str(run_args.get("shot_id") or "")
                if shot_id:
                    await recompute_shot_status(s2, shot_id=shot_id)
                await s2.commit()
            log_task_failure("video_generation", task_id, str(exc))
