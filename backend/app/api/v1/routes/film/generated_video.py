from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.dependencies import get_db
from app.models.task_links import GenerationTaskLink
from app.schemas.studio.image_pipeline import VideoAudioPlanRead
from app.schemas.studio.shots import ShotVideoPromptPackRead
from app.services.film.generated_video import build_run_args, preview_prompt_and_images
from app.services.paid_outlet_guard import require_video_outlet
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.video_submit import (
    describe_legacy_video_audio,
    preflight_video_input_media,
    validate_legacy_video_input,
)
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.video_audio_input import attach_shot_audio_to_video_input
from app.services.studio.shot_status import mark_shot_generating
from app.tasks.execute_task import (
    enqueue_task_execution,
    run_task_celery,
    spawn_inline_task_execution,
)
from app.schemas.common import ApiResponse, created_response, success_response

from .common import TaskCreated, _CreateOnlyTask
from .video_request import VideoGenerationTaskRequest

logger = logging.getLogger(__name__)

router = APIRouter()


async def _run_legacy_video_inline(task_id: str, _run_args: dict[str, Any]) -> None:
    """legacy 出视频任务的**同进程内联**执行体。

    复用**同一个**任务执行器（`run_task_celery` → `task_executor_registry.resolve(task_kind)`），
    所以状态 / 进度 / 结果 / 取消接口全部照旧，只是不再要求本机有 broker + worker
    （本机两者都没有：无条件入队的结果是真实模式下 500 或永久 pending）。
    """
    await asyncio.to_thread(run_task_celery, task_id)


def _preflight_blocked_envelope(exc: reference_preflight.ReferencePreflightBlocked) -> JSONResponse:
    """参考图不可达 → 409 + 结构化中文错误（明细放 ``meta.error``）。

    为什么要在这层自己造信封：应用级 ``HTTPException`` 处理器只留一行 ``message``
    （``meta`` 恒为 null），而页面要读到 ``code`` / ``unreachable[]``（哪张图、真实 HTTP
    状态码）/ ``how_to_fix`` / ``paid_call_made`` 才能说清"为什么没提交、怎么修"。
    与出图管线 ``routes/studio/image_pipeline.py`` 的 ``_error_envelope`` 同一口径
    （同一份 ``detail`` 由 ``reference_preflight.build_blocked_detail`` 生产，不另写文案）。
    """
    detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
    status_code = reference_preflight.BLOCKED_STATUS_CODE
    body = ApiResponse[None](
        code=status_code,
        message=str(detail.get("message") or reference_preflight.UNREACHABLE_ERROR_CODE),
        data=None,
        meta={"error": detail},
    ).model_dump()
    return JSONResponse(status_code=status_code, content=body)


class VideoPromptPreviewResponse(BaseModel):
    prompt: str = Field(..., description="最终用于视频生成的提示词")
    images: list[str] = Field(default_factory=list, description="关联参考图 file_id 列表")
    pack: ShotVideoPromptPackRead | None = Field(None, description="视频提示词预览上下文包")
    audio: VideoAudioPlanRead | None = Field(
        None,
        description=(
            "参考音频审计（只增字段）：included / file_id / url / excluded_reason —— "
            "本次请求是否携带音频、带的是哪个地址、没带是为什么（口径与直提出视频同一份实现）"
        ),
    )
    audio_warnings: list[str] = Field(
        default_factory=list, description="参考音频相关的提示（未携带时的原因 + 修法）"
    )


