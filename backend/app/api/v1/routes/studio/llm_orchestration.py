"""LLM 编排层路由：三个预览入口 + 一个守卫状态查询。

挂载：``/api/v1/studio/llm``（见 ``app/api/v1/routes/studio/__init__.py``）。

设计约定：
- 全部为**同步请求-响应**，不排后台队列、不建异步任务；
- 只返回预览，不写库、不建资产（服务层保证）；
- 失败沿用项目统一的 ``ApiResponse`` 信封，并把结构化错误明细放进 ``meta.error``，
  避免全局异常处理器把 dict detail 压成一行字符串。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.llm_orchestration import (
    AssetBindingPreviewRead,
    AssetBindingPreviewRequest,
    EntityExtractionPreviewRead,
    EntityExtractionPreviewRequest,
    ImagePromptPreviewRead,
    ImagePromptPreviewRequest,
    VideoPromptPreviewRead,
    VideoPromptPreviewRequest,
)
from app.services import paid_outlet_guard
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.asset_binding import (
    CONFIRM_ENDPOINTS,
    preview_asset_binding,
)
from app.services.studio.llm_orchestration.entity_extraction import preview_entity_extraction
from app.services.studio.llm_orchestration.image_prompt import preview_image_prompts
from app.services.studio.llm_orchestration.registry import (
    CAMERA_MOVEMENT_KEYS,
    ENTITY_TYPE_WHITELIST,
    camera_movement_options,
    image_prompt_slot_specs,
)
from app.services.studio.llm_orchestration.video_prompt import preview_video_prompt

router = APIRouter()

_STRUCTURED_ERROR_CODE = "llm_orchestration_error"

# 守卫拦截单独走 409：服务层在 DRY_RUN 下返回占位结果，这里是兜底（防新路径忘守卫）。
_BLOCKED_EXCEPTIONS = (dry_run.DryRunBlocked, dry_run.RealCallNotConfirmed)


def _error_envelope(*, code: int, detail: Any) -> JSONResponse:
    """把服务层的结构化错误塞进统一 ApiResponse 信封的 meta.error 里。"""
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("code") or "error")
        error = detail
    else:
        message = str(detail)
        error = {"code": _STRUCTURED_ERROR_CODE, "message": message}
    body = ApiResponse[None](code=code, message=message, data=None, meta={"error": error}).model_dump()
    return JSONResponse(status_code=code, content=body)


# ---------- 守卫状态 ----------


@router.get(
    "/orchestration/status",
    response_model=ApiResponse[dict[str, Any]],
    summary="LLM 编排层状态（DRY_RUN 守卫 + 词表）",
)
async def get_orchestration_status() -> ApiResponse[dict[str, Any]]:
    """查询守卫状态与确定性词表，便于确认「当前不会真实付费」。

    演练/真实模式的字段（前端角标按这些字段渲染，全部中文可照做）：
    - ``mode`` / ``mode_label`` / ``mode_description``：当前模式与一句话说明；
    - ``outlet_states``：llm / image / video / oss 四个出口各自是否放行、被拦原因；
    - ``switch_source`` / ``switch_source_label`` / ``guard.source``：两个开关**写在哪**
      （``env`` 进程环境变量 / ``dotenv`` backend/.env / ``default`` 都没写）；
      ``dotenv_real_mode`` 为 ``true`` 表示真实模式是由 ``.env`` 打开的（此时后端启动会告警）；
    - ``enable_steps`` / ``how_to_enable``：怎么切到真实模式；``restore_steps``：怎么关回演练。
    既有字段（``guard`` / ``guard_status_text`` / ``paid_outlet_guards`` / ``dry_run_audit``）
    保持向后兼容，只做加法。
    """
    details = dry_run.mode_details()
    return success_response(
        {
            "guard": dry_run.state(),
            "guard_status_text": dry_run.short_status(),
            # --- 模式标识：前端角标 + 被拦截时的「怎么开」都读这里 ---
            "mode": details["mode"],
            "mode_label": details["mode_label"],
            "mode_description": details["mode_description"],
            "is_real_mode": details["is_real_mode"],
            # --- 开关来源：开关写在哪里（进程环境变量 / backend/.env / 默认值） ---
            "switch_source": details["source"],
            "switch_source_label": details["source_label"],
            "dotenv_real_mode": details["dotenv_real_mode"],
            "startup_warning": details["startup_warning"],
            "restart_required_on_change": details["restart_required_on_change"],
            "outlet_states": details["outlets"],
            "enable_steps": details["enable_steps"],
            "how_to_enable": details["how_to_enable"],
            "restore_steps": details["restore_steps"],
            "how_to_restore": details["how_to_restore"],
            "mode_doc": details["doc"],
            "real_run_mode": details,
            "entity_type_whitelist": list(ENTITY_TYPE_WHITELIST),
            # 九槽位图片提示词的确定性定义（只读、不花钱）。
            # 生产页面用它渲染「手工填写提示词」表单：DRY_RUN 下无法真实调用大模型，
            # 用户仍然要有一条能把**自己的**提示词写进 image_prompts 的路。
            "image_prompt_slots": image_prompt_slot_specs(),
            "camera_movement_keys": list(CAMERA_MOVEMENT_KEYS),
            "camera_movements": camera_movement_options(),
            "binding_confirm_endpoints": CONFIRM_ENDPOINTS,
            # 付费出口纳管现状：新链路 + legacy 路径共用同一套闸门（见 paid_outlet_guard）。
            "paid_outlet_guards": {
                "task_kinds": dict(paid_outlet_guard.PAID_TASK_KIND_OUTLETS),
                "legacy_llm_router": "/api/v1/script-processing/*（router 级守卫）",
                "legacy_video_route": "/api/v1/film/tasks/video",
                "legacy_image_task_entry": "studio create_image_task_and_link（出图建任务唯一入口）",
                "worker_llm_builder": "app.services.llm.runtime.build_default_text_llm_sync",
                "task_executor_backstop": "app.tasks.execute_task.run_task_celery",
            },
            "dry_run_audit": dry_run.audit_log()[-20:],
        }
    )


# ---------- 4.1 实体提取 ----------


@router.post(
    "/entity-extraction/preview",
    response_model=ApiResponse[EntityExtractionPreviewRead],
    summary="实体提取预览（只返回草稿，不建实体）",
)
async def preview_entity_extraction_route(
    body: EntityExtractionPreviewRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """从章节/剧本文本提取实体清单草稿，经确定性后校验后返回预览。"""
    try:
        data = await preview_entity_extraction(db, body=body)
    except _BLOCKED_EXCEPTIONS as exc:
        return paid_outlet_guard.blocked_envelope(exc)
    except HTTPException as exc:
        return _error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


# ---------- 4.2 图片提示词生成 ----------


@router.post(
    "/image-prompt/preview",
    response_model=ApiResponse[ImagePromptPreviewRead],
    summary="图片提示词逐槽位生成预览（不落库、不出图）",
)
async def preview_image_prompts_route(
    body: ImagePromptPreviewRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """按 Jellyfish 提示词类别逐槽位生成图片提示词（分层结构 + 画像卡一致性）。"""
    try:
        data = await preview_image_prompts(db, body=body)
    except _BLOCKED_EXCEPTIONS as exc:
        return paid_outlet_guard.blocked_envelope(exc)
    except HTTPException as exc:
        return _error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


# ---------- 4.3 视频提示词生成 ----------


@router.post(
    "/video-prompt/preview",
    response_model=ApiResponse[VideoPromptPreviewRead],
    summary="视频提示词生成预览（不提交视频任务）",
)
async def preview_video_prompt_route(
    body: VideoPromptPreviewRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """生成视频提示词（标准运镜词库 + 首尾帧模式支持），结构对齐镜头上下文包。"""
    try:
        data = await preview_video_prompt(db, body=body)
    except _BLOCKED_EXCEPTIONS as exc:
        return paid_outlet_guard.blocked_envelope(exc)
    except HTTPException as exc:
        return _error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


# ---------- P2 资产绑定 ----------


@router.post(
    "/asset-binding/preview",
    response_model=ApiResponse[AssetBindingPreviewRead],
    summary="资产绑定预览（LLM 实体链接 + 置信度分层，只建议不写库）",
)
async def preview_asset_binding_route(
    body: AssetBindingPreviewRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """为项目/指定镜头生成资产绑定建议。

    覆盖角色/场景/道具/服装四类槽位，按置信度分层，并与启发式及已有绑定对账。
    **本接口不写库**；人工确认后请调用 ``suggestions[].confirm_endpoint`` 指向的现有端点。
    """
    try:
        data = await preview_asset_binding(db, body=body)
    except _BLOCKED_EXCEPTIONS as exc:
        return paid_outlet_guard.blocked_envelope(exc)
    except HTTPException as exc:
        return _error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)
