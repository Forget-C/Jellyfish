"""镜头分镜帧（关键帧 / 首帧 / 尾帧）出图的**同进程内联**路径。

为什么需要它（用户实点反馈：「关键帧继续做啊」）：

- 既有的 ``POST /studio/image-tasks/shot/{shot_id}/frame-image-tasks`` 只做两件事：
  **过守卫** + **建一条 Celery 任务行**（`create_image_task_and_link` → `enqueue_task_execution`）。
  本机没有 Redis / celery worker、``task_always_eager=False``，所以那条路点完「生成」
  永远停在「排队中」；DRY_RUN 打开时更早就被守卫拦掉。
- P3 直提端点（``image-pipeline``）是**同进程内联执行**的（``video_submit.submit_video``），
  关键帧因此也走这条：同一个文件里读盘 → 组装 → 守卫 → 执行 → 落库。

与队列路径的**一致**之处（不是另起一套）：
- 守卫：``paid_outlet_guard.require_outlet(outlet=image)``（在 ``create_image_task_and_link`` 里）；
- 任务行 / 任务关联：复用 ``create_image_task_and_link``（只是不 enqueue）；
- 执行：复用 Celery 任务体 ``run_image_generation_task``（同一份落库逻辑 → 同一张表、同一个字段）；
- 落库：``shot_frame_images.file_id`` + ``file_usages`` + 镜头状态重算。

诚实边界：
- 参考图**能不能真的影响画面**取决于供应商适配层。本模块把
  ``ImageGenerationResult.provider_notes``（例如本地出图垫片的「参考图未透传」）
  原样带回给调用方，不替供应商打包票。
- DRY_RUN 下**一个字节都不写**：不建任务、不写 shot_frame_images、不产生费用，只回计划。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Shot, ShotDetail, ShotFrameImage
from app.schemas.studio.image_pipeline import (
    FrameSubmitPlanRead,
    FrameSubmitPlanRequest,
    FrameSubmitRead,
    FrameSubmitRequest,
)
from app.services import paid_outlet_guard
from app.services.llm.provider_resolver import resolve_provider_config_by_model
from app.services.studio.asset_profiles import TYPE_LABELS
from app.services.studio.bound_asset_files import (
    resolve_shot_bound_files,
    to_shot_linked_asset_items,
)
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.image_pipeline import ASSET_TYPE_ZH
from app.services.studio.image_task_references import resolve_reference_refs_reporting
from app.services.studio.image_tasks import resolve_image_model
from app.services.studio.llm_orchestration import dry_run
from app.utils.files import vendor_accepts_data_url

DEFAULT_TARGET_RATIO = "16:9"
DEFAULT_TIMEOUT_SECONDS = 900.0


def asset_type_label(asset_type: str) -> str:
    """资产类型的中文标签（**读取侧优先**）。

    为什么不能只用 ``ASSET_TYPE_ZH``：那张表由出图侧策略表派生
    （``image_pipeline.ASSET_TYPE_ZH`` ← ``asset_strategies.STRATEGIES``），只有四类。
    而商品（第五类资产）在 MVP 里**不进**出图侧策略表，却必须能进帧参考，
    否则它的定版图标签会显示成英文 ``product「…」``。
    所以以读取侧 ``asset_profiles.TYPE_LABELS``（五类齐全）为准，出图侧表只作兜底。
    """
    key = str(asset_type or "").strip().lower()
    return TYPE_LABELS.get(key) or ASSET_TYPE_ZH.get(key) or key or "资产"

# 帧类型 → shot_details 上保存该帧提示词的字段（第 4 步「视频提示词」同源）
FRAME_PROMPT_FIELDS: dict[str, str] = {
    "first": "first_frame_prompt",
    "last": "last_frame_prompt",
    "key": "key_frame_prompt",
}

FRAME_TYPE_ZH: dict[str, str] = {"first": "首帧", "key": "关键帧", "last": "尾帧"}

PROMPT_SOURCE_REQUEST = "request"
PROMPT_SOURCE_SAVED = "saved"
PROMPT_SOURCE_EMPTY = "empty"


@dataclass(slots=True)
class FrameSubmitPlan:
    """关键帧出图计划（组装结果，不含任何生成动作）。"""

    shot_id: str
    frame_type: str
    prompt: str
    prompt_source: str
    reference_file_ids: list[str] = field(default_factory=list)
    reference_labels: list[str] = field(default_factory=list)
    target_ratio: str = DEFAULT_TARGET_RATIO
    target_ratio_source: str = "default"
    resolution_profile: str = "standard"
    provider: str = ""
    model_id: str = ""
    model_name: str = ""
    base_url: str = ""
    api_key_configured: bool = False
    image_slot_id: int | None = None
    warnings: list[str] = field(default_factory=list)

    def to_read(self) -> FrameSubmitPlanRead:
        return FrameSubmitPlanRead(
            shot_id=self.shot_id,
            frame_type=self.frame_type,
            prompt=self.prompt,
            prompt_source=self.prompt_source,
            reference_file_ids=list(self.reference_file_ids),
            reference_labels=list(self.reference_labels),
            reference_count=len(self.reference_file_ids),
            target_ratio=self.target_ratio,
            target_ratio_source=self.target_ratio_source,
            resolution_profile=self.resolution_profile,
            provider=self.provider,
            model_id=self.model_id,
            model_name=self.model_name,
            base_url=self.base_url,
            api_key_configured=self.api_key_configured,
            image_slot_id=self.image_slot_id,
            warnings=list(self.warnings),
            guard_status=dry_run.short_status(),
            dry_run=dry_run.dry_run_enabled(),
        )


def saved_frame_prompt(shot_detail: Any, frame_type: str) -> str:
    """取镜头里**已保存**的该帧提示词（关键帧就是 shot_details.key_frame_prompt）。"""
    field_name = FRAME_PROMPT_FIELDS.get(str(frame_type or "").strip())
    if not field_name:
        return ""
    return str(getattr(shot_detail, field_name, "") or "").strip()


async def resolve_target_ratio(
    db: AsyncSession,
    *,
    shot_detail: ShotDetail,
    requested: str,
    warnings: list[str],
) -> tuple[str, str]:
    """画幅解析：请求值 → 镜头 override_video_ratio → 项目默认 → 16:9。

    为什么要服务端也解析一遍：前端会在项目没配默认比例时算出空串，直接透传空值
    会让 provider 报 ``ratio is required``（出视频那次已经踩过同样的坑）。
    """
    clean = str(requested or "").strip()
    if clean:
        return clean, "request"

    shot_ratio = str(getattr(shot_detail, "override_video_ratio", "") or "").strip()
    if shot_ratio:
        return shot_ratio, "shot"

    shot = await db.get(Shot, shot_detail.id)
    project_ratio = ""
    if shot is not None:
        from app.models.studio import Chapter, Project

        chapter = await db.get(Chapter, shot.chapter_id)
        if chapter is not None:
            project = await db.get(Project, chapter.project_id)
            project_ratio = str(getattr(project, "default_video_ratio", "") or "").strip()
    if project_ratio:
        return project_ratio, "project"

    warnings.append(f"镜头与项目都没有配置视频比例，已按默认 {DEFAULT_TARGET_RATIO} 提交。")
    return DEFAULT_TARGET_RATIO, "default"


async def resolve_frame_slot(db: AsyncSession, *, shot_id: str, frame_type: str) -> ShotFrameImage | None:
    """取该镜头该帧类型的落库槽位行（每镜头每类型至多一条）。"""
    stmt = (
        select(ShotFrameImage)
        .where(ShotFrameImage.shot_detail_id == shot_id, ShotFrameImage.frame_type == frame_type)
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def resolve_frame_reference_targets(
    db: AsyncSession,
    *,
    shot_id: str,
    explicit: list[str],
    warnings: list[str],
) -> tuple[list[str], list[str]]:
    """参考图解析：``(file_id 列表, 与之一一对应的可读名列表)``。

    为什么要带可读名：页面文案不许出现 ``file_id``（前端有 ``maskInternalIds.ts`` 的同款
    规范），而「提交前参考图不可达」这类报错必须说清**是哪个资产的哪张图**。绑定资产来的
    参考图用资产名（如「角色「林晓」的定版图」），显式传入的用「显式指定的参考图 N」。
    """
    explicit_ids = [str(x).strip() for x in (explicit or []) if str(x).strip()]
    if explicit_ids:
        return explicit_ids, [f"显式指定的参考图 {index + 1}" for index in range(len(explicit_ids))]

    bound_files = await resolve_shot_bound_files(db, shot_id=shot_id)
    items = to_shot_linked_asset_items(bound_files)
    file_ids: list[str] = []
    labels: list[str] = []
    for item in items:
        fid = str(getattr(item, "file_id", "") or "").strip()
        if not fid or fid in file_ids:
            continue
        name = str(getattr(item, "name", "") or "").strip()
        asset_type = str(getattr(item, "type", "") or "").strip()
        label = f"{asset_type_label(asset_type)}「{name}」的定版图" if name else "绑定资产的定版图"
        file_ids.append(fid)
        labels.append(label)
    for bound in bound_files:
        for warning in getattr(bound, "warnings", []) or []:
            warnings.append(f"绑定资产「{getattr(bound, 'asset_name', '')}」：{warning}")
    if not file_ids:
        warnings.append(
            "该镜头没有可用的绑定资产图（角色/场景/道具/服装/商品的定版图都缺失），"
            "本次为纯文本提示词出图，人物一致性无法保证。"
        )
    return file_ids, labels


async def resolve_frame_reference_file_ids(
    db: AsyncSession,
    *,
    shot_id: str,
    explicit: list[str],
    warnings: list[str],
) -> list[str]:
    """兼容入口：只要 file_id 列表（可读名见 :func:`resolve_frame_reference_targets`）。"""
    file_ids, _labels = await resolve_frame_reference_targets(
        db,
        shot_id=shot_id,
        explicit=explicit,
        warnings=warnings,
    )
    return file_ids


async def build_frame_submit_plan(
    db: AsyncSession,
    *,
    body: FrameSubmitPlanRequest | FrameSubmitRequest,
) -> FrameSubmitPlan:
    """组装关键帧提交计划：**只读**，不建任务、不触网、不写库。"""
    frame_type = str(body.frame_type or "key").strip() or "key"
    if frame_type not in FRAME_PROMPT_FIELDS:
        raise HTTPException(status_code=400, detail=f"frame_type 只支持 {sorted(FRAME_PROMPT_FIELDS)}。")

    shot_detail = await db.get(ShotDetail, body.shot_id)
    if shot_detail is None:
        raise HTTPException(status_code=404, detail=f"ShotDetail not found: {body.shot_id}")

    warnings: list[str] = []
    requested_prompt = str(body.prompt or "").strip()
    if requested_prompt:
        prompt, prompt_source = requested_prompt, PROMPT_SOURCE_REQUEST
    else:
        saved = saved_frame_prompt(shot_detail, frame_type)
        prompt = saved
        prompt_source = PROMPT_SOURCE_SAVED if saved else PROMPT_SOURCE_EMPTY
        if saved:
            warnings.append(
                f"提示词来源：镜头已保存的{FRAME_TYPE_ZH.get(frame_type, frame_type)}提示词"
                f"（shot_details.{FRAME_PROMPT_FIELDS[frame_type]}，{len(saved)} 字）。"
            )
        else:
            warnings.append(
                f"镜头里没有保存的{FRAME_TYPE_ZH.get(frame_type, frame_type)}提示词"
                f"（shot_details.{FRAME_PROMPT_FIELDS[frame_type]} 为空），"
                "提交会在组装阶段被拒绝 —— 请先在工作室第 4 步保存提示词。"
            )

    candidate_file_ids, candidate_labels = await resolve_frame_reference_targets(
        db,
        shot_id=body.shot_id,
        explicit=list(body.images or []),
        warnings=warnings,
    )
    # 计划里只承诺**真的解析得出来**的参考图：绑定了一堆资产但图文件坏掉时，
    # 计划说 4 张、提交只送 2 张，用户就永远看不出差异在哪。
    _refs, reference_file_ids, ref_warnings = await resolve_reference_refs_reporting(
        db,
        file_ids=candidate_file_ids,
    )
    warnings.extend(ref_warnings)
    label_by_file_id = dict(zip(candidate_file_ids, candidate_labels))
    reference_labels = [label_by_file_id.get(fid, "") for fid in reference_file_ids]
    if len(reference_file_ids) < len(candidate_file_ids):
        dropped = [x for x in candidate_file_ids if x not in reference_file_ids]
        warnings.append(
            f"计划中的参考图有 {len(candidate_file_ids)} 张，实际只有 {len(reference_file_ids)} 张可用"
            f"（已跳过：{dropped}）。"
        )
    target_ratio, ratio_source = await resolve_target_ratio(
        db,
        shot_detail=shot_detail,
        requested=str(body.target_ratio or ""),
        warnings=warnings,
    )

    model = await resolve_image_model(db, body.model_id)
    provider_info = await resolve_provider_config_by_model(db, model=model)
    # ResolvedProviderConfig 的字段名是 provider_key（不是 provider）——写错会静默变成空串，
    # 界面上就显示成"未识别供应商"（真实踩过）。
    provider_key = str(getattr(provider_info, "provider_key", "") or "")
    api_key_configured = bool(str(getattr(provider_info, "api_key", "") or "").strip())
    if not api_key_configured:
        warnings.append(f"供应商「{provider_key}」没有配置 API Key，真实提交会失败。")

    slot = await resolve_frame_slot(db, shot_id=body.shot_id, frame_type=frame_type)

    return FrameSubmitPlan(
        shot_id=body.shot_id,
        frame_type=frame_type,
        prompt=prompt,
        prompt_source=prompt_source,
        reference_file_ids=reference_file_ids,
        reference_labels=reference_labels,
        target_ratio=target_ratio,
        target_ratio_source=ratio_source,
        resolution_profile=str(body.resolution_profile or "standard"),
        provider=provider_key,
        model_id=str(getattr(model, "id", "") or ""),
        model_name=str(getattr(model, "name", "") or ""),
        base_url=str(getattr(provider_info, "base_url", "") or ""),
        api_key_configured=api_key_configured,
        image_slot_id=getattr(slot, "id", None),
        warnings=warnings,
    )


def _dry_run_read(plan: FrameSubmitPlan, warnings: list[str]) -> FrameSubmitRead:
    """演练结果：结构完整、明确标注、**不写任何库**。"""
    return FrameSubmitRead(
        shot_id=plan.shot_id,
        frame_type=plan.frame_type,
        status="dry_run",
        dry_run=True,
        prompt=plan.prompt,
        prompt_source=plan.prompt_source,
        reference_file_ids=list(plan.reference_file_ids),
        image_slot_id=plan.image_slot_id,
        warnings=[
            *warnings,
            "[DRY_RUN] 未提交任何出图请求；这是占位结果，不是真实图片地址，也没有写入任何库。",
        ],
        guard_status=dry_run.short_status(),
    )


def frame_reference_candidates(
    *,
    plan: FrameSubmitPlan,
    refs: list[dict[str, str]],
    kept_file_ids: list[str] | None = None,
) -> list[reference_preflight.ReferenceCandidate]:
    """把**本次真的要发出去**的参考图转成预检候选（可读名 + 地址）。

    只用 ``plan.reference_labels``（可读名）做标识：绝不能把 ``file_id`` 写进用户可见文案。

    ``allow_data_url`` 取决于**当前图片供应商**能不能吃内嵌 base64：
    openai / volcengine 自己解码（本地文件 → data URL 是它们的正常形态），
    APIMart 只吃 ``http(s)://`` / ``asset://`` —— 后者的 data URL 必须在提交前拦下。
    """
    label_by_file_id = dict(zip(plan.reference_file_ids, plan.reference_labels))
    allow_data_url = vendor_accepts_data_url(plan.provider)
    candidates: list[reference_preflight.ReferenceCandidate] = []
    frame_zh = FRAME_TYPE_ZH.get(plan.frame_type, plan.frame_type)
    for index, item in enumerate(refs):
        url = str((item or {}).get("image_url") or "").strip()
        file_id = kept_file_ids[index] if kept_file_ids and index < len(kept_file_ids) else ""
        label = label_by_file_id.get(file_id, "") or f"{frame_zh}参考图 {index + 1}"
        candidates.append(
            reference_preflight.ReferenceCandidate(
                label=label,
                url=url,
                role=f"frame:{plan.frame_type}",
                allow_data_url=allow_data_url,
            )
        )
    return candidates


async def submit_frame(
    db: AsyncSession,
    *,
    body: FrameSubmitRequest,
    create_task: Any = None,
    build_run_args: Any = None,
    run_task: Any = None,
    read_result: Any = None,
    preflight: Any = None,
) -> FrameSubmitRead:
    """同步执行一次关键帧出图（同进程内联）。

    ``create_task`` / ``build_run_args`` / ``run_task`` / ``read_result`` 仅供测试注入，
    生产留空即走真实实现。

    ``preflight``：可注入的「提交前参考图可达性预检」（``reference_preflight.preflight_or_raise``），
    由路由层传入。**在写任何库、建任何任务之前**跑：参考图上游取不到时直接拦住，
    一次付费调用都不产生（真实故障 A：本机可读的参考图地址发给上游 → 404 任务失败）。
    """
    plan = await build_frame_submit_plan(db, body=body)
    warnings = list(plan.warnings)

    if not plan.prompt:
        raise HTTPException(
            status_code=400,
            detail=(
                f"镜头 {plan.shot_id} 没有可用的{FRAME_TYPE_ZH.get(plan.frame_type, plan.frame_type)}提示词："
                f"shot_details.{FRAME_PROMPT_FIELDS[plan.frame_type]} 为空，且本次请求没有传 prompt。"
            ),
        )

    if dry_run.dry_run_enabled():
        return _dry_run_read(plan, warnings)

    # 真实提交：这里会产生费用，必须先被显式确认（require_outlet 在建任务前再过一次守卫）。
    paid_outlet_guard.require_outlet(
        f"关键帧出图 shot_id={plan.shot_id} frame_type={plan.frame_type}",
        outlet=paid_outlet_guard.OUTLET_IMAGE,
    )
    dry_run.assert_outbound_allowed(
        f"关键帧出图 shot_id={plan.shot_id}",
        outlet=dry_run.OUTLET_IMAGE,
    )

    refs, kept_file_ids, ref_warnings = await resolve_reference_refs_reporting(
        db,
        file_ids=plan.reference_file_ids,
    )
    warnings.extend(ref_warnings)

    # 提交前预检：每张参考图逐张匿名探活，不可达则**不提交**（不写库、不建任务、不花钱）。
    if preflight is not None and refs:
        await preflight(
            frame_reference_candidates(plan=plan, refs=refs, kept_file_ids=kept_file_ids),
            hint=f"关键帧出图 shot_id={plan.shot_id} frame_type={plan.frame_type}",
        )

    # 落库目标：先确保 shot_frame_images 有这一行（后续由任务体写回 file_id）。
    slot = await resolve_frame_slot(db, shot_id=plan.shot_id, frame_type=plan.frame_type)
    if slot is None:
        slot = ShotFrameImage(
            shot_detail_id=plan.shot_id,
            frame_type=plan.frame_type,
            file_id=None,
            width=None,
            height=None,
            format="png",
        )
        db.add(slot)
        await db.flush()
        await db.refresh(slot)
    slot_id = int(slot.id)

    create = create_task
    if create is None:
        from app.services.studio.image_task_runner import (
            create_image_task_and_link as create,  # type: ignore[no-redef]
        )

    build_args = build_run_args
    if build_args is None:
        from app.services.studio.image_task_runner import (
            build_image_task_run_args as build_args,  # type: ignore[no-redef]
        )

    runner = run_task
    if runner is None:
        from app.services.studio.image_task_runner import (
            run_image_generation_task as runner,  # type: ignore[no-redef]
        )

    reader = read_result
    if reader is None:
        reader = _read_persisted_result

    task_kwargs: dict[str, Any] = {
        "model_id": body.model_id,
        "relation_type": "shot_frame_image",
        "relation_entity_id": str(slot_id),
        "prompt": plan.prompt,
        "images": refs or None,
        "target_ratio": plan.target_ratio,
        "resolution_profile": plan.resolution_profile,
        "purpose": "video_reference",
        "render_context": {
            "frame_type": plan.frame_type,
            "prompt_source": plan.prompt_source,
            "reference_file_ids": list(plan.reference_file_ids),
            "target_ratio": plan.target_ratio,
            "resolution_profile": plan.resolution_profile,
            "submitted_by": "image_pipeline_frame_submit",
        },
    }

    started = time.monotonic()
    # 1) 建任务行 + 关联（与队列路径同一个函数），**不 enqueue**：本次就在同进程跑。
    task_id = await create(db=db, enqueue=False, **task_kwargs)
    # 2) 同一个 run_args 构造函数 → 与 Celery 路径完全一致的入参
    run_args, _model = await build_args(db=db, **task_kwargs)

    elapsed_base = int((time.monotonic() - started) * 1000)
    timeout_seconds = float(getattr(body, "timeout_seconds", 0) or DEFAULT_TIMEOUT_SECONDS)
    try:
        await asyncio.wait_for(runner(task_id, run_args), timeout=max(1.0, timeout_seconds))
    except asyncio.TimeoutError:
        return FrameSubmitRead(
            shot_id=plan.shot_id,
            frame_type=plan.frame_type,
            status="timeout",
            task_id=task_id,
            provider=plan.provider,
            prompt=plan.prompt,
            prompt_source=plan.prompt_source,
            reference_file_ids=list(plan.reference_file_ids),
            image_slot_id=slot_id,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            error=(
                f"等待超过 {timeout_seconds}s 仍未完成；任务 {task_id} 已在任务中心建行，"
                "可稍后查状态（本请求已放弃等待，不代表上游一定失败）。"
            ),
            warnings=warnings,
            guard_status=dry_run.short_status(),
        )

    elapsed = int((time.monotonic() - started) * 1000)
    outcome = await reader(db, task_id=task_id, slot_id=slot_id)
    status = str(outcome.get("status") or "")
    error = str(outcome.get("error") or "")
    if error:
        warnings.append(error)

    return FrameSubmitRead(
        shot_id=plan.shot_id,
        frame_type=plan.frame_type,
        status=status or ("succeeded" if outcome.get("file_id") else "failed"),
        task_id=task_id,
        provider=str(outcome.get("provider") or plan.provider),
        provider_task_id=str(outcome.get("provider_task_id") or ""),
        image_url=str(outcome.get("image_url") or ""),
        file_id=str(outcome.get("file_id") or ""),
        image_slot_id=slot_id,
        prompt=plan.prompt,
        prompt_source=plan.prompt_source,
        reference_file_ids=list(plan.reference_file_ids),
        provider_notes=[str(x) for x in (outcome.get("provider_notes") or [])],
        elapsed_ms=elapsed if elapsed >= elapsed_base else elapsed_base,
        error=error,
        warnings=warnings,
        guard_status=dry_run.short_status(),
    )


async def _read_persisted_result(
    db: AsyncSession,
    *,
    task_id: str,
    slot_id: int,
) -> dict[str, Any]:
    """回读任务结果与落库情况（**必须重新读**，不能信 session 里的旧快照）。"""
    from app.core.db import async_session_maker
    from app.models.studio import FileItem
    from app.models.task import GenerationTask

    outcome: dict[str, Any] = {}

    # 任务体用的是另一个 session，本 session 里的对象可能还是旧快照（SQLite WAL 尤其明显），
    # 所以这里显式开新 session 读。
    async with async_session_maker() as fresh:
        task_row = await fresh.get(GenerationTask, task_id)
        if task_row is not None:
            payload = task_row.result if isinstance(task_row.result, dict) else {}
            outcome["status"] = str(task_row.status or "")
            outcome["error"] = str(task_row.error or "")
            images = payload.get("images") if isinstance(payload, dict) else None
            first = images[0] if isinstance(images, list) and images and isinstance(images[0], dict) else {}
            outcome["image_url"] = str(first.get("url") or "")
            outcome["provider"] = str(payload.get("provider") or "")
            outcome["provider_task_id"] = str(payload.get("provider_task_id") or "")
            notes = payload.get("provider_notes")
            outcome["provider_notes"] = [str(x) for x in notes] if isinstance(notes, list) else []

        slot = await fresh.get(ShotFrameImage, slot_id)
        file_id = str(getattr(slot, "file_id", "") or "")
        outcome["file_id"] = file_id
        if file_id and not outcome.get("image_url"):
            file_obj = await fresh.get(FileItem, file_id)
            outcome["image_url"] = str(getattr(file_obj, "thumbnail", "") or "")

    return outcome


__all__ = [
    "DEFAULT_TARGET_RATIO",
    "DEFAULT_TIMEOUT_SECONDS",
    "FRAME_PROMPT_FIELDS",
    "FrameSubmitPlan",
    "build_frame_submit_plan",
    "frame_reference_candidates",
    "resolve_frame_reference_file_ids",
    "resolve_frame_reference_targets",
    "resolve_frame_slot",
    "resolve_target_ratio",
    "saved_frame_prompt",
    "submit_frame",
]
