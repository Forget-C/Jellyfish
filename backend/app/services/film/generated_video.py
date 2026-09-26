from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_maker
from app.core.task_manager import SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.tasks import VideoGenerationTask
from app.models.llm import Model, ModelCategoryKey, ModelSettings
from app.models.task_links import GenerationTaskLink
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
    """把 file_id 转成**供应商能用的图片地址**：公网地址优先，否则退化为 data URL。

    为什么优先公网地址：APIMart 的视频接口只接受 ``http(s)://`` 或 ``asset://``
    （实测 base64 data URL 会被直接 400：``Only http/https URLs or asset:// private
    asset URLs are supported``）。而库里大量图片本来就是 OSS 公网地址
    （``storage_key`` 形如 ``https://...oss...``），这种直接透传即可 ——
    既省掉下载 + base64 的开销，又让请求能被接受。

    本地存储的文件（``storage_key`` 是相对路径）仍然回退成 data URL：本机地址
    供应商抓不到，data URL 至少对 openai / volcengine 这类适配器是有效的。

    实现已抽到 ``app.utils.files.file_id_to_image_ref``（图片参考图那条路也要用同一份
    判断，不能各写一份——图片路以前就是没这个分支，把 OSS 公网地址当相对路径用）。
    """
    from app.utils.files import file_id_to_image_ref

    try:
        return await file_id_to_image_ref(db, file_id=file_id)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - 统一成 400，避免把存储层异常透出去
        raise HTTPException(status_code=400, detail=f"Invalid image file_id: {file_id}") from None


async def preview_prompt_and_images(
    db: AsyncSession,
    *,
    shot_id: str,
    reference_mode: str,
    prompt: str | None,
    images: list[str] | None = None,
) -> tuple[str, list[str], dict | None]:
    # 只为校验（镜头/时长不合法要 400/404），这里不用它的返回值。
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


def _assert_frames_vendor_acceptable(*, provider: str, frame_map: dict[ShotFrameType, str]) -> None:
    """第二层兜底：供应商不接受的参考帧引用**绝不出网**。

    与计划预检 / 集级就绪判定共用 ``app.utils.files`` 里的同一份判定：
    本机文件只能解析成 base64 data URL，而 APIMart 只接受 ``http(s)://`` / ``asset://``。
    在这里拦下，报错信息就能说清"是哪一帧、为什么、怎么修"，
    而不是让供应商 400（那会让人以为"计划说可生成、提交却失败"）。
    """
    from app.utils.files import is_vendor_accepted_ref, vendor_accepts_data_url

    if vendor_accepts_data_url(provider):
        return
    bad = [
        frame_type.value
        for frame_type, ref in frame_map.items()
        if str(ref or "").strip() and not is_vendor_accepted_ref(ref)
    ]
    if not bad:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            f"参考帧供应商无法访问：{'、'.join(bad)}。这些帧的文件是本机/相对地址，"
            "只能解析成本机 data URL，而当前视频供应商只接受 http(s):// 或 asset://。"
            "请把帧图片放到公网（OSS 等），或用 POST /api/v1/studio/files/external "
            "登记公网图片后再设为该帧；纯文本生成请改用 reference_mode=text_only。"
        ),
    )


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

    # 第二层兜底（与计划预检 / 就绪判定同一份判定）：供应商不接受的引用绝不发出去。
    _assert_frames_vendor_acceptable(provider=provider_cfg.provider, frame_map=frame_map)

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
            if not shot_id:
                raise RuntimeError("run_args missing shot_id for video persistence")

            file_obj = await persist_generated_video_to_shot(
                session,
                task_id=task_id,
                shot_id=shot_id,
                result=result,
                provider=provider,
                api_key=api_key,
            )

            result_payload = result.model_dump()
            result_payload["file_id"] = file_obj.id
            await store.set_result(task_id, result_payload)
            if await cancel_if_requested_async(store=store, task_id=task_id, session=session):
                log_task_event("video_generation", task_id, "cancelled", stage="after_persist")
                return
            await store.set_progress(task_id, 100)
            await store.set_status(task_id, TaskStatus.succeeded)
            await recompute_shot_status(session, shot_id=shot_id)
            await session.commit()
            log_task_event("video_generation", task_id, "succeeded")
        except Exception as exc:  # noqa: BLE001
            await session.rollback()
            async with async_session_maker() as s2:
                store = SqlAlchemyTaskStore(s2)
                await store.set_error(task_id, str(exc))
                await store.set_status(task_id, TaskStatus.failed)
                shot_id = str(run_args.get("shot_id") or "")
                if shot_id:
                    await recompute_shot_status(s2, shot_id=shot_id)
                await s2.commit()
            log_task_failure("video_generation", task_id, str(exc))
