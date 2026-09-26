"""「使用已有参考图重新生成」——**可选返工流程**（不是默认主流程）。

两条链路的分工（用户口径已澄清）：

- **默认主流程 = 按提示词直接生成参考图**：``POST /studio/image-pipeline/submit``
  （``stage=character_sheet`` / ``reference_batch``），把提示词交给上游服务端点产出
  人物 / 场景 / 道具参考图：**按提示词直接生成**，不传参考图照样出图。（代码与响应文案里
  不要把它描述成需要已有图的流程，也不用「垫图」这类模糊词。）
- **本模块 = 可选返工**：只有该资产**已经有参考图**、且用户明确要求保持一致性时才用。
  它走 **Jellyfish 自己的 APIMart 图片通道**（``app/core/integrations/apimart/images.py``，
  参考图字段名 ``image_urls``），把**公网可用**的那张参考图真的传进请求。

为什么不把参考图交给上游服务端点：上游那个端点对图生图有已知限制（参考图不保证透传），
而 APIMart 通道的 ``image_urls`` 已经实测跑通（关键帧出图那条真实调用走的就是它）。

安全边界（与既有提交链路同口径）：

- 参考图**必须是公网地址**：本机相对路径 / 内网地址一律判为不可用（判定复用
  ``reference_resolver`` 的 ``public_url_for_key`` 唯一口径）；
- 提交前逐张匿名探活（``reference_preflight.preflight_or_raise``）：不可达 → 409 + 结构化中文
  错误（哪个资产、真实状态码、怎么修、``paid_call_made:false``），**不提交、不写库、不出网**；
- 过付费守卫（``paid_outlet_guard.require_outlet`` + ``dry_run.assert_outbound_allowed``），
  DRY_RUN 下返回占位结果、一个字节都不出网；
- 幂等键复用 ``build_source_task_id``（含 ``attempt``）：**同一轮重复点击不重复付费**
  （登记在进程内，见 ``_reserve_round`` 的说明）。

术语约定：本模块与它的响应里**不使用「垫图」**这种模糊词，统一说「已有参考图」。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.contracts.image_generation import ImageGenerationInput, InputImageRef
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.apimart.images import (
    SUPPORTED_RATIOS,
    ApimartImageApiAdapter,
    ApimartImageError,
)
from app.schemas.studio.image_pipeline import (
    ImageTaskResultRead,
    ReferenceRegenerateRead,
    ReferenceRegenerateRequest,
)
from app.services import paid_outlet_guard
from app.services.llm.provider_resolver import resolve_provider_config_by_model
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.image_pipeline import (
    ASSET_TYPE_ZH,
    DEFAULT_ASPECT_RATIO,
    OUTCOME_DRY_RUN,
    OUTCOME_FAILED,
    OUTCOME_OK,
    PROMPT_SOURCE_REQUEST,
    PROMPT_SOURCE_SAVED,
    # 同包内的两个「唯一实现」：按项目装载资产、从错误原文抠 HTTP 状态码。
    # 不在这里各写第二份，否则两条链路的口径会悄悄跑偏。
    _http_status_from_text,
    _load_asset_rows,
    build_source_task_id,
    saved_image_prompt,
    summarize_results,
    summary_outcome,
)
from app.services.studio.image_pipeline.reference_resolver import (
    IMAGE_MODEL_BY_ASSET_TYPE,
    PARENT_FIELD_BY_ASSET_TYPE,
    resolve_file_url,
    resolve_references,
)
from app.services.studio.image_tasks import resolve_image_model
from app.services.studio.llm_orchestration import dry_run

#: 本端点支持的资产类型 = 分流表覆盖的类型（character / scene / prop / costume）。
#:
#: 比上游服务端的契约（character/scene/prop）多一个 costume —— 因为本端点**不经过**
#: 上游服务端点，走的是 Jellyfish 自己的 APIMart 图片通道，参考图来源是本地的图片槽位。
REGENERATE_ASSET_TYPES: tuple[str, ...] = strategies.SUPPORTED_ASSET_TYPES

#: 响应里 results[].stage 的取值（与默认主流程的 character_sheet / reference_batch 区分开）
STAGE_REFERENCE_REGENERATE = "reference_regenerate"

#: 参考图来源口径
REFERENCE_SOURCE_SLOT = "slot"
REFERENCE_SOURCE_EXPLICIT_URL = "explicit_url"
REFERENCE_SOURCE_ASSET_PRIMARY = "asset_primary"
REFERENCE_SOURCE_ASSET_FALLBACK = "asset_fallback"

#: 结构化错误码
ERROR_REFERENCE_UNAVAILABLE = "reference_image_unavailable"
ERROR_PROVIDER_NOT_APIMART = "reference_regenerate_requires_apimart"

#: 幂等登记的存活时间（秒）：同一轮（同一 source_task_id）在这段时间内重复点击不会再次付费。
DEDUPE_TTL_SECONDS = 1800.0

#: 进程内的幂等登记（``source_task_id`` → 时间）。为什么是进程内：APIMart 的
#: ``/images/generations`` **没有**幂等键，上游不会替我们去重；而本端点按设计**不写库**
#: （提交只出图、落库仍走用户显式「采纳」），所以没有可用的持久化登记表。
#: 覆盖的是真实场景「用户连点/重试同一轮」；重启进程后登记清空（要再生成请把 attempt 加 1）。
_INFLIGHT: dict[str, float] = {}
_COMPLETED: dict[str, tuple[float, ImageTaskResultRead]] = {}


def clear_regenerate_registry() -> None:
    """清空进程内幂等登记（仅供测试；生产不需要调用）。"""
    _INFLIGHT.clear()
    _COMPLETED.clear()


def _prune_registry(now: float) -> None:
    for key, started in list(_INFLIGHT.items()):
        if now - started > DEDUPE_TTL_SECONDS:
            _INFLIGHT.pop(key, None)
    for key, (done_at, _result) in list(_COMPLETED.items()):
        if now - done_at > DEDUPE_TTL_SECONDS:
            _COMPLETED.pop(key, None)


def _reserve_round(source_task_id: str) -> tuple[str, ImageTaskResultRead | None]:
    """登记本轮幂等键，返回 ``(状态, 可直接复用的上一次结果)``。

    - ``new``：第一次提交这一轮 —— 调用方负责付一次费，结束后 ``_remember_round``；
    - ``inflight``：同一轮**正在执行**（连点）—— 调用方应拒绝，绝不重复提交；
    - ``completed``：同一轮**刚刚已经跑完** —— 直接复用上一次结果，不再付费。
    """
    now = time.monotonic()
    _prune_registry(now)
    if source_task_id in _INFLIGHT:
        return "inflight", None
    cached = _COMPLETED.get(source_task_id)
    if cached is not None:
        return "completed", cached[1]
    _INFLIGHT[source_task_id] = now
    return "new", None


def _remember_round(source_task_id: str, result: ImageTaskResultRead) -> None:
    _INFLIGHT.pop(source_task_id, None)
    _COMPLETED[source_task_id] = (time.monotonic(), result)


def _forget_round(source_task_id: str) -> None:
    _INFLIGHT.pop(source_task_id, None)


@dataclass(slots=True)
class ResolvedReference:
    """本次真正要送进请求的那张**已有参考图**。"""

    url: str = ""
    label: str = ""
    source: str = ""
    image_id: int | None = None
    file_id: str = ""
    warnings: list[str] = field(default_factory=list)


def _unavailable_detail(
    *,
    asset_type: str,
    asset_id: str,
    asset_name: str,
    reference: ResolvedReference,
    reason: str,
) -> dict[str, Any]:
    """参考图不可用 → 结构化 409 明细（中文、可操作、``paid_call_made:false``）。"""
    label = reference.label or f"{ASSET_TYPE_ZH.get(asset_type, asset_type)}「{asset_name or asset_id}」"
    return {
        "code": ERROR_REFERENCE_UNAVAILABLE,
        "message": (
            f"「{label}」没有可用的公网参考图地址：{reason or '没有解析到地址'}。"
            "本次没有提交任何生成请求，也没有产生任何付费调用。"
        ),
        "asset_type": asset_type,
        "asset_id": asset_id,
        "asset_name": asset_name,
        "reference_source": reference.source,
        "reference_image_id": reference.image_id,
        "vendor": "apimart",
        "vendor_accepts": "公网 http(s) 地址（image_urls）",
        "how_to_fix": (
            "把这张参考图重新上传一次以生成公网可读（匿名 200）的地址，"
            "或改传 reference_url 指定一张公网图片；本机相对路径 / 内网地址一律不可用。"
        ),
        "paid_call_made": False,
        "note": "拒绝发生在提交之前：没有向供应商发出任何请求，也没有写库。",
    }


async def resolve_existing_reference(
    db: AsyncSession,
    *,
    body: ReferenceRegenerateRequest,
    asset_type: str,
    asset_id: str,
    asset_name: str,
) -> ResolvedReference:
    """解析「已有参考图」→ 一个**公网**地址（解析不到就抛结构化 409）。

    来源优先级：显式 ``reference_image_id``（槽位）> 显式 ``reference_url`` > 该资产的
    定版/首选图（唯一口径 ``reference_resolver.resolve_references``）。

    形态判定（本机相对路径 / 内网地址 / 非 http(s)）在这里就判死并给出修法；真实的
    匿名可达性（404 / 403 / 域名不存在）交给 ``reference_preflight.preflight_or_raise``。
    """
    reference = await _resolve_reference_source(
        db, body=body, asset_type=asset_type, asset_id=asset_id, asset_name=asset_name
    )
    url = str(reference.url or "").strip()
    if not url:
        reason = "；".join(str(x) for x in reference.warnings if str(x).strip())
        raise HTTPException(
            status_code=409,
            detail=_unavailable_detail(
                asset_type=asset_type,
                asset_id=asset_id,
                asset_name=asset_name,
                reference=reference,
                reason=reason or "该资产还没有任何图片，无法作为参考图（请先上传/采纳一张并设为定版）",
            ),
        )
    if not storage.is_public_url(url):
        reason = f"解析出来的地址不是公网 http(s) 地址（{url}），本机相对路径 / 内网地址一律不可用"
        raise HTTPException(
            status_code=409,
            detail=_unavailable_detail(
                asset_type=asset_type,
                asset_id=asset_id,
                asset_name=asset_name,
                reference=reference,
                reason=reason,
            ),
        )
    reference.url = url
    return reference


async def _resolve_reference_source(
    db: AsyncSession,
    *,
    body: ReferenceRegenerateRequest,
    asset_type: str,
    asset_id: str,
    asset_name: str,
) -> ResolvedReference:
    asset_zh = ASSET_TYPE_ZH.get(asset_type, asset_type)

    if body.reference_image_id is not None:
        image_model = IMAGE_MODEL_BY_ASSET_TYPE[asset_type]
        id_field = PARENT_FIELD_BY_ASSET_TYPE[asset_type]
        slot = await db.get(image_model, body.reference_image_id)
        if slot is None or str(getattr(slot, id_field)) != asset_id:
            raise HTTPException(
                status_code=404,
                detail=f"参考图槽位不存在：slot_id={body.reference_image_id} 不属于资产 {asset_id}。",
            )
        label = f"{asset_zh}「{asset_name or asset_id}」的已有参考图（槽位 #{slot.id}）"
        file_id = str(getattr(slot, "file_id", "") or "")
        if not file_id:
            return ResolvedReference(
                label=label,
                source=REFERENCE_SOURCE_SLOT,
                image_id=int(slot.id),
                warnings=["该槽位还没有绑定图片（file_id 为空）。"],
            )
        url, warning = await resolve_file_url(db, file_id=file_id)
        return ResolvedReference(
            url=url,
            label=label,
            source=REFERENCE_SOURCE_SLOT,
            image_id=int(slot.id),
            file_id=file_id,
            warnings=[warning] if warning else [],
        )

    explicit_url = str(body.reference_url or "").strip()
    if explicit_url:
        return ResolvedReference(
            url=explicit_url,
            label=f"{asset_zh}「{asset_name or asset_id}」显式指定的已有参考图",
            source=REFERENCE_SOURCE_EXPLICIT_URL,
        )

    # 都没传：用该资产**定版优先**的那张图（与批量出图那条路共用同一份解析实现）
    resolved = await resolve_references(db, asset_type=asset_type, asset_ids=[asset_id])
    item = resolved.get(asset_id)
    if item is None:
        return ResolvedReference(
            label=f"{asset_zh}「{asset_name or asset_id}」的已有参考图",
            source=REFERENCE_SOURCE_ASSET_PRIMARY,
            warnings=[f"没有解析到 {asset_id} 的参考图。"],
        )
    return ResolvedReference(
        url=item.url,
        label=f"{asset_zh}「{asset_name or asset_id}」的{('定版图' if item.is_primary else '已有图片')}",
        source=REFERENCE_SOURCE_ASSET_PRIMARY if item.is_primary else REFERENCE_SOURCE_ASSET_FALLBACK,
        file_id=item.file_id,
        warnings=list(item.warnings),
    )


def reference_candidates(reference: ResolvedReference) -> list[reference_preflight.ReferenceCandidate]:
    """本次真的要发出去的那张参考图 → 预检候选。

    ``allow_data_url=False``：APIMart 只吃公网 ``http(s)://``（内嵌 base64 未经验证），
    所以 data URL 必须在这里判死，而不是发出去才发现。
    """
    return [
        reference_preflight.ReferenceCandidate(
            label=reference.label or "已有参考图",
            url=reference.url,
            role="existing_reference_image",
            allow_data_url=False,
        )
    ]


def _result_from_generation(
    *,
    source_task_id: str,
    asset_type: str,
    asset_id: str,
    generated: Any,
    reference_url: str,
    result_kind: str = "",
    result_label: str = "",
    aspect_ratio: str = "",
    aspect_ratio_source: str = "",
) -> ImageTaskResultRead:
    """把 APIMart 通道的结果映射成**与既有出图结果同形**的一条结果。"""
    images = list(getattr(generated, "images", []) or [])
    image_url = str(getattr(images[0], "url", "") or "") if images else ""
    provider_task_id = str(getattr(generated, "provider_task_id", "") or "")
    provider_notes = [str(x) for x in (getattr(generated, "provider_notes", []) or [])]
    status = str(getattr(generated, "status", "") or "succeeded")
    oss_url = _own_oss_url(image_url)
    return ImageTaskResultRead(
        source_task_id=source_task_id,
        source_asset_id=asset_id,
        asset_type=asset_type,
        stage=STAGE_REFERENCE_REGENERATE,
        service_task_id=provider_task_id,
        status=status,
        outcome=OUTCOME_OK,
        ok=True,
        dry_run=False,
        image_url=image_url,
        oss_url=oss_url,
        oss_ready=bool(oss_url),
        message=(
            f"已用该资产的已有参考图重新生成一张{result_label or '图'}。"
            + ("" if oss_url else "注意：这是供应商返回的临时地址，不是长期资产地址。")
        ),
        error_message="",
        http_status=None,
        result_kind=result_kind,
        result_label=result_label,
        aspect_ratio=aspect_ratio,
        aspect_ratio_source=aspect_ratio_source,
        detail={
            "error_message": "",
            "http_status": None,
            "oss_url": oss_url,
            "local_path": "",
            "images": [{"url": item_url} for item_url in _image_urls(generated)],
            "status": status,
            "result_kind": result_kind,
            "result_label": result_label,
            "aspect_ratio": aspect_ratio,
            "aspect_ratio_source": aspect_ratio_source,
            "provider": str(getattr(generated, "provider", "apimart") or "apimart"),
            "provider_task_id": provider_task_id,
            "provider_notes": provider_notes,
            "reference_image_url": reference_url,
            "how_to_keep": (
                "要长期保存这张图：在结果卡片上「采纳」它（POST /studio/image-pipeline/adopt），"
                "或先上传到 OSS 再把该地址作为参考图。"
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
    """供应商返回的地址**如果就在我们自己的对象存储公网基址下**，才算长期资产地址。"""
    text = str(url or "").strip()
    if not text:
        return ""
    from app.config import settings

    base = str(getattr(settings, "s3_public_base_url", "") or "").strip().rstrip("/")
    if base and text.startswith(f"{base}/"):
        return text
    return ""


def _failed_result(
    *,
    source_task_id: str,
    asset_type: str,
    asset_id: str,
    error_message: str,
    reference_url: str,
    result_kind: str = "",
    result_label: str = "",
    aspect_ratio: str = "",
    aspect_ratio_source: str = "",
) -> ImageTaskResultRead:
    """供应商失败 → **照样返回一条结果**（与既有结果卡片同形），不抛 5xx 断掉整条链路。"""
    http_status = _http_status_from_text(error_message)
    return ImageTaskResultRead(
        source_task_id=source_task_id,
        source_asset_id=asset_id,
        asset_type=asset_type,
        stage=STAGE_REFERENCE_REGENERATE,
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
        result_kind=result_kind,
        result_label=result_label,
        aspect_ratio=aspect_ratio,
        aspect_ratio_source=aspect_ratio_source,
        detail={
            "error_message": error_message,
            "http_status": http_status,
            "oss_url": "",
            "local_path": "",
            "images": [],
            "status": "failed",
            "provider": "apimart",
            "result_kind": result_kind,
            "result_label": result_label,
            "aspect_ratio": aspect_ratio,
            "aspect_ratio_source": aspect_ratio_source,
            "reference_image_url": reference_url,
            "how_to_fix": (
                "参考图已通过匿名预检，所以这次失败来自供应商侧：可按上面的原文排障，"
                "或稍后用 attempt+1 重试（同一 attempt 会被当成同一轮，不会重复付费）。"
            ),
        },
    )


def _dry_run_result(
    *,
    source_task_id: str,
    asset_type: str,
    asset_id: str,
    reference_url: str,
    result_kind: str = "",
    result_label: str = "",
    aspect_ratio: str = "",
    aspect_ratio_source: str = "",
) -> ImageTaskResultRead:
    """演练占位：结构完整、地址不可达、绝不触网（与默认主流程的占位口径一致）。"""
    return ImageTaskResultRead(
        source_task_id=source_task_id,
        source_asset_id=asset_id,
        asset_type=asset_type,
        stage=STAGE_REFERENCE_REGENERATE,
        service_task_id=dry_run.fake_task_id("image", asset_id),
        status="dry_run",
        outcome=OUTCOME_DRY_RUN,
        ok=True,
        dry_run=True,
        image_url=dry_run.fake_image_url(asset_id),
        oss_url="",
        oss_ready=False,
        message="[DRY_RUN] 未提交 APIMart 参考图重生成；这是占位结果，不是真实图片地址。",
        result_kind=result_kind,
        result_label=result_label,
        aspect_ratio=aspect_ratio,
        aspect_ratio_source=aspect_ratio_source,
        detail={
            "error_message": "",
            "http_status": None,
            "reference_image_url": reference_url,
            "result_kind": result_kind,
            "result_label": result_label,
            "aspect_ratio": aspect_ratio,
            "aspect_ratio_source": aspect_ratio_source,
            "note": "[DRY_RUN] 占位结果，未向供应商发出任何请求。",
        },
    )


def _to_read(
    *,
    body: ReferenceRegenerateRequest,
    asset_type: str,
    asset_name: str,
    prompt: str,
    prompt_source: str,
    reference: ResolvedReference,
    source_task_id: str,
    attempt: int,
    result: ImageTaskResultRead,
    provider: str = "",
    model_id: str = "",
    model_name: str = "",
    base_url: str = "",
    api_key_configured: bool = False,
    deduplicated: bool = False,
    paid_call_made: bool = False,
    warnings: list[str] | None = None,
    result_kind: str = "",
    result_label: str = "",
    aspect_ratio: str = "",
    aspect_ratio_source: str = "",
    prompt_template: str = "",
) -> ReferenceRegenerateRead:
    results = [result]
    summary = summarize_results(results)
    return ReferenceRegenerateRead(
        project_id=body.project_id,
        asset_type=asset_type,
        asset_id=body.asset_id,
        asset_name=asset_name,
        prompt=prompt,
        prompt_source=prompt_source,
        reference_image_id=reference.image_id,
        reference_url=reference.url,
        reference_label=reference.label,
        reference_source=reference.source,
        attempt=attempt,
        deduplicated=deduplicated,
        source_task_id=source_task_id,
        provider=provider,
        model_id=model_id,
        model_name=model_name,
        base_url=base_url,
        api_key_configured=api_key_configured,
        result_kind=result_kind,
        result_label=result_label,
        aspect_ratio=aspect_ratio,
        aspect_ratio_source=aspect_ratio_source,
        prompt_template=prompt_template,
        results=results,
        summary=summary,
        outcome=str(summary.get("outcome") or summary_outcome(results)),
        warnings=list(warnings or []),
        guard_status=dry_run.short_status(),
        paid_call_made=paid_call_made,
    )


async def regenerate_with_existing_reference(
    db: AsyncSession,
    *,
    body: ReferenceRegenerateRequest,
    transport: Any = None,
    preflight: Any = None,
    adapter: Any = None,
) -> ReferenceRegenerateRead:
    """用该资产**已有的参考图**重新生成一张图（可选返工流程）。

    ``transport`` / ``adapter`` 仅供测试注入（``httpx.MockTransport`` / 假适配器），生产留空即
    走真实的 APIMart 通道；``preflight`` 由路由层传入（``preflight_guard``）。

    顺序是刻意排的：解析参考图 → 出网前判死形态问题 → DRY_RUN 占位 → 守卫 →
    **匿名预检（不可达就 409：不提交、不写库、不出网）** → 幂等登记 → 调供应商。
    """
    asset_type = str(body.asset_type or "").strip().lower()
    if asset_type not in REGENERATE_ASSET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"asset_type 只支持 {list(REGENERATE_ASSET_TYPES)}；"
                f"收到「{body.asset_type or '空'}」。"
            ),
        )
    # 按 asset_type 分流：模板 / 画幅 / 结果类型标签（唯一一份实现在 asset_strategies）
    strategy = strategies.strategy_for(asset_type)

    rows = await _load_asset_rows(db, project_id=body.project_id, asset_type=asset_type)
    row = next((item for item in rows if str(item.id) == str(body.asset_id)), None)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"项目 {body.project_id} 里没有 {ASSET_TYPE_ZH.get(asset_type, asset_type)}"
                f"「{body.asset_id}」：这个端点只对**已有参考图**的资产做返工，请确认资产类型与项目。"
            ),
        )
    asset_name = str(getattr(row, "name", "") or "")

    requested_prompt = str(body.prompt or "").strip()
    saved_prompt = saved_image_prompt(row, strategy.prompt_slot)
    if requested_prompt:
        prompt, prompt_source = requested_prompt, PROMPT_SOURCE_REQUEST
    elif saved_prompt:
        prompt, prompt_source = saved_prompt, PROMPT_SOURCE_SAVED
    else:
        prompt, prompt_source = "", ""
    if not prompt:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{ASSET_TYPE_ZH.get(asset_type, asset_type)}「{asset_name or body.asset_id}」没有可用的提示词："
                "请求里没传 prompt，该资产也没有保存过的图片提示词。"
                "请先在工作室第 3 步确认保存提示词，或直接在请求里传 prompt。"
            ),
        )

    warnings: list[str] = []
    if prompt_source == PROMPT_SOURCE_SAVED:
        warnings.append(f"提示词来源：该资产已保存的图片提示词（{len(saved_prompt)} 字）。")

    reference = await resolve_existing_reference(
        db, body=body, asset_type=asset_type, asset_id=body.asset_id, asset_name=asset_name
    )
    warnings.extend(reference.warnings)
    if not body.reference_image_id and not str(body.reference_url or "").strip():
        warnings.append(f"未指定参考图，已自动使用「{reference.label}」作为参考图。")

    # 画幅按类型解析：**人物参考图固定 16:9**（写死在分流表里，不是项目最终视频画幅）；
    # 场景/道具/服装按各自既有口径。显式传了非 16:9 的人物请求 → 忽略 + 如实回报。
    ratio_resolution = strategies.resolve_aspect_ratio(asset_type, body.target_ratio)
    ratio = ratio_resolution.ratio
    if ratio_resolution.warning:
        warnings.append(ratio_resolution.warning)
    if ratio not in SUPPORTED_RATIOS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"APIMart 图片只支持这些比例 {list(SUPPORTED_RATIOS)}，收到「{ratio}」"
                f"（不给则默认 {DEFAULT_ASPECT_RATIO}）。"
            ),
        )

    attempt = max(0, int(body.attempt or 0))
    source_task_id = build_source_task_id(
        project_id=body.project_id,
        asset_type=asset_type,
        asset_id=body.asset_id,
        prompt=prompt,
        attempt=attempt,
    )

    # 演练模式：占位结果，一个字节都不出网（也不占用幂等登记）。
    if dry_run.dry_run_enabled():
        return _to_read(
            body=body,
            asset_type=asset_type,
            asset_name=asset_name,
            prompt=prompt,
            prompt_source=prompt_source,
            reference=reference,
            source_task_id=source_task_id,
            attempt=attempt,
            result=_dry_run_result(
                source_task_id=source_task_id,
                asset_type=asset_type,
                asset_id=body.asset_id,
                reference_url=reference.url,
                result_kind=strategy.result_kind,
                result_label=strategy.result_label,
                aspect_ratio=ratio,
                aspect_ratio_source=ratio_resolution.source,
            ),
            warnings=warnings,
            result_kind=strategy.result_kind,
            result_label=strategy.result_label,
            aspect_ratio=ratio,
            aspect_ratio_source=ratio_resolution.source,
            prompt_template=strategy.prompt_template,
        )

    # 真实提交：这里会产生费用 → 守卫（与既有出口同一个）。
    paid_outlet_guard.require_outlet(
        f"参考图重生成 asset={asset_type}:{body.asset_id}",
        outlet=paid_outlet_guard.OUTLET_IMAGE,
    )
    dry_run.assert_outbound_allowed(
        f"参考图重生成 asset={asset_type}:{body.asset_id}",
        outlet=dry_run.OUTLET_IMAGE,
    )

    # 提交前匿名预检：不可达 → 409（结构化、带真实状态码与修法），**不提交、不写库、不出网**。
    if preflight is not None:
        await preflight(
            reference_candidates(reference),
            hint=f"参考图重生成 asset={asset_type}:{body.asset_id}",
        )

    state, cached = _reserve_round(source_task_id)
    if state == "inflight":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "reference_regenerate_in_flight",
                "message": (
                    f"这一轮（source_task_id={source_task_id}）**正在执行中**，本次没有重复提交，"
                    "也没有产生任何费用。"
                ),
                "source_task_id": source_task_id,
                "asset_type": asset_type,
                "asset_id": body.asset_id,
                "attempt": attempt,
                "how_to_fix": "等这一轮结束后再看结果；确实要再生成一次，把 attempt 加 1 再提交。",
                "paid_call_made": False,
            },
        )
    if state == "completed" and cached is not None:
        return _to_read(
            body=body,
            asset_type=asset_type,
            asset_name=asset_name,
            prompt=prompt,
            prompt_source=prompt_source,
            reference=reference,
            source_task_id=source_task_id,
            attempt=attempt,
            result=cached,
            deduplicated=True,
            paid_call_made=False,
            result_kind=strategy.result_kind,
            result_label=strategy.result_label,
            aspect_ratio=ratio,
            aspect_ratio_source=ratio_resolution.source,
            prompt_template=strategy.prompt_template,
            warnings=[
                *warnings,
                (
                    f"同一轮（source_task_id={source_task_id}）刚刚已经提交过：这次直接返回上一轮的结果，"
                    "没有再调用供应商、也没有再次计费。要再生成一次，请把 attempt 加 1。"
                ),
            ],
        )

    try:
        model = await resolve_image_model(db, body.model_id)
        provider_info = await resolve_provider_config_by_model(db, model=model)
        provider_key = str(getattr(provider_info, "provider_key", "") or "")
        model_name = str(getattr(model, "name", "") or "")
        model_id = str(getattr(model, "id", "") or "")
        base_url = str(getattr(provider_info, "base_url", "") or "")
        api_key = str(getattr(provider_info, "api_key", "") or "")
        if provider_key != "apimart":
            _forget_round(source_task_id)
            raise HTTPException(
                status_code=409,
                detail={
                    "code": ERROR_PROVIDER_NOT_APIMART,
                    "message": (
                        f"「使用已有参考图重新生成」走的是 Jellyfish 自己的 APIMart 图片通道"
                        f"（参考图字段 image_urls）；当前图片模型「{model_name or model_id}」的供应商是"
                        f"「{provider_key or '未知'}」，无法用它把参考图真的传进请求。"
                    ),
                    "provider": provider_key,
                    "model_id": model_id,
                    "asset_type": asset_type,
                    "asset_id": body.asset_id,
                    "how_to_fix": (
                        "把图片模型切到 APIMart（或显式传 model_id 指定一个 APIMart 图片模型）后重试；"
                        "只想按提示词生成参考图请用默认主流程 POST /studio/image-pipeline/submit。"
                    ),
                    "paid_call_made": False,
                },
            )

        inp = ImageGenerationInput(
            prompt=prompt,
            images=[InputImageRef(image_url=reference.url)],
            model=model_name or None,
            target_ratio=ratio,  # type: ignore[arg-type] - 已按 SUPPORTED_RATIOS 校验
            resolution_profile=str(body.resolution_profile or "standard"),  # type: ignore[arg-type]
            purpose="asset_image",
            n=1,
        )
        runner = adapter or ApimartImageApiAdapter(transport=transport)
        generated = await runner.generate(
            cfg=ProviderConfig(provider="apimart", api_key=api_key, base_url=base_url or None),
            inp=inp,
            timeout_s=float(body.timeout_seconds),
        )
    except ApimartImageError as exc:
        result = _failed_result(
            source_task_id=source_task_id,
            asset_type=asset_type,
            asset_id=body.asset_id,
            error_message=f"APIMart 参考图重生成失败：{exc}",
            reference_url=reference.url,
            result_kind=strategy.result_kind,
            result_label=strategy.result_label,
            aspect_ratio=ratio,
            aspect_ratio_source=ratio_resolution.source,
        )
        _remember_round(source_task_id, result)
        return _to_read(
            body=body,
            asset_type=asset_type,
            asset_name=asset_name,
            prompt=prompt,
            prompt_source=prompt_source,
            reference=reference,
            source_task_id=source_task_id,
            attempt=attempt,
            result=result,
            paid_call_made=True,
            warnings=warnings,
            result_kind=strategy.result_kind,
            result_label=strategy.result_label,
            aspect_ratio=ratio,
            aspect_ratio_source=ratio_resolution.source,
            prompt_template=strategy.prompt_template,
        )
    except BaseException:
        # 任何其它异常都不能把这一轮永久占在「正在执行中」里（否则用户只能靠 attempt+1 绕）。
        _forget_round(source_task_id)
        raise

    result = _result_from_generation(
        source_task_id=source_task_id,
        asset_type=asset_type,
        asset_id=body.asset_id,
        generated=generated,
        reference_url=reference.url,
        result_kind=strategy.result_kind,
        result_label=strategy.result_label,
        aspect_ratio=ratio,
        aspect_ratio_source=ratio_resolution.source,
    )
    _remember_round(source_task_id, result)
    return _to_read(
        body=body,
        asset_type=asset_type,
        asset_name=asset_name,
        prompt=prompt,
        prompt_source=prompt_source,
        reference=reference,
        source_task_id=source_task_id,
        attempt=attempt,
        result=result,
        provider=str(getattr(generated, "provider", "apimart") or "apimart"),
        model_id=model_id,
        model_name=model_name,
        base_url=base_url,
        api_key_configured=bool(api_key),
        paid_call_made=True,
        warnings=warnings,
        result_kind=strategy.result_kind,
        result_label=strategy.result_label,
        aspect_ratio=ratio,
        aspect_ratio_source=ratio_resolution.source,
        prompt_template=strategy.prompt_template,
    )


__all__ = [
    "DEDUPE_TTL_SECONDS",
    "ERROR_PROVIDER_NOT_APIMART",
    "ERROR_REFERENCE_UNAVAILABLE",
    "REFERENCE_SOURCE_ASSET_FALLBACK",
    "REFERENCE_SOURCE_ASSET_PRIMARY",
    "REFERENCE_SOURCE_EXPLICIT_URL",
    "REFERENCE_SOURCE_SLOT",
    "REGENERATE_ASSET_TYPES",
    "STAGE_REFERENCE_REGENERATE",
    "ResolvedReference",
    "clear_regenerate_registry",
    "reference_candidates",
    "regenerate_with_existing_reference",
    "resolve_existing_reference",
]
