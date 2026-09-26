"""P3 直提出视频：计划预览（不触网）+ 受守卫的同步提交。

复用既有链路（不新建 provider 适配器、不动核心文件、不加表）：
- 计划预览：``preview_prompt_and_images``（只做本地组装，不发任何请求）；
- 真实提交：``build_run_args`` → ``VideoGenerationTask``（``app/core/tasks/video_generation_tasks.py``），
  在**同步请求-响应**里 await 完成，不用 Celery / 不用后台队列。

风险与既定处理（来自既有实现的三个坑）：
1. ``VideoGenerationTask`` 会把异常吞进 ``status()["error"]``，``get_result()`` 返回 None
   → 必须显式检查，否则会把失败当成功。
2. ``timeout_s`` 只作用于单次 HTTP 请求，没有墙钟上限 → 这里用 ``asyncio.wait_for`` 自己兜底。
3. provider 白名单是封闭的（openai / volcengine / apimart），其它键会 ValueError
   → 预览阶段就如实标注，避免提交时才炸。

**默认 DRY_RUN：本模块的真实提交路径默认被守卫拦截，不会产生任何费用。**
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import Model, ModelCategoryKey
from app.schemas.studio.image_pipeline import (
    VideoAudioPlanRead,
    VideoPlanFrameRead,
    VideoSubmitPlanRead,
    VideoSubmitPlanRequest,
    VideoSubmitRead,
)
from app.services.film import (
    REQUIRED_FRAMES_BY_MODE,
    load_provider_config_by_model,
    resolve_default_video_model,
)
from app.services.film.generated_video import preview_prompt_and_images
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.registry import ALLOWED_DURATION_SECONDS
from app.utils.files import vendor_accepts_data_url

logger = logging.getLogger(__name__)

# 既有 provider 适配器白名单（见 app/core/tasks/bootstrap.py）。
SUPPORTED_VIDEO_PROVIDERS: tuple[str, ...] = ("openai", "volcengine", "apimart")

DEFAULT_TIMEOUT_SECONDS = 120.0

# ---------------------------------------------------------------------------
# 固定模型策略
# ---------------------------------------------------------------------------
# 用户明确指定：出视频**只用** seedance-2.0-mini + 480p，且测试只出最短时长。
# 这里做成"代码层默认 + 环境变量可覆盖"，避免换个环境就被 ModelSettings 默认值带走。
# 依据：app/core/integrations/apimart/video_capabilities.py 的 _SEEDANCE_20_LITE
#   min_seconds=5 / max_seconds=15 / allowed_resolutions={480p,720p} / default_resolution=480p
VIDEO_MODEL_ENV = "JELLYFISH_VIDEO_MODEL"
VIDEO_RESOLUTION_ENV = "JELLYFISH_VIDEO_RESOLUTION"
PINNED_VIDEO_MODEL = "seedance-2.0-mini"
PINNED_VIDEO_RESOLUTION = "480p"
MIN_VIDEO_SECONDS = 5
DEFAULT_VIDEO_RATIO = "16:9"


def pinned_video_model() -> str:
    """固定视频模型名（默认 seedance-2.0-mini）。"""
    return (os.environ.get(VIDEO_MODEL_ENV) or "").strip() or PINNED_VIDEO_MODEL


def pinned_video_resolution() -> str:
    """固定分辨率（默认 480p，mini 支持的最低档）。"""
    return (os.environ.get(VIDEO_RESOLUTION_ENV) or "").strip() or PINNED_VIDEO_RESOLUTION


def _mask_provider(config: Any) -> dict[str, Any]:
    """只暴露可公开字段，绝不返回 api_key。"""
    return {
        "provider": str(getattr(config, "provider", "") or ""),
        "base_url": str(getattr(config, "base_url", "") or ""),
        "api_key_configured": bool(getattr(config, "api_key", "")),
    }


async def resolve_pinned_video_model(db: AsyncSession) -> tuple[Model, list[str]]:
    """按固定模型名解析 Model；查不到才退回 ModelSettings 默认并记 warning。"""
    warnings: list[str] = []
    name = pinned_video_model()
    stmt = (
        select(Model)
        .where(Model.category == ModelCategoryKey.video, Model.name == name)
        .order_by(Model.updated_at.desc())
        .limit(1)
    )
    model = (await db.execute(stmt)).scalars().first()
    if model is None:
        fallback = await resolve_default_video_model(db)
        warnings.append(
            f"模型表里没有短视频模型「{name}」，已退回默认视频模型「{fallback.name}」；"
            f"请确认 {VIDEO_MODEL_ENV} 或模型配置。"
        )
        return fallback, warnings
    return model, warnings


async def describe_plan_frames(
    db: AsyncSession,
    *,
    shot_id: str,
    reference_mode: str,
    file_ids: list[str],
    vendor: str = "apimart",
) -> tuple[list[VideoPlanFrameRead], list[str], list[str]]:
    """把本次请求真正带上的帧解析出来，并算出**供应商口径**的可用性。

    为什么必须有这一步：页面以前把「绑定资产定版图」当成"视频实际使用的参考图"，
    但真正发给模型的是 `shot_frame_images` 里对应模式的帧文件（首帧/尾帧/关键帧）；
    两者是**上下游**关系，混在一起会让用户以为换绑定图就能改变生成请求。

    返回 ``(rows, missing, unusable)``：

    - ``missing``：槽位里**没有 file_id**（还没上传/生成）；
    - ``unusable``：有 file_id 但**供应商取不到**（本地相对地址只能变 data URL，
      而 APIMart 只收 http(s):// / asset://）。

    两者都要阻止生成 —— "有 file_id 就算可用"正是 2026-09-19 真实提交暴露的判定错误。
    这里用的 ``resolve_vendor_image_ref`` 与集级就绪接口、提交前校验**是同一份实现**。
    """
    from app.core import storage
    from app.models.studio import ShotFrameImage
    from app.utils.files import resolve_vendor_image_ref

    required = [str(item.value if hasattr(item, "value") else item) for item in REQUIRED_FRAMES_BY_MODE.get(reference_mode, ())]
    slots = (
        await db.execute(select(ShotFrameImage).where(ShotFrameImage.shot_detail_id == shot_id))
    ).scalars().all()
    by_type = {str(slot.frame_type.value if hasattr(slot.frame_type, "value") else slot.frame_type): slot for slot in slots}

    rows: list[VideoPlanFrameRead] = []
    missing: list[str] = []
    unusable: list[str] = []
    for index, frame_type in enumerate(required):
        slot = by_type.get(frame_type)
        file_id = str(getattr(slot, "file_id", "") or "") if slot is not None else ""
        if not file_id:
            missing.append(frame_type)
            rows.append(
                VideoPlanFrameRead(
                    role=frame_type,
                    frame_type=frame_type,
                    usable=False,
                    ref_kind="missing",
                    reason="该帧槽位没有 file_id：请先上传或生成该帧。",
                )
            )
            continue

        outcome = await resolve_vendor_image_ref(db, file_id=file_id, vendor=vendor)

        # 展示地址：公网地址原样；本地文件给一个可打开的下载路由（仅供页面预检，
        # 不参与打给供应商的入参 —— 入参用的是 outcome.ref）。
        url = ""
        if outcome.kind == "public":
            url = outcome.storage_key
        else:
            try:
                info = await storage.get_file_info(key=outcome.storage_key)
                url = str(getattr(info, "url", "") or "")
            except Exception:  # noqa: BLE001 - 展示地址取不到不影响计划本身
                url = ""
            if not url:
                url = f"/api/v1/studio/files/{file_id}/download"

        if not outcome.vendor_usable:
            unusable.append(frame_type)
        rows.append(
            VideoPlanFrameRead(
                role=frame_type,
                frame_type=frame_type,
                file_id=file_id,
                url=url,
                usable=outcome.vendor_usable,
                ref_kind=outcome.kind,
                reason="" if outcome.vendor_usable else (outcome.reason or f"参考帧「{frame_type}」供应商无法访问。"),
            )
        )
        _ = index
    return rows, missing, unusable


async def describe_plan_audio(
    db: AsyncSession,
    *,
    shot_id: str,
    provider: str,
    model: str,
) -> dict[str, Any]:
    """本次请求的音频准入结论（**与提交端是同一个函数**，不再是两份判断）。

    以前这里自己写了一遍"是不是公网前缀"（``is_public_storage_key``），而提交端
    （``video_audio_input``）另写了一遍 ``startswith("http")`` —— 两处口径不同，
    于是 ``asset://`` 与内网地址（``http://192.168.x/…``）会出现"页面说能带、提交却剔除"
    或反过来的自相矛盾。现在统一走
    ``video_audio_input.resolve_audio_admission`` → ``classify_audio_input``。

    返回的 ``audio`` 是给计划/预览用的**审计结构**（``included`` / ``file_id`` / ``url`` /
    ``excluded_reason``），``audio_state`` 保留既有四个取值（bound / bound_not_public /
    missing / opt_out）以兼容页面既有显示。
    """
    from app.services.studio.video_audio_input import (
        plan_audio_state,
        resolve_audio_admission,
    )

    admission = await resolve_audio_admission(
        db, shot_id=shot_id, provider=provider, model=model
    )
    return {
        "audio_file_id": admission.file_id,
        # 只有**会进请求**的地址才填这里（公网 http(s) / asset:// / 供应商接受的 data URL）
        "audio_url": admission.url,
        "audio_opt_out": admission.opt_out,
        "audio_state": plan_audio_state(admission),
        "audio": admission.to_read(),
        "note": admission.note if admission.file_id else "",
    }


async def describe_legacy_video_audio(db: AsyncSession, *, shot_id: str) -> tuple[dict[str, Any], list[str]]:
    """legacy 出视频入口（``/film/tasks/video``）的音频审计：``(audio 审计结构, 提示列表)``。

    供应商/模型按**该路径真实使用**的默认视频模型解析（``build_run_args`` 用的就是
    ``resolve_default_video_model``），所以这份审计与 legacy 提交时的判定同源 ——
    不会出现"预览说能带、提交却剔除"。判定本身复用直提路径的
    :func:`describe_plan_audio`（→ ``video_audio_input.classify_audio_input``）。

    解析失败时**不抛**：预览端点不该因为"没配默认视频模型"就挂掉，此时返回 ``None`` 审计
    与一条如实说明的提示。
    """
    from app.services.film import load_provider_config_by_model, resolve_default_video_model

    try:
        model = await resolve_default_video_model(db)
        provider_config = await load_provider_config_by_model(db, model)
    except Exception as exc:  # noqa: BLE001 - 预览不因模型配置缺失而失败
        logger.warning("legacy 出视频预览：参考音频准入无法判定（%s）", exc)
        return {}, [f"参考音频准入无法判定（{exc}）：本次预览不给出音频结论。"]
    audio = await describe_plan_audio(
        db,
        shot_id=shot_id,
        provider=str(getattr(provider_config, "provider", "") or ""),
        model=str(getattr(model, "name", "") or ""),
    )
    notes = [str(audio["note"])] if audio.get("note") else []
    return audio, notes


def resolve_plan_seconds(requested: int | None, warnings: list[str]) -> int:
    """时长归一：测试只出最短时长（下限 5s），越界钳制并说明。"""
    if requested is None:
        return MIN_VIDEO_SECONDS
    seconds = int(requested)
    if seconds < MIN_VIDEO_SECONDS:
        warnings.append(
            f"请求时长 {seconds}s 低于模型下限，已按最短时长 {MIN_VIDEO_SECONDS}s 提交"
            f"（seedance 2.0 系列 min_seconds={MIN_VIDEO_SECONDS}）。"
        )
        return MIN_VIDEO_SECONDS
    if seconds > ALLOWED_DURATION_SECONDS[-1]:
        warnings.append(f"请求时长 {seconds}s 超出 seedance 2.0 上限 15s，已按 15s 提交。")
        return 15
    return seconds


async def build_video_submit_plan(
    db: AsyncSession,
    *,
    body: VideoSubmitPlanRequest,
) -> VideoSubmitPlanRead:
    """组装直提出视频的计划：解析模型/供应商/参考图/提示词，**不发任何请求**。"""
    warnings: list[str] = []

    # 参考图模式必须命中既有契约，否则底层会在 REQUIRED_FRAMES_BY_MODE 上抛 KeyError。
    reference_mode = str(body.reference_mode or "first").strip() or "first"
    if reference_mode not in REQUIRED_FRAMES_BY_MODE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"reference_mode 只支持 {sorted(REQUIRED_FRAMES_BY_MODE)}，"
                f"收到「{reference_mode}」。"
            ),
        )

    model, model_warnings = await resolve_pinned_video_model(db)
    warnings.extend(model_warnings)
    provider_config = await load_provider_config_by_model(db, model)
    provider_info = _mask_provider(provider_config)
    provider_key = str(provider_info["provider"])
    if provider_key and provider_key not in SUPPORTED_VIDEO_PROVIDERS:
        warnings.append(
            f"provider「{provider_key}」不在既有适配器白名单 {list(SUPPORTED_VIDEO_PROVIDERS)} 内，"
            f"真实提交会在任务分发阶段失败。"
        )
    model_name = str(getattr(model, "name", "") or "")
    if model_name != pinned_video_model():
        warnings.append(
            f"实际使用的模型「{model_name}」与固定策略「{pinned_video_model()}」不一致，请确认。"
        )
    resolution = pinned_video_resolution()

    prompt = str(body.prompt or "").strip()
    prompt_source = "request"
    images: list[str] = list(body.images or [])
    try:
        prompt, images, _pack = await preview_prompt_and_images(
            db,
            shot_id=body.shot_id,
            reference_mode=reference_mode,
            prompt=prompt or None,
            images=list(body.images) if body.images else None,
        )
        prompt_source = "request" if str(body.prompt or "").strip() else "llm_orchestration"
    except HTTPException as exc:
        # 「缺帧」不当作计划失败：页面要能**在点生成之前**看到缺哪一帧并给出去补/换模式的出口。
        # （其它 400/404 仍然如实抛出。）
        detail = str(exc.detail or "")
        if exc.status_code == 400 and "missing" in detail.lower():
            warnings.append(detail)
        else:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # 本次请求**实际使用**的参考帧（绑定资产图只是生成这些帧的上游素材）。
    # “可用”按**供应商口径**判定：有 file_id 只是"已上传"，本机地址对 APIMart 依然不可用。
    frame_rows, missing_frames, unusable_frames = await describe_plan_frames(
        db,
        shot_id=body.shot_id,
        reference_mode=reference_mode,
        file_ids=list(images),
        vendor=provider_key or "apimart",
    )
    if missing_frames:
        warnings.append(
            f"当前参考模式「{reference_mode}」还缺这些帧：{missing_frames}。"
            "请到「关键帧与参考图」补齐，或切换到模型支持的其他参考模式（如 key / text_only）。"
        )
    for row in frame_rows:
        if row.file_id and not row.usable and row.reason:
            warnings.append(f"参考帧「{row.frame_type}」不可用：{row.reason}")

    audio = await describe_plan_audio(db, shot_id=body.shot_id, provider=provider_key, model=model_name)
    if audio["audio_state"] == "missing" and not audio["audio_opt_out"]:
        warnings.append("本镜还没有声音：需要配音请在绑定步骤挂上音频；不需要就明确标记「本镜无需声音」。")

    seconds = resolve_plan_seconds(body.duration_seconds, warnings)

    # 断点④·声音侧：计划阶段就把"这个镜头的声音到底会不会进请求"说清楚，
    # 免得用户以为绑了声音就一定会被用上。文案来自**提交端同一个准入函数**的结论
    # （``video_audio_input.classify_audio_input``），不再是计划里另写一套判断。
    if audio["note"]:
        warnings.append(str(audio["note"]))

    ratio = str(body.ratio or "").strip() or DEFAULT_VIDEO_RATIO
    if not str(body.ratio or "").strip():
        warnings.append(f"未指定 ratio，已按默认 {DEFAULT_VIDEO_RATIO} 提交。")

    # 非 text_only 模式下，缺帧与"帧供应商取不到"都算阻断：两者共用同一份判定，
    # 页面据此禁用「直接生成视频」，提交端也会拿到同一结论（第二层兜底）。
    blocked_frames = missing_frames + unusable_frames
    block_notes: list[str] = []
    if missing_frames:
        block_notes.append(f"缺少参考帧：{'、'.join(missing_frames)}")
    if unusable_frames:
        block_notes.append(
            f"参考帧已存在但供应商无法访问：{'、'.join(unusable_frames)}"
            "（本机/相对地址只能解析成 data URL，供应商只接受 http(s):// 或 asset://）"
        )

    return VideoSubmitPlanRead(
        shot_id=body.shot_id,
        required_frame_types=[
            str(item.value if hasattr(item, "value") else item)
            for item in REQUIRED_FRAMES_BY_MODE.get(reference_mode, ())
        ],
        frames=frame_rows,
        missing_frame_types=missing_frames,
        unusable_frame_types=unusable_frames,
        generation_blocked=bool(blocked_frames) and reference_mode != "text_only",
        blocked_reason=(
            f"参考模式「{reference_mode}」的参考帧不可用：{'；'.join(block_notes)}"
            if blocked_frames and reference_mode != "text_only"
            else ""
        ),
        audio_file_id=str(audio["audio_file_id"]),
        audio_url=str(audio["audio_url"]),
        audio_opt_out=bool(audio["audio_opt_out"]),
        audio_state=str(audio["audio_state"]),
        audio=VideoAudioPlanRead(**dict(audio["audio"])),
        provider=provider_key,
        model_id=str(getattr(model, "id", "") or ""),
        model_name=model_name,
        base_url=str(provider_info["base_url"] or ""),
        api_key_configured=bool(provider_info["api_key_configured"]),
        reference_mode=reference_mode,
        reference_image_count=len(images),
        prompt=prompt,
        prompt_source=prompt_source,
        ratio=ratio,
        seconds=seconds,
        resolution=resolution,
        model_pinned=model_name == pinned_video_model(),
        provider_supported=provider_key in SUPPORTED_VIDEO_PROVIDERS,
        warnings=warnings,
        guard_status=dry_run.short_status(),
    )


VIDEO_FRAME_KEYS: tuple[tuple[str, str], ...] = (
    ("first_frame_base64", "首帧参考图"),
    ("last_frame_base64", "尾帧参考图"),
    ("key_frame_base64", "关键帧参考图"),
)


def _should_probe_media_url(url: str) -> bool:
    """这个媒体地址要不要做**匿名探活**。

    只有 ``asset://`` 例外：它是**供应商侧的私有素材通道**（由供应商用自己的凭据解析），
    我们这边匿名探不了 —— 把它丢给探活会被按"本机/相对路径"判死，于是出现
    "计划说可携带、提交却说不可达"的自相矛盾（同一份地址两条路径口径不一致）。
    形态合法性已由 ``app.utils.files.is_vendor_accepted_ref`` 判过
    （http(s):// / asset:// 都算供应商接受的形态）。

    其余一律照常探活：**data URL 也要探**，因为"供应商吃不吃内嵌 base64"由
    ``vendor_accepts_data_url(provider)`` 在探活里如实判定（APIMart 不吃 → 拦下）。
    """
    return not str(url or "").strip().lower().startswith("asset://")


def video_media_candidates(
    input_payload: dict[str, Any],
    *,
    allow_data_url: bool = False,
) -> list[reference_preflight.ReferenceCandidate]:
    """把**真正会发给供应商**的媒体地址抽出来（帧参考图 + 参考音频）。

    这些字段名里的 ``base64`` 是历史包袱：库里同时存在 **data URL** 与 **公网 http(s) 地址**，
    而 ``build_run_args`` 优先给公网地址（APIMart 只吃 ``http(s)://`` / ``asset://``）。
    所以这里逐条如实探活 —— 故障 A 就是这条路把「只在本机可读的地址」当公网地址发了出去，
    上游抓不到 → 任务 failed（原文「无法获取输入媒体 URL（404/410）」）。

    ``asset://`` 引用不探活（见 :func:`_should_probe_media_url`）：它由供应商侧解析。
    """
    candidates: list[reference_preflight.ReferenceCandidate] = []
    for key, label in VIDEO_FRAME_KEYS:
        url = str(input_payload.get(key) or "").strip()
        if not url or not _should_probe_media_url(url):
            continue
        candidates.append(
            reference_preflight.ReferenceCandidate(
                label=label,
                url=url,
                role=key.replace("_base64", ""),
                allow_data_url=allow_data_url,
            )
        )
    for index, url in enumerate(list(input_payload.get("audio_urls") or [])):
        text = str(url or "").strip()
        if not text or not _should_probe_media_url(text):
            continue
        candidates.append(
            reference_preflight.ReferenceCandidate(
                label=f"参考音频 {index + 1}",
                url=text,
                role="audio",
                allow_data_url=allow_data_url,
            )
        )
    return candidates


async def preflight_video_input_media(
    input_payload: dict[str, Any],
    *,
    provider: str,
    hint: str = "",
    preflight: Callable[..., Any] | None = None,
) -> reference_preflight.PreflightReport | None:
    """**所有出视频入口共用**的提交前可达性预检（直提出视频 + legacy ``/film/tasks/video``）。

    为什么要有这一层（而不是各入口自己写一遍）：

    - 候选抽取只有一份实现：``video_media_candidates``（首/尾/关键帧 + 参考音频）；
    - 「上游是否吃得下内嵌 base64」只有一处判定：``vendor_accepts_data_url(provider)``；
    - 探活只有一份实现：``reference_preflight.preflight_or_raise``（匿名 HEAD→GET，带真实状态码）。

    legacy 入口以前只有**形态级**校验（``_assert_frames_vendor_acceptable``：这个地址形状能不能
    给上游），不做匿名可达性探活 —— 于是「本机相对路径 / 内网地址 / 404 的对象」照样被当成可用
    参考图发给上游，上游抓不到 → 任务 failed（故障 A 原文「无法获取输入媒体 URL（404/410）」）。

    返回 ``None`` 表示本次请求**没有任何要发的媒体**（例如 text_only），此时不探活。
    不可达时由 ``preflight`` 抛 ``ReferencePreflightBlocked``（409），调用方**不得**再建任务 / 写库。
    """
    candidates = video_media_candidates(
        input_payload,
        allow_data_url=vendor_accepts_data_url(provider),
    )
    if not candidates:
        return None
    runner = preflight or reference_preflight.preflight_or_raise
    return await runner(candidates, hint=hint)


async def submit_video(
    db: AsyncSession,
    *,
    body: VideoSubmitPlanRequest,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    task_factory: Callable[[Any, Any], Any] | None = None,
    run_args_builder: Callable[..., Any] | None = None,
    preflight: Callable[..., Any] | None = None,
) -> VideoSubmitRead:
    """同步提交一次视频生成。

    DRY_RUN 开启（默认）时**直接返回被拦截的结果**，不会创建任务、不会发请求。
    ``task_factory`` / ``run_args_builder`` 仅供测试注入，生产留空。

    ``preflight``：可注入的「提交前参考图可达性预检」（``reference_preflight.preflight_or_raise``），
    由路由层传入。**在这里**而不是在路由里做的原因：真正发给供应商的地址是
    ``build_run_args`` 解出来的（file_id → 公网地址 / data URL），只有这里才知道原文。
    """
    warnings: list[str] = []
    plan = await build_video_submit_plan(db, body=body)
    warnings.extend(plan.warnings)

    # 缺帧前置拦截：与计划同一口径，避免"点了生成才报错"
    if plan.generation_blocked:
        return VideoSubmitRead(
            shot_id=body.shot_id,
            provider=plan.provider,
            status="rejected_before_submit",
            error=plan.blocked_reason or "缺少参考模式要求的帧，未发出任何请求。",
            warnings=warnings,
            guard_status=dry_run.short_status(),
        )

    if dry_run.dry_run_enabled():
        return VideoSubmitRead(
            shot_id=body.shot_id,
            provider=plan.provider,
            status="dry_run",
            url="",
            warnings=[
                *warnings,
                "[DRY_RUN] 未提交任何视频生成任务；这是占位结果，不是真实视频地址。",
            ],
            guard_status=dry_run.short_status(),
        )

    # 真实提交：这里才会产生费用，必须已被显式确认。
    dry_run.assert_outbound_allowed(f"直提出视频 shot_id={body.shot_id}", outlet=dry_run.OUTLET_VIDEO)

    build_args = run_args_builder
    if build_args is None:
        from app.services.film import build_run_args as build_args  # type: ignore[no-redef]

    run_args = await build_args(
        db,
        shot_id=body.shot_id,
        reference_mode=body.reference_mode,
        prompt=str(body.prompt or "").strip(),
        images=list(body.images),
        ratio=str(body.ratio or "").strip() or None,
    )

    from app.core.contracts.provider import ProviderConfig
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.integrations.video_capabilities import validate_video_options

    # 固定模型策略在提交前**再强制一次**：不依赖 ModelSettings 默认值，也不允许请求参数改掉。
    input_payload = dict(run_args.get("input") or {})
    input_payload["model"] = plan.model_name
    input_payload["resolution"] = plan.resolution or pinned_video_resolution()
    input_payload["seconds"] = plan.seconds or MIN_VIDEO_SECONDS
    input_payload.setdefault("ratio", plan.ratio or DEFAULT_VIDEO_RATIO)
    run_args["input"] = input_payload

    if body.generate_audio is not None:
        input_payload["generate_audio"] = bool(body.generate_audio)

    # 断点④的声音侧：镜头绑定的声音接进入参（供应商支持音频输入时才会真的发出）
    from app.services.studio.video_audio_input import attach_shot_audio_to_video_input

    try:
        warnings.extend(
            await attach_shot_audio_to_video_input(
                db,
                shot_id=body.shot_id,
                input_payload=input_payload,
                provider=str(run_args.get("provider") or plan.provider),
                model=str(input_payload.get("model") or plan.model_name),
            )
        )
    except Exception as exc:  # noqa: BLE001 - 声音是尽力而为的输入，不能阻断生成
        warnings.append(f"声音绑定解析失败（{exc}），本次生成不携带音频。")

    # 用既有能力表做一次前置校验：480p / 5s 必须被 seedance-2.0-mini 接受，
    # 否则宁可在这里失败，也不要把一次注定被拒的请求发出去（那是白花钱）。
    try:
        validate_video_options(
            provider=run_args["provider"],
            model=input_payload["model"],
            input_=VideoGenerationInput.model_validate(input_payload),
        )
    except ValueError as exc:
        return VideoSubmitRead(
            shot_id=body.shot_id,
            provider=str(run_args.get("provider") or plan.provider),
            status="rejected_before_submit",
            error=f"提交前能力校验未通过，未发出任何请求：{exc}",
            warnings=warnings,
            guard_status=dry_run.short_status(),
        )

    # 提交前预检（纵深防御的第二层，第一层是计划预览的供应商可用性判定）：
    # 把**真正会发给供应商**的媒体地址逐张匿名探活。不可达就**不发请求**（不花钱）。
    # 候选抽取 / 上游 base64 口径 / 探活实现全部走共用入口（legacy 出视频入口用的是同一个）。
    if preflight is not None:
        await preflight_video_input_media(
            input_payload,
            provider=str(run_args.get("provider") or plan.provider or ""),
            hint=f"直提出视频 shot_id={body.shot_id}",
            preflight=preflight,
        )

    factory = task_factory
    if factory is None:
        from app.core.tasks.video_generation_tasks import VideoGenerationTask as factory  # type: ignore[assignment]

    provider_config = ProviderConfig(
        provider=run_args["provider"],
        api_key=run_args["api_key"],
        base_url=run_args.get("base_url"),
    )
    input_ = VideoGenerationInput.model_validate(input_payload)
    task = factory(provider_config=provider_config, input_=input_)

    started = time.monotonic()
    try:
        await asyncio.wait_for(task.run(), timeout=max(1.0, float(timeout_seconds)))
    except asyncio.TimeoutError:
        elapsed = int((time.monotonic() - started) * 1000)
        return VideoSubmitRead(
            shot_id=body.shot_id,
            provider=plan.provider,
            status="timeout",
            error=f"等待超过 {timeout_seconds}s 仍未完成；provider 侧任务可能仍在进行。",
            elapsed_ms=elapsed,
            warnings=warnings,
            guard_status=dry_run.short_status(),
        )

    elapsed = int((time.monotonic() - started) * 1000)
    result = await task.get_result()
    if result is None:
        error = ""
        try:
            status_info = await task.status()
            error = str(status_info.get("error") or "")
        except Exception:  # noqa: BLE001 - 取错误信息失败不能盖住主流程
            error = ""
        return VideoSubmitRead(
            shot_id=body.shot_id,
            provider=plan.provider,
            status="failed",
            error=error or "视频生成任务未返回结果。",
            elapsed_ms=elapsed,
            warnings=warnings,
            guard_status=dry_run.short_status(),
        )

    return VideoSubmitRead(
        shot_id=body.shot_id,
        provider=str(getattr(result, "provider", "") or plan.provider),
        status=str(getattr(result, "status", "") or "succeeded"),
        provider_task_id=str(getattr(result, "provider_task_id", "") or ""),
        url=str(getattr(result, "url", "") or ""),
        elapsed_ms=elapsed,
        warnings=warnings,
        guard_status=dry_run.short_status(),
    )


# ---------------------------------------------------------------------------
# 生成前的入参预检（legacy `/film/tasks/video` 路径复用）
# ---------------------------------------------------------------------------


def validate_legacy_video_input(input_: dict[str, Any]) -> list[str]:
    """对**已组装好**的视频生成入参做一次确定性预检，并按固定策略补齐分辨率。

    为什么需要：legacy 的 ``/film/tasks/video`` 会直接把 ``shot_details.duration``
    当成 ``seconds`` 发出去，而本项目的镜头时长普遍是 3–4s——低于
    ``seedance-2.0-mini`` 的 ``min_seconds=5``。以前这条路径不做任何预检
    （``validate_apimart_video_options`` 写了但没人调用），表现是任务建出来、
    真花钱发出请求、然后被供应商拒绝；现在提前拦下并给出可读原因。

    处理策略（与 P3 ``submit_video`` 一致）：
    - 低于下限 → 钳到最短时长并返回 warning（用户明确要求"出视频测试只需要最短时长"）；
    - 高于上限 → 钳到上限；
    - 没给分辨率 → 补成固定档（``480p``，mini 支持的最低档，最省）；
    - 钳制后仍不合法（ratio/resolution 不在能力表内）→ 抛 ``ValueError``。

    返回 warning 列表；抛 ``ValueError`` 表示必须在建任务前拒绝。
    """
    from app.core.contracts.video_generation import VideoGenerationInput
    from app.core.integrations.video_capabilities import validate_video_options

    warnings: list[str] = []
    payload = dict(input_ or {})

    model = str(payload.get("model") or "").strip()
    seconds = payload.get("seconds")
    payload["seconds"] = resolve_plan_seconds(
        int(seconds) if isinstance(seconds, int) else None,
        warnings,
    )

    if not str(payload.get("resolution") or "").strip():
        # legacy 路径从不设分辨率 → 供应商默认档可能是较贵的 720p/1080p
        payload["resolution"] = pinned_video_resolution()
        warnings.append(
            f"未指定分辨率，已按固定档 {payload['resolution']} 提交"
            f"（env {VIDEO_RESOLUTION_ENV} 可覆盖）。"
        )

    payload.setdefault("ratio", "16:9")
    payload.setdefault("prompt", "")

    try:
        validate_video_options(
            provider="apimart",
            model=model or None,
            input_=VideoGenerationInput(**payload),
        )
    except ValueError as exc:
        raise ValueError(f"视频参数不可提交：{exc}") from exc

    input_.update(payload)
    if model and model != pinned_video_model():
        warnings.append(
            f"当前视频模型为 {model}，与固定策略 {pinned_video_model()} 不一致，请确认是否刻意切换。"
        )
    return warnings
