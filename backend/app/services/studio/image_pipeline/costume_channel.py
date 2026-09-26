"""服装（costume）出图通道：**Jellyfish 自己的 APIMart 图片直出**。

为什么服装不能走上游出图服务
============================

上游出图服务（另一个项目，只读、不可改）的契约只接受
``character`` / ``scene`` / ``prop``（见 :data:`external_image_client.SERVICE_ASSET_TYPES`），
把服装当人物或场景发给它会被对端拒绝 —— 那正是用户明令禁止的「套用人物参考图或场景模板」。
所以服装走 Jellyfish **自己**的 APIMart 图片通道：与「使用已有参考图重新生成」
（``reference_regenerate``）**同一条通道、同一套 provider 解析与守卫**，区别只有一个：

- ``reference_regenerate`` 是**可选返工**，会把该资产已有的参考图放进 ``image_urls``；
- 本模块是**正式生产**：只按服装提示词直出，**不带任何参考图**
  （请求体里不会出现 ``image_urls``），提示词用的是服装设计口径
  （款式 / 颜色 / 材质 / 配饰 / 穿着人物 / 身份时代 / 使用场合）。

安全口径（与既有两条出图链路**同一套**，不另开一套）：

- 受付费守卫约束：``paid_outlet_guard.require_outlet`` + ``dry_run.assert_outbound_allowed``；
  **DRY_RUN 下先短路**：返回 ``outcome=dry_run`` 的占位结果，一个字节都不出网；
- **不写 OSS**、不写库：提交只出图，落库仍走用户显式「采纳」（``/image-pipeline/adopt``）；
- 幂等键沿用 :func:`image_pipeline.build_source_task_id`（含 ``attempt``），并复用
  ``reference_regenerate`` 的**进程内幂等登记**：同一轮重复点击不重复付费；
- 供应商失败**如实回报**（一条 ``outcome=failed`` 的结果，带原文与修法），**不自动重试**。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.apimart.images import (
    SUPPORTED_RATIOS,
    ApimartImageApiAdapter,
    ApimartImageError,
)
from app.schemas.studio.image_pipeline import ImageTaskResultRead
from app.services import paid_outlet_guard
from app.services.llm.provider_resolver import resolve_provider_config_by_model
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.image_pipeline.image_pipeline import (
    ASSET_TYPE_ZH,
    OUTCOME_DRY_RUN,
    OUTCOME_FAILED,
    OUTCOME_OK,
    OUTCOME_RUNNING,
    SubmissionTarget,
    _http_status_from_text,
    _load_asset_rows,
    build_object_key_template,
    build_source_task_id,
    exclude_unusable_saved_prompts,
    resolve_asset_prompt,
)
from app.services.studio.image_pipeline.reference_regenerate import (
    # 进程内幂等登记**只有一份实现**（在 reference_regenerate 里）：两条 APIMart 链路共用它，
    # 同一轮（同一 source_task_id）重复点击都不会重复付费。不在这里写第二份。
    _forget_round,
    _remember_round,
    _reserve_round,
)
from app.services.studio.image_tasks import resolve_image_model
from app.services.studio.llm_orchestration import dry_run

#: 本通道的资产类型（只有服装；它是分流表里 channel=apimart 的那一类）
COSTUME_ASSET_TYPE = "costume"

#: 结果的 ``stage`` 取值（与上游通道的 character_sheet / reference_batch 区分开）
STAGE_COSTUME_DESIGN = "costume_design"

#: 结构化错误码：图片模型不是 APIMart 供应商 → 本通道无法工作
ERROR_PROVIDER_NOT_APIMART = "costume_requires_apimart"

#: 同步等待供应商产物的墙钟上限（默认值，可被调用方覆盖）
DEFAULT_TIMEOUT_SECONDS = 600.0

#: 提示词里"避免出现"段的前缀：APIMart 的图片契约**没有**独立负面提示词字段，
#: 所以全局负面词只能折进 prompt 正文（如实回报，不假装发过去了）。
NEGATIVE_PROMPT_PREFIX = "避免出现"


def _with_negative_prompt(prompt: str, negative_prompt: str) -> tuple[str, str]:
    """把全局负面提示词折进 prompt 正文，返回 ``(最终提示词, 说明)``。

    APIMart 的 ``/images/generations`` 请求体只有 ``prompt / n / size / resolution /
    image_urls / model``，**没有**负面提示词字段；上游出图服务通道才支持单独的
    ``negative_prompt``。这里如实把它写进正文并在响应里说明，而不是静默丢掉。
    """
    text = str(prompt or "").strip().rstrip("。")
    negative = str(negative_prompt or "").strip()
    if not negative:
        return text + "。", ""
    return (
        f"{text}。{NEGATIVE_PROMPT_PREFIX}：{negative}。",
        "APIMart 图片契约没有独立的负面提示词字段：本次全局负面提示词已折进 prompt 正文"
        f"（以「{NEGATIVE_PROMPT_PREFIX}：」开头），不是单独字段。",
    )


async def build_costume_targets(
    db: AsyncSession,
    *,
    project_id: str,
    asset_ids: list[str] | None = None,
    prompt_overrides: dict[str, str] | None = None,
    aspect_ratio: str = "",
    image_model: str = "",
    negative_prompt: str = "",
    attempt: int = 0,
    stage: str = "",
) -> tuple[list[SubmissionTarget], list[str]]:
    """组装服装的提交目标（**只读、不触网**；与 ``build_targets`` 同形同口径）。

    - 提示词解析规则与上游通道**共用一份实现**（``resolve_asset_prompt``）：
      调用方覆盖 → 该服装已保存的 ``image_prompts.costume_image_front`` → 确定性服装模板；
    - 画幅按服装自己的口径（``strategies.resolve_aspect_ratio``），但要落在 APIMart
      支持的三个比例内（``1:1 / 3:4 / 16:9``），不在范围内**明确报错**而不是偷偷改；
    - 结果类型固定 ``costumeDesignImage`` /「服装设定图」，模板名
      ``costume_design_image``（分流表是唯一来源）；
    - **不带参考图**：``reference_image`` 恒为空 —— 服装不套用人物参考图。
    """
    strategy = strategies.strategy_for(COSTUME_ASSET_TYPE)
    warnings: list[str] = []

    ratio_resolution = strategies.resolve_aspect_ratio(COSTUME_ASSET_TYPE, aspect_ratio)
    ratio = ratio_resolution.ratio
    if ratio_resolution.warning:
        warnings.append(ratio_resolution.warning)
    if ratio not in SUPPORTED_RATIOS:
        raise ValueError(
            f"{strategy.result_label}走 APIMart 图片通道，只支持这些比例 {list(SUPPORTED_RATIOS)}，"
            f"收到「{ratio}」（不给则默认 {strategies.DEFAULT_ASPECT_RATIO}）。"
        )
    warnings.append(strategies.describe_channel_for(COSTUME_ASSET_TYPE))
    warnings.append(
        "APIMart 图片通道是**同步等待**产物（不排队）：提交后最多等 "
        f"{int(DEFAULT_TIMEOUT_SECONDS)} 秒拿图；上游出图服务的 wait_seconds 对它不生效，"
        "所以这一项返回时状态已经是最终态（成功或失败）。"
    )
    if str(stage or "").strip() == "reference_batch":
        # 「按定版参考图批量出图」只对人物开放（唯一一份拒绝文案在 asset_strategies）：
        # 服装走这条路时明确忽略 + 如实回报，绝不静默带上参考图。
        warnings.append(strategies.describe_batch_reference_refusal(COSTUME_ASSET_TYPE))
    if str(image_model or "").strip():
        warnings.append(
            f"请求里的图片模型「{image_model}」是**上游出图服务**的选项标签，对 APIMart 通道不生效："
            "本次用数据库里配置的默认图片模型（供应商必须是 APIMart）。"
        )

    overrides = {str(k): str(v) for k, v in (prompt_overrides or {}).items() if str(v).strip()}
    rows = await _load_asset_rows(db, project_id=project_id, asset_type=COSTUME_ASSET_TYPE)
    wanted = {str(x) for x in asset_ids or [] if str(x).strip()}
    if wanted:
        rows = [row for row in rows if row.id in wanted]
        missing = wanted - {row.id for row in rows}
        if missing:
            warnings.append(f"以下资产 ID 不在项目 {project_id} 内，已忽略：{sorted(missing)}。")
    if not rows:
        return [], [
            *warnings,
            f"项目 {project_id} 内没有可提交的 {ASSET_TYPE_ZH.get(COSTUME_ASSET_TYPE, COSTUME_ASSET_TYPE)}。",
        ]
    if len(rows) > 1:
        warnings.append(
            f"本批共 {len(rows)} 个{ASSET_TYPE_ZH.get(COSTUME_ASSET_TYPE, COSTUME_ASSET_TYPE)}，"
            "APIMart 通道按单资产逐项出图，将逐个提交（每项一条结果、互不影响）。"
        )

    targets: list[SubmissionTarget] = []
    for row in rows:
        prompt, prompt_source = resolve_asset_prompt(
            row=row,
            asset_type=COSTUME_ASSET_TYPE,
            slot_category=strategy.prompt_slot,
            override=overrides.get(row.id) or "",
        )
        final_prompt, negative_note = _with_negative_prompt(prompt, negative_prompt)
        target_warnings: list[str] = []
        if negative_note:
            target_warnings.append(negative_note)
        targets.append(
            SubmissionTarget(
                source_task_id=build_source_task_id(
                    project_id=project_id,
                    asset_type=COSTUME_ASSET_TYPE,
                    asset_id=row.id,
                    prompt=prompt,
                    attempt=attempt,
                ),
                source_asset_id=row.id,
                asset_type=COSTUME_ASSET_TYPE,
                name=str(row.name or row.id),
                prompt=final_prompt,
                stage=stage or STAGE_COSTUME_DESIGN,
                negative_prompt=negative_prompt,
                style_tags=[str(t) for t in (getattr(row, "tags", None) or [])],
                # 服装**不带参考图**（这是"不套用人物参考图"的机器可读证据）
                reference_image="",
                generation_type="",
                aspect_ratio=ratio,
                prompt_source=prompt_source,
                image_model="",
                object_key_template=build_object_key_template(
                    project_id=project_id, asset_type=COSTUME_ASSET_TYPE
                ),
                profile_card=str(getattr(row, "description", "") or ""),
                result_kind=strategy.result_kind,
                result_label=strategy.result_label,
                aspect_ratio_source=ratio_resolution.source,
                prompt_template=strategy.prompt_template,
                channel=strategy.channel,
                warnings=target_warnings,
            )
        )
    # 与上游通道**同一个**旧提示词质量关卡（服装也不能拿"外观信息不足"这类空话去出图）
    guarded, gate_warnings = exclude_unusable_saved_prompts(targets)
    return guarded, [*warnings, *gate_warnings]


@dataclass(slots=True)
class CostumeChannelContext:
    """一次批量提交共用的供应商上下文（整批只解析一次 DB 配置）。"""

    provider_key: str = ""
    model_id: str = ""
    model_name: str = ""
    base_url: str = ""
    api_key: str = ""
    notes: list[str] = field(default_factory=list)


async def resolve_costume_channel_context(
    db: AsyncSession,
    *,
    model_id: str | None = None,
) -> CostumeChannelContext:
    """解析本次要用的图片模型与供应商（**必须**是 APIMart，否则结构化 409）。

    与 ``reference_regenerate`` 同一套解析：图片模型取自数据库（默认图片模型或显式
    ``model_id``），供应商不是 apimart 时明确拒绝并给出改法，**不静默**换通道。
    """
    model = await resolve_image_model(db, model_id)
    provider_info = await resolve_provider_config_by_model(db, model=model)
    provider_key = str(getattr(provider_info, "provider_key", "") or "")
    model_name = str(getattr(model, "name", "") or "")
    resolved_id = str(getattr(model, "id", "") or "")
    if provider_key != "apimart":
        raise HTTPException(
            status_code=409,
            detail={
                "code": ERROR_PROVIDER_NOT_APIMART,
                "message": (
                    "服装设定图走的是 Jellyfish 自己的 APIMart 图片通道（上游出图服务契约里没有 "
                    f"costume）；当前图片模型「{model_name or resolved_id}」的供应商是"
                    f"「{provider_key or '未知'}」，这条通道用不了。"
                ),
                "provider": provider_key,
                "model_id": resolved_id,
                "asset_type": COSTUME_ASSET_TYPE,
                "channel": strategies.CHANNEL_APIMART,
                "how_to_fix": (
                    "在工作室设置里把默认图片模型切到 APIMart 供应商的模型后重试。"
                    "人物/场景/道具不受影响：它们走上游出图服务通道。"
                ),
                "paid_call_made": False,
            },
        )
    return CostumeChannelContext(
        provider_key=provider_key,
        model_id=resolved_id,
        model_name=model_name,
        base_url=str(getattr(provider_info, "base_url", "") or ""),
        api_key=str(getattr(provider_info, "api_key", "") or ""),
    )


def _dry_run_result(target: SubmissionTarget) -> ImageTaskResultRead:
    """演练占位：结构完整、地址不可达、绝不触网（与上游通道的占位口径一致）。"""
    return ImageTaskResultRead(
        source_task_id=target.source_task_id,
        source_asset_id=target.source_asset_id,
        asset_type=target.asset_type,
        stage=target.stage,
        service_task_id=dry_run.fake_task_id("image", target.source_asset_id),
        status="dry_run",
        outcome=OUTCOME_DRY_RUN,
        ok=True,
        dry_run=True,
        image_url=dry_run.fake_image_url(target.source_asset_id),
        oss_url="",
        oss_ready=False,
        message=(
            "[DRY_RUN] 未提交 APIMart 服装设定图生成；这是占位结果，不是真实图片地址。"
        ),
        result_kind=target.result_kind,
        result_label=target.result_label,
        aspect_ratio=target.aspect_ratio,
        aspect_ratio_source=target.aspect_ratio_source,
        channel=target.channel,
        channel_label=strategies.channel_label(target.channel),
        detail={
            "error_message": "",
            "http_status": None,
            "note": "[DRY_RUN] 占位结果，未向 APIMart 发出任何请求。",
            "result_kind": target.result_kind,
            "result_label": target.result_label,
            "aspect_ratio": target.aspect_ratio,
            "aspect_ratio_source": target.aspect_ratio_source,
            "prompt_template": target.prompt_template,
            "channel": target.channel,
            "channel_label": strategies.channel_label(target.channel),
            "channel_note": strategies.describe_channel_for(target.asset_type),
            "reference_image_url": "",
        },
    )


def _inflight_result(target: SubmissionTarget) -> ImageTaskResultRead:
    """同一轮**正在执行中**（连点）：如实回报"还在跑"，绝不重复提交、绝不再付一次费。"""
    return ImageTaskResultRead(
        source_task_id=target.source_task_id,
        source_asset_id=target.source_asset_id,
        asset_type=target.asset_type,
        stage=target.stage,
        service_task_id="",
        status="in_flight",
        outcome=OUTCOME_RUNNING,
        ok=False,
        dry_run=False,
        image_url="",
        oss_url="",
        oss_ready=False,
        message=(
            f"这一轮（source_task_id={target.source_task_id}）正在执行中：本次没有重复提交，"
            "也没有产生第二次费用。"
        ),
        error_message="",
        result_kind=target.result_kind,
        result_label=target.result_label,
        aspect_ratio=target.aspect_ratio,
        aspect_ratio_source=target.aspect_ratio_source,
        channel=target.channel,
        channel_label=strategies.channel_label(target.channel),
        detail={
            "error_message": "",
            "http_status": None,
            "status": "in_flight",
            "channel": target.channel,
            "channel_label": strategies.channel_label(target.channel),
            "how_to_fix": "等这一轮结束后再看结果；确实要再生成一次，把 attempt 加 1 再提交。",
            "paid_call_made": False,
        },
    )


def _result_from_generation(
    target: SubmissionTarget,
    *,
    generated: Any,
    context: CostumeChannelContext,
) -> ImageTaskResultRead:
    """把 APIMart 的产物映射成**与上游通道同形**的一条结果。"""
    images = list(getattr(generated, "images", []) or [])
    image_url = str(getattr(images[0], "url", "") or "") if images else ""
    provider_task_id = str(getattr(generated, "provider_task_id", "") or "")
    provider_notes = [str(x) for x in (getattr(generated, "provider_notes", []) or [])]
    status = str(getattr(generated, "status", "") or "succeeded")
    oss_url = _own_oss_url(image_url)
    return ImageTaskResultRead(
        source_task_id=target.source_task_id,
        source_asset_id=target.source_asset_id,
        asset_type=target.asset_type,
        stage=target.stage,
        service_task_id=provider_task_id,
        status=status,
        outcome=OUTCOME_OK,
        ok=True,
        dry_run=False,
        image_url=image_url,
        oss_url=oss_url,
        oss_ready=bool(oss_url),
        message=(
            f"已按{target.result_label or '服装设定图'}提示词生成一张图。"
            + ("" if oss_url else "注意：这是供应商返回的临时地址，不是长期资产地址。")
        ),
        error_message="",
        http_status=None,
        result_kind=target.result_kind,
        result_label=target.result_label,
        aspect_ratio=target.aspect_ratio,
        aspect_ratio_source=target.aspect_ratio_source,
        channel=target.channel,
        channel_label=strategies.channel_label(target.channel),
        detail={
            "error_message": "",
            "http_status": None,
            "oss_url": oss_url,
            "local_path": "",
            "images": [{"url": item} for item in _image_urls(generated)],
            "status": status,
            "result_kind": target.result_kind,
            "result_label": target.result_label,
            "aspect_ratio": target.aspect_ratio,
            "aspect_ratio_source": target.aspect_ratio_source,
            "prompt_template": target.prompt_template,
            "channel": target.channel,
            "channel_label": strategies.channel_label(target.channel),
            "provider": str(getattr(generated, "provider", "apimart") or "apimart"),
            "provider_task_id": provider_task_id,
            "provider_notes": provider_notes,
            "provider_model": context.model_name,
            # 服装这一条**不带参考图**：请求体里没有 image_urls
            "reference_image_url": "",
            "how_to_keep": (
                "要长期保存这张图：在结果卡片上「采纳」它（POST /studio/image-pipeline/adopt，"
                "entity_type=costume），采纳后可设为定版。"
            ),
        },
    )


def _image_urls(generated: Any) -> list[str]:
    out: list[str] = []
    for item in list(getattr(generated, "images", []) or []):
        value = str(getattr(item, "url", "") or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def _own_oss_url(url: str) -> str:
    """供应商返回的地址**只有落在我们自己的对象存储公网基址下**才算长期资产地址。

    与 ``reference_regenerate._own_oss_url`` 同口径；这里不写 OSS，只做判定。
    """
    text = str(url or "").strip()
    if not text:
        return ""
    from app.config import settings

    base = str(getattr(settings, "s3_public_base_url", "") or "").strip().rstrip("/")
    if base and text.startswith(f"{base}/"):
        return text
    return ""


def _failed_result(
    target: SubmissionTarget,
    *,
    error_message: str,
    how_to_fix: str = "",
) -> ImageTaskResultRead:
    """供应商失败 → **照样返回一条结果**（与既有结果卡片同形），不抛 5xx 断掉整条链路。"""
    http_status = _http_status_from_text(error_message)
    return ImageTaskResultRead(
        source_task_id=target.source_task_id,
        source_asset_id=target.source_asset_id,
        asset_type=target.asset_type,
        stage=target.stage,
        service_task_id="",
        status="failed",
        outcome=OUTCOME_FAILED,
        ok=False,
        dry_run=False,
        image_url="",
        oss_url="",
        oss_ready=False,
        message=error_message,
        error_message=error_message,
        http_status=http_status,
        result_kind=target.result_kind,
        result_label=target.result_label,
        aspect_ratio=target.aspect_ratio,
        aspect_ratio_source=target.aspect_ratio_source,
        channel=target.channel,
        channel_label=strategies.channel_label(target.channel),
        detail={
            "error_message": error_message,
            "http_status": http_status,
            "oss_url": "",
            "local_path": "",
            "images": [],
            "status": "failed",
            "provider": "apimart",
            "result_kind": target.result_kind,
            "result_label": target.result_label,
            "aspect_ratio": target.aspect_ratio,
            "aspect_ratio_source": target.aspect_ratio_source,
            "prompt_template": target.prompt_template,
            "channel": target.channel,
            "channel_label": strategies.channel_label(target.channel),
            "reference_image_url": "",
            "how_to_fix": how_to_fix
            or "本次失败来自供应商侧：可按上面的原文排障；确实要再生成一次请把 attempt 加 1（同一 attempt 是同一轮，不会重复付费）。",
        },
    )


async def submit_costume_targets(
    db: AsyncSession,
    targets: list[SubmissionTarget],
    *,
    model_id: str | None = None,
    transport: Any = None,
    adapter: Any = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    resolution_profile: str = "standard",
) -> list[ImageTaskResultRead]:
    """逐项提交服装出图（APIMart 通道），每项一条结果，互不影响。

    ``transport`` / ``adapter`` 仅供测试注入（``httpx.MockTransport`` / 假适配器）；
    生产留空即走真实 APIMart。

    执行顺序刻意排成这样：**DRY_RUN 短路 → 守卫 → 解析供应商（必须 APIMart）→
    逐项幂等登记 → 出图**。任何一项失败都只影响它自己那一条结果。
    """
    if not targets:
        return []

    # 演练模式：占位结果，一个字节都不出网（也不占用幂等登记）。
    if dry_run.dry_run_enabled():
        return [_dry_run_result(target) for target in targets]

    # 真实提交：会产生费用 → 守卫（与既有出口同一个）。
    paid_outlet_guard.require_outlet(
        f"服装设定图生成 {len(targets)} 项（APIMart 通道）",
        outlet=paid_outlet_guard.OUTLET_IMAGE,
    )
    dry_run.assert_outbound_allowed(
        f"服装设定图生成 {len(targets)} 项（APIMart 通道）",
        outlet=dry_run.OUTLET_IMAGE,
    )

    context = await resolve_costume_channel_context(db, model_id=model_id)
    runner = adapter or ApimartImageApiAdapter(transport=transport)
    cfg = ProviderConfig(
        provider="apimart",
        api_key=context.api_key,
        base_url=context.base_url or None,
    )

    results: list[ImageTaskResultRead] = []
    for target in targets:
        state, cached = _reserve_round(target.source_task_id)
        if state == "inflight":
            results.append(_inflight_result(target))
            continue
        if state == "completed" and cached is not None:
            results.append(cached)
            continue
        try:
            generated = await runner.generate(
                cfg=cfg,
                inp=ImageGenerationInput(
                    prompt=target.prompt,
                    # **不带参考图**：APIMart 请求体里不会出现 image_urls
                    images=[],
                    model=context.model_name or None,
                    # type: ignore[arg-type] - 画幅已按 SUPPORTED_RATIOS 校验过
                    target_ratio=target.aspect_ratio,
                    resolution_profile=resolution_profile,  # type: ignore[arg-type]
                    purpose="asset_image",
                    n=1,
                ),
                timeout_s=float(timeout_seconds),
            )
        except ApimartImageError as exc:
            result = _failed_result(
                target,
                error_message=f"APIMart 服装设定图生成失败：{exc}",
            )
            _remember_round(target.source_task_id, result)
            results.append(result)
            continue
        except BaseException:
            # 任何其它异常都不能把这一轮永久占在「正在执行中」里
            _forget_round(target.source_task_id)
            raise
        result = _result_from_generation(target, generated=generated, context=context)
        _remember_round(target.source_task_id, result)
        results.append(result)
    return results


__all__ = [
    "COSTUME_ASSET_TYPE",
    "DEFAULT_TIMEOUT_SECONDS",
    "ERROR_PROVIDER_NOT_APIMART",
    "NEGATIVE_PROMPT_PREFIX",
    "STAGE_COSTUME_DESIGN",
    "CostumeChannelContext",
    "build_costume_targets",
    "resolve_costume_channel_context",
    "submit_costume_targets",
]