@router.post(
    "/tasks/video/preview-prompt",
    response_model=ApiResponse[VideoPromptPreviewResponse],
    status_code=200,
    summary="视频提示词预览",
)
async def preview_video_generation_prompt(
    body: VideoGenerationTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[VideoPromptPreviewResponse]:
    """预览视频生成的提示词与自动关联参考图。

    同时给出**参考音频审计**：这条镜头绑定的声音会不会进请求、带的是哪个地址、没带是为什么。
    术语澄清：这里说的永远是"**参考音频**"（作为输入），与"最终成片的音轨"是两件事。
    """
    prompt, images, pack = await preview_prompt_and_images(
        db,
        shot_id=body.shot_id,
        reference_mode=body.reference_mode,
        prompt=body.prompt,
        images=body.images,
    )
    audio, audio_warnings = await describe_legacy_video_audio(db, shot_id=body.shot_id)
    return success_response(
        VideoPromptPreviewResponse(
            prompt=prompt,
            images=images,
            pack=pack,
            audio=VideoAudioPlanRead(**dict(audio["audio"])) if audio.get("audio") else None,
            audio_warnings=audio_warnings,
        )
    )


@router.post(
    "/tasks/video",
    response_model=ApiResponse[TaskCreated],
    status_code=201,
    summary="视频生成（任务版）",
    dependencies=[Depends(require_video_outlet)],
)
async def create_video_generation_task(
    body: VideoGenerationTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TaskCreated]:
    """创建视频生成任务并后台执行，结果通过 /tasks/{task_id}/result 获取。

    会真实出视频（按次计费），因此先过 DRY_RUN 守卫：被拦截时返回 409，
    **不会**建任何任务行。
    """

    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})
    run_args = await build_run_args(
        db,
        shot_id=body.shot_id,
        reference_mode=body.reference_mode,
        prompt=body.prompt,
        images=body.images,
        ratio=body.ratio,
    )

    # 入参预检（建任务之前）：这条路径此前完全不做选项校验，而本项目镜头时长普遍是
    # 3–4s，低于 seedance-2.0-mini 的 min_seconds=5 —— 表现是"任务建出来、真花钱发出去、
    # 然后被供应商拒绝"。这里提前钳到最短时长/补上固定分辨率，或直接 422 拒绝。
    video_input = run_args.get("input") if isinstance(run_args.get("input"), dict) else None
    option_warnings: list[str] = []
    if video_input is None:
        # build_run_args 正常一定带 input；缺失说明上游被替换成了不完整实现，
        # 这里记一条 warning 而不是静默放过（任务执行阶段本来也会失败）。
        logger.warning("视频生成入参缺少 input 段，跳过预检：keys=%s", sorted(run_args.keys()))
    else:
        try:
            option_warnings = validate_legacy_video_input(video_input)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        for item in option_warnings:
            logger.warning("视频生成入参已自动修正：%s", item)

        # 断点④的声音侧：把镜头绑定的声音解析进生成入参。
        # 供应商支持音频输入时适配器会真的发出去；不支持时字段仍留在入参里（可追溯）
        # 并附一条明确提示，不做静默丢弃。
        try:
            audio_warnings = await attach_shot_audio_to_video_input(
                db,
                shot_id=body.shot_id,
                input_payload=video_input,
                provider=str(run_args.get("provider") or ""),
                model=str(video_input.get("model") or ""),
            )
        except Exception as exc:  # noqa: BLE001 - 声音是尽力而为的输入，绝不允许阻断出视频
            audio_warnings = [f"声音绑定解析失败（{exc}），本次生成不携带音频。"]
            logger.warning("视频生成声音入参解析失败：%s", exc)
        option_warnings.extend(audio_warnings)
        for item in audio_warnings:
            logger.info("视频生成音频入参：%s", item)

        # 提交前**匿名可达性**预检（建任务 / 写 generation_tasks 之前）：
        # 与直提出视频端点 `POST /studio/image-pipeline/video-submit` 复用**同一套**
        # 候选抽取（`video_media_candidates`）+ 探活（`reference_preflight.preflight_or_raise`）。
        #
        # 为什么 legacy 也要有：本模块此前只有形态级校验（地址形状能不能给上游），
        # 不做匿名探活 —— 本机相对路径 / 内网地址 / 404 的对象照样被当成可用参考图发出去，
        # 上游匿名抓不到 → 任务建出来再 failed（故障 A 原文「无法获取输入媒体 URL（404/410）」）。
        # 探活不通过就整单拒绝：**不建任务、不写库、不出网给上游**（也就不会花钱）。
        #
        # DRY_RUN 下一次都不探活（与 dry_run 守卫同口径：演练模式不触网）。
        if not dry_run.dry_run_enabled():
            try:
                await preflight_video_input_media(
                    video_input,
                    provider=str(run_args.get("provider") or ""),
                    hint=f"legacy 出视频 shot_id={body.shot_id}",
                )
            except reference_preflight.ReferencePreflightBlocked as exc:
                logger.warning("出视频参考图不可达，已拒绝建任务：%s", exc.detail)
                return _preflight_blocked_envelope(exc)
        else:
            logger.info("DRY_RUN 开启：跳过出视频参考图可达性预检（不触网）。")

    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind="video_generation",
        run_args=run_args,
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="video",
            relation_type="video",
            relation_entity_id=body.shot_id,
        )
    )
    await mark_shot_generating(db, shot_id=body.shot_id)

    # 确保任务记录已提交，避免后台 runner 新 session 查询不到任务行而无法更新状态。
    await db.commit()

    # 派发口径与「AI 首帧提示词」那条一致：**优先同进程内联执行**，
    # 只有拿不到运行中的事件循环（同步脚本调用等）才退回 Celery 队列。
    scheduled = spawn_inline_task_execution(
        task_record.id,
        runner=_run_legacy_video_inline,
        run_args=run_args,
        detail=f"legacy 出视频 shot_id={body.shot_id}",
    )
    if not scheduled:
        enqueue_task_execution(task_record.id)
    # 音频审计放在**预览端点**（`/tasks/video/preview-prompt` 的 `audio` 字段）与直提出视频的
    # 计划端点里；这里只回显生成入参修正与音频提示，保持既有响应形状不变。
    return created_response(
        TaskCreated(task_id=task_record.id),
        meta={"video_option_warnings": option_warnings} if option_warnings else None,
    )
