"""编排层的公共支撑：结构化错误 + 运行元信息。

放在这里而不是每个服务各写一遍，是为了保证三个服务的失败响应形状一致，
前端只需要处理一套错误结构。
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException, status

from app.schemas.studio.llm_orchestration import LlmRunMeta, LlmTargetRead
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import LLMRequestError, TextLLMTarget
from app.services.studio.llm_orchestration.json_utils import JSONParseError

RAW_PREVIEW_CHARS = 800


def target_read(target: TextLLMTarget | None) -> LlmTargetRead | None:
    """把内部 target 转成对外可返回的结构（不带 api_key）。"""
    if target is None:
        return None
    public = target.public()
    return LlmTargetRead(**public)


def build_run_meta(
    *,
    target: TextLLMTarget | None,
    llm_called: bool,
    latency_ms: int | None = None,
    raw_output_chars: int = 0,
    json_repairs: list[str] | None = None,
    json_parse_error: str | None = None,
    dry_run_reason: str | None = None,
) -> LlmRunMeta:
    """组装统一的运行元信息。"""
    enabled = dry_run.dry_run_enabled()
    return LlmRunMeta(
        dry_run=enabled,
        llm_called=llm_called,
        target=target_read(target),
        latency_ms=latency_ms,
        raw_output_chars=raw_output_chars,
        json_repairs=list(json_repairs or []),
        json_parse_error=json_parse_error,
        dry_run_reason=dry_run_reason,
    )


def shortcut_context(*, skill: str) -> str:
    """DRY_RUN 下的说明文案，统一口径。"""
    return (
        f"[DRY_RUN] {skill} 未调用任何大模型，返回的是**确定性占位预览**"
        f"（只做结构与规则层拼装，不含模型创作内容）。"
        f"要真实调用请显式设置 {dry_run.DRY_RUN_ENV}=0 且 {dry_run.CONFIRM_ENV}=1。"
    )


def dry_run_warning(*, skill: str) -> str:
    return shortcut_context(skill=skill)


def parse_failure_detail(exc: JSONParseError, *, raw_text: str = "") -> dict[str, Any]:
    """JSON 解析失败的结构化明细。"""
    text = raw_text or exc.raw_text or ""
    return {
        "code": "llm_json_parse_failed",
        "message": str(exc),
        "raw_output_preview": text[:RAW_PREVIEW_CHARS],
        "raw_output_chars": len(text),
        "hint": "可重试；若反复失败，请缩短输入或换用更稳定的文本模型。",
    }


def raise_parse_failure(exc: JSONParseError, *, raw_text: str = "") -> None:
    """把 JSON 解析失败转成 422 + 结构化错误明细。"""
    # 用字面量 422：starlette 在新旧版本里对该常量的命名不一致（ENTITY / CONTENT）。
    raise HTTPException(
        status_code=422,
        detail=parse_failure_detail(exc, raw_text=raw_text),
    )


def raise_llm_failure(exc: LLMRequestError) -> None:
    """把 LLM 请求失败转成 502 + 结构化错误明细。"""
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "code": "llm_request_failed",
            "message": str(exc),
            "provider_status_code": exc.status_code,
            "hint": "检查 Provider 的 base_url / api_key / 状态，以及模型名称是否正确。",
        },
    )


def raise_guard_blocked(exc: Exception) -> None:
    """守卫拦截转成 409（正常情况下服务层会提前返回占位结果，走到这里说明配置不一致）。"""
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "llm_call_blocked",
            "message": str(exc),
            "hint": f"DRY_RUN 未关闭或未确认；需要 {dry_run.DRY_RUN_ENV}=0 且 {dry_run.CONFIRM_ENV}=1。",
            "guard": dry_run.state(),
        },
    )


class Stopwatch:
    """极简计时器，用于记录真实调用耗时。"""

    def __init__(self) -> None:
        self._started = time.monotonic()

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self._started) * 1000)
