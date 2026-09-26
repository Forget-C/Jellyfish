"""按 ``asset_type`` 分流出图通道：出图入口的**唯一路由层**。

一次提交里可以同时含 character / scene / prop / costume，本模块负责**逐项**路由：

===========================================  ======================  ==============================
资产类型                                      通道                     模板 / 口径
===========================================  ======================  ==============================
character                                    上游出图服务             人物参考图（固定 16:9；参考图批量只对它开放）
scene                                        上游出图服务             场景资产图
prop                                         上游出图服务             道具资产图
costume                                      Jellyfish APIMart       服装设定图（不带参考图、不套人物/场景模板）
===========================================  ======================  ==============================

为什么必须这样分：上游出图服务（另一个项目，只读）的契约只接受 character/scene/prop；
把服装按人物或场景发过去会被对端拒绝 —— 那正是要避免的「套用模板」。分流表只有一份
（``asset_strategies.STRATEGIES`` 的 ``channel`` 列），本模块与路由都不自己写 if。

硬约束：

1. **逐项分流、逐项回报**：每条结果带自己的 ``channel``，响应里另有分组口径
   （``groups``）与整数计数（``summary.by_channel``），绝不静默；
2. **混合批量下任一项失败不污染其它项**：``isolate_errors=True`` 时每一项单独提交、
   单独兜底成 ``outcome=failed`` 的结果（带原文与修法），其它项照常出结论；
   单类型形态（``isolate_errors=False``）沿用既有行为：异常照旧抛给路由映射成
   400 / 409 / 502，**一个字都不变**；
3. **守卫异常一律不兜底**：付费守卫拦截（演练模式 / 未确认 / 出口白名单）是"整单没有
   发出去"，必须原样抛出，不能伪装成"某一项失败"。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.studio.image_pipeline import ImageChannelPlanRead, ImageTaskResultRead
from app.services import paid_outlet_guard
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.image_pipeline import costume_channel
from app.services.studio.image_pipeline import image_pipeline as pipeline
from app.services.studio.llm_orchestration import dry_run

#: 混合批量的汇总口径：一次请求用到两条通道时 ``asset_type`` 的展示值
MIXED_ASSET_TYPE = "mixed"


def request_items(body: Any) -> list[dict[str, Any]]:
    """把请求体归一成 ``items`` 列表（**不传 items 时就是旧的单类型形态**）。

    每项形如::

        {"asset_type": "costume", "asset_ids": ["costume-1"],
         "prompt_overrides": {"costume-1": "…"}}

    返回顺序 = 请求里的顺序（结果顺序可预期，便于前端对账）。
    """
    raw_items = list(getattr(body, "items", None) or [])
    if raw_items:
        return [
            {
                "asset_type": str(getattr(item, "asset_type", "") or ""),
                "asset_ids": [str(x) for x in (getattr(item, "asset_ids", None) or [])],
                "prompt_overrides": {
                    str(override.asset_id): str(override.prompt)
                    for override in (getattr(item, "prompt_overrides", None) or [])
                },
            }
            for item in raw_items
        ]
    return [
        {
            "asset_type": str(getattr(body, "asset_type", "") or ""),
            "asset_ids": [str(x) for x in (getattr(body, "asset_ids", None) or [])],
            "prompt_overrides": {
                str(override.asset_id): str(override.prompt)
                for override in (getattr(body, "prompt_overrides", None) or [])
            },
        }
    ]


def _validate_items(items: list[dict[str, Any]]) -> None:
    """形状检查：同一 ``asset_type`` 只能出现一项（合并是调用方的事，后端不猜）。

    为什么拒绝而不是静默合并：同一资产被两个 item 同时提交会**重复出图、重复计费**，
    而合并又会悄悄丢掉后一项的提示词覆盖 —— 两种都不如直接说清楚让调用方改。
    """
    seen: dict[str, int] = {}
    for index, item in enumerate(items, start=1):
        asset_type = str(item.get("asset_type") or "").strip().lower()
        if not asset_type:
            raise ValueError(f"items 第 {index} 项缺少 asset_type。")
        if asset_type in seen:
            raise ValueError(
                f"items 里 asset_type「{asset_type}」出现多次（第 {seen[asset_type]} 项与第 {index} 项）："
                "同一类型请合并成一项（asset_ids 里放多个资产），避免同一资产被重复提交、重复计费。"
            )
        seen[asset_type] = index


@dataclass(slots=True)
class ChannelGroup:
    """一个 ``asset_type`` 分组的提交目标 + 它走的那条通道（只读口径）。"""

    asset_type: str
    channel: str
    channel_note: str
    result_kind: str
    result_label: str
    prompt_template: str
    asset_ids: list[str] = field(default_factory=list)
    targets: list[pipeline.SubmissionTarget] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def channel_label(self) -> str:
        return strategies.channel_label(self.channel)

    def to_read(self) -> ImageChannelPlanRead:
        return ImageChannelPlanRead(
            asset_type=self.asset_type,
            asset_ids=list(self.asset_ids),
            channel=self.channel,
            channel_label=self.channel_label,
            channel_note=self.channel_note,
            result_kind=self.result_kind,
            result_label=self.result_label,
            prompt_template=self.prompt_template,
            target_count=len(self.targets),
            warnings=list(self.warnings),
        )


async def build_channel_groups(
    db: AsyncSession,
    *,
    project_id: str,
    items: list[dict[str, Any]],
    stage: str,
    aspect_ratio: str = "",
    image_model: str = "",
    negative_prompt: str = "",
    attempt: int = 0,
    use_primary_reference: bool = True,
    chapter_id: str = "",
    vendor_builder: Any = None,
) -> tuple[list[ChannelGroup], list[str]]:
    """逐项组装提交目标（**只读、不触网**）。

    返回 ``(groups, warnings)``；每项按 ``asset_type`` 选通道：

    - 上游通道（人物/场景/道具）→ :func:`image_pipeline.build_targets`（既有实现，行为不变）；
    - APIMart 通道（服装）→ :func:`costume_channel.build_costume_targets`。

    公共参数（``stage`` / 画幅 / 负面词 / 图片模型 / attempt）由请求顶层给出，逐项共用。

    ``vendor_builder``：上游通道的组装函数，默认 :func:`image_pipeline.build_targets`；
    路由层把自己的同名入口传进来（这样既有的"替换路由模块上的 build_targets"式
    单测接缝继续有效，两条通道的组装实现本身仍只有一份）。
    """
    _validate_items(items)
    builder = vendor_builder or pipeline.build_targets
    groups: list[ChannelGroup] = []
    warnings: list[str] = []

    for item in items:
        asset_type = str(item.get("asset_type") or "").strip().lower()
        # 不认识的类型 → ValueError（路由映射成 400），绝不按人物处理
        strategy = strategies.strategy_for(asset_type)
        asset_ids = [str(x) for x in (item.get("asset_ids") or []) if str(x).strip()]
        overrides = dict(item.get("prompt_overrides") or {})

        if strategy.uses_vendor_service:
            group_targets, group_warnings = await builder(
                db,
                project_id=project_id,
                asset_type=asset_type,
                stage=stage,
                asset_ids=asset_ids,
                prompt_overrides=overrides,
                use_primary_reference=use_primary_reference,
                aspect_ratio=aspect_ratio,
                image_model=image_model,
                negative_prompt=negative_prompt,
                attempt=attempt,
                chapter_id=chapter_id,
            )
        else:
            group_targets, group_warnings = await costume_channel.build_costume_targets(
                db,
                project_id=project_id,
                asset_ids=asset_ids,
                prompt_overrides=overrides,
                aspect_ratio=aspect_ratio,
                image_model=image_model,
                negative_prompt=negative_prompt,
                attempt=attempt,
                stage=stage,
            )

        groups.append(
            ChannelGroup(
                asset_type=asset_type,
                channel=strategy.channel,
                channel_note=strategies.describe_channel_for(asset_type),
                result_kind=strategy.result_kind,
                result_label=strategy.result_label,
                prompt_template=strategy.prompt_template,
                asset_ids=asset_ids,
                targets=group_targets,
                warnings=list(group_warnings),
            )
        )
        warnings.extend(group_warnings)
    return groups, warnings


def _is_guard_block(exc: BaseException) -> bool:
    """是不是付费守卫的拦截（这类异常一律不兜底：整单都没发出去）。"""
    d = dry_run
    guard_types: tuple[type[BaseException], ...] = (
        d.DryRunBlocked,
        d.RealCallNotConfirmed,
        d.OutletNotAllowed,
        paid_outlet_guard.PaidOutletBlocked,
    )
    return isinstance(exc, guard_types)


def _isolated_failure(
    target: pipeline.SubmissionTarget,
    *,
    exc: BaseException,
) -> ImageTaskResultRead:
    """把一项的异常如实变成一条 ``outcome=failed`` 的结果（其它项不受影响）。"""
    if isinstance(exc, HTTPException):
        detail = exc.detail
        message = (
            str(detail.get("message") or detail.get("code") or "")
            if isinstance(detail, dict)
            else str(detail)
        )
        error_detail: Any = detail
    else:
        message = str(exc)
        error_detail = {"code": "image_submit_failed", "message": message}
    text = f"{target.result_label or '该项'}提交失败：{message}"
    return ImageTaskResultRead(
        source_task_id=target.source_task_id,
        source_asset_id=target.source_asset_id,
        asset_type=target.asset_type,
        stage=target.stage,
        service_task_id="",
        status="failed",
        outcome=pipeline.OUTCOME_FAILED,
        ok=False,
        dry_run=False,
        image_url="",
        oss_url="",
        oss_ready=False,
        message=text,
        error_message=text,
        result_kind=target.result_kind,
        result_label=target.result_label,
        aspect_ratio=target.aspect_ratio,
        aspect_ratio_source=target.aspect_ratio_source,
        channel=target.channel,
        channel_label=strategies.channel_label(target.channel),
        detail={
            "error_message": text,
            "http_status": None,
            "oss_url": "",
            "local_path": "",
            "images": [],
            "status": "failed",
            "result_kind": target.result_kind,
            "result_label": target.result_label,
            "aspect_ratio": target.aspect_ratio,
            "aspect_ratio_source": target.aspect_ratio_source,
            "prompt_template": target.prompt_template,
            "channel": target.channel,
            "channel_label": strategies.channel_label(target.channel),
            "channel_note": strategies.describe_channel_for(target.asset_type),
            "error_detail": error_detail,
            "how_to_fix": (
                "本项失败只影响它自己：其它资产/其它类型的结论照常返回。"
                "修好原因后可单独重提这一项（把 attempt 加 1 会拿到新的幂等键）。"
            ),
        },
    )


async def submit_channel_groups(
    db: AsyncSession,
    groups: list[ChannelGroup],
    *,
    wait_seconds: float = 0.0,
    transport: Any = None,
    adapter: Any = None,
    timeout_seconds: float = costume_channel.DEFAULT_TIMEOUT_SECONDS,
    model_id: str | None = None,
    preflight: Any = None,
    isolate_errors: bool = False,
    vendor_submitter: Any = None,
) -> list[ImageTaskResultRead]:
    """逐组提交（组 = 一个 ``asset_type``），返回**按组顺序**铺平的结果列表。

    ``isolate_errors=True``（混合批量专用）：每一项单独提交、单独兜底 —— 任一项失败
    都不会污染其它项的结论，结果里一项一条（整数计数照旧）。

    ``isolate_errors=False``（旧的单类型形态）：整组一次性交给既有实现，
    异常照旧抛出（路由映射成 400 / 409 / 502），**既有行为逐字不变**。

    ``vendor_submitter``：上游通道的提交函数，默认 :func:`image_pipeline.submit_targets`
    （与 ``vendor_builder`` 同理，保留路由层既有的单测接缝）。
    """
    submitter = vendor_submitter or pipeline.submit_targets
    results: list[ImageTaskResultRead] = []
    for group in groups:
        if not group.targets:
            continue
        if not isolate_errors:
            results.extend(
                await _submit_group(
                    db,
                    group,
                    wait_seconds=wait_seconds,
                    transport=transport,
                    adapter=adapter,
                    timeout_seconds=timeout_seconds,
                    model_id=model_id,
                    preflight=preflight,
                    vendor_submitter=submitter,
                )
            )
            continue
        for target in group.targets:
            single = ChannelGroup(
                asset_type=group.asset_type,
                channel=group.channel,
                channel_note=group.channel_note,
                result_kind=group.result_kind,
                result_label=group.result_label,
                prompt_template=group.prompt_template,
                asset_ids=[target.source_asset_id],
                targets=[target],
                warnings=list(group.warnings),
            )
            try:
                results.extend(
                    await _submit_group(
                        db,
                        single,
                        wait_seconds=wait_seconds,
                        transport=transport,
                        adapter=adapter,
                        timeout_seconds=timeout_seconds,
                        model_id=model_id,
                        preflight=preflight,
                        vendor_submitter=submitter,
                    )
                )
            except BaseException as exc:  # noqa: BLE001 - 逐项兜底是这里的设计意图
                if _is_guard_block(exc):
                    raise
                results.append(_isolated_failure(target, exc=exc))
    return results


async def _submit_group(
    db: AsyncSession,
    group: ChannelGroup,
    *,
    wait_seconds: float,
    transport: Any,
    adapter: Any,
    timeout_seconds: float,
    model_id: str | None,
    preflight: Any,
    vendor_submitter: Any = None,
) -> list[ImageTaskResultRead]:
    """把一个组交给它自己那条通道（逐项分流唯一落地处）。"""
    if group.channel == strategies.CHANNEL_VENDOR_SERVICE:
        submitter = vendor_submitter or pipeline.submit_targets
        return await submitter(
            group.targets,
            wait_seconds=wait_seconds,
            transport=transport,
            preflight=preflight,
        )
    if group.channel == strategies.CHANNEL_APIMART:
        return await costume_channel.submit_costume_targets(
            db,
            group.targets,
            model_id=model_id,
            transport=transport,
            adapter=adapter,
            timeout_seconds=timeout_seconds,
        )
    raise ValueError(
        f"不认识的出图通道「{group.channel}」：分流表只覆盖 {list(strategies.REAL_CHANNELS)}。"
    )


def group_channels(groups: list[ChannelGroup]) -> list[str]:
    """本次请求**涉及**的通道（逐组去重、保序）。

    刻意**不看有没有目标**：请求里点了服装，即使项目里一件服装都没有（``target_count=0``），
    也要如实说明"这类走的是 APIMart 通道"，而不是给一个空串让页面去猜。
    """
    out: list[str] = []
    for group in groups:
        if group.channel not in out:
            out.append(group.channel)
    return out


def describe_channels(groups: list[ChannelGroup]) -> tuple[str, str, list[str]]:
    """汇总口径：``(channel, channel_label, channel_notes)``。

    - 只有一条通道 → 如实回报这一条；
    - 两条都用 → ``mixed`` + 中文说明（逐项分流，不是第三条通道）；
    - 一条都没有（没有可提交目标）→ 空串（不编造）。
    """
    used = group_channels(groups)
    if not used:
        return "", "", []
    if len(used) == 1:
        notes = [groups[0].channel_note] if groups else []
        return used[0], strategies.channel_label(used[0]), notes
    notes = [strategies.describe_mixed_channels([group.asset_type for group in groups])]
    notes.extend(group.channel_note for group in groups)
    return strategies.CHANNEL_MIXED, strategies.channel_label(strategies.CHANNEL_MIXED), notes


def asset_type_label(groups: list[ChannelGroup]) -> str:
    """响应里的 ``asset_type``：单一类型照旧，混合批量用 ``mixed``。"""
    types = [group.asset_type for group in groups]
    unique = list(dict.fromkeys(types))
    if len(unique) == 1:
        return unique[0]
    return MIXED_ASSET_TYPE


def strategy_read(groups: list[ChannelGroup]) -> dict[str, Any]:
    """单一类型时的策略只读口径；混合批量返回空（逐组口径在 ``groups`` 里）。"""
    unique = list(dict.fromkeys(group.asset_type for group in groups))
    if len(unique) == 1:
        return strategies.strategy_for(unique[0]).to_read()
    return {}


def channel_counts(items: list[Any]) -> dict[str, int]:
    """按 ``.channel`` 做**整数计数**（提交目标或结果都适用）。

    空列表 → ``{}``（空映射），绝不出现 0/0 这种没有意义的比值。
    """
    counts: dict[str, int] = {}
    for item in items:
        channel = str(getattr(item, "channel", "") or "")
        if channel:
            counts[channel] = counts.get(channel, 0) + 1
    return counts


__all__ = [
    "MIXED_ASSET_TYPE",
    "ChannelGroup",
    "asset_type_label",
    "build_channel_groups",
    "channel_counts",
    "describe_channels",
    "group_channels",
    "request_items",
    "strategy_read",
    "submit_channel_groups",
]
