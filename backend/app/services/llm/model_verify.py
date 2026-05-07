"""已保存模型的同步配置验证（文本极小调用；图/视频走轻量 HTTP 列表探测）。

用于模型管理页的「测试」入口：不写入任务中心、不触发真实成片/成图。
"""

from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import HTTPException
from langchain_core.messages import HumanMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import Model, ModelCategoryKey, Provider
from app.schemas.llm import ModelVerifyRead
from app.services.llm.manage import get_model
from app.services.llm.provider_resolver import (
    ResolvedProviderConfig,
    resolve_provider_config_from_provider,
)
from app.services.llm.resolver import build_chat_model_for_model

# 单次验证上限（秒）；与 ModelSettings.api_timeout 解耦，避免配置过大拖死请求线程
_VERIFY_TIMEOUT_S = 25.0


def _elapsed_ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _collect_model_ids(obj: object, out: list[str]) -> None:
    """从任意 JSON 结构中收集疑似模型 id 的字符串（兼容 OpenAI / 方舟等嵌套结构）。"""
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key == "id" and isinstance(val, str) and val.strip():
                out.append(val.strip())
            else:
                _collect_model_ids(val, out)
        return
    if isinstance(obj, list):
        for item in obj:
            _collect_model_ids(item, out)


def _model_list_contains(ids: list[str], model_name: str) -> bool:
    name = (model_name or "").strip()
    if not name:
        return False
    if name in ids:
        return True
    return any(name in x for x in ids if x)


def _classify_llm_error(exc: BaseException) -> str:
    """将文本调用异常归并为少量用户可读大类。"""
    text = str(exc).lower()
    if "401" in text or "unauthorized" in text or "invalid api key" in text:
        return "鉴权失败：请检查供应商 API Key 是否有效"
    if "403" in text or "permission" in text:
        return "权限不足：请检查账户或模型访问权限"
    if "404" in text or "not found" in text:
        return "模型或资源不存在：请检查模型名称是否与上游一致"
    if "timeout" in text or "timed out" in text:
        return "请求超时：请检查网络或上游服务状态"
    if "connection" in text or "connect" in text:
        return "网络不可用：无法连接上游服务"
    return f"调用失败：{exc!s}"[:400]


async def _probe_text(model: Model, provider: Provider, cfg: ResolvedProviderConfig) -> ModelVerifyRead:
    """文本：极小对话请求，确认密钥与模型名可用。"""
    t0 = time.perf_counter()
    try:
        llm = build_chat_model_for_model(provider=provider, model=model, thinking=False)
        bounded = llm.bind(max_tokens=8)
        msg = await bounded.ainvoke([HumanMessage(content="ping")])
        raw = getattr(msg, "content", "") or ""
        if isinstance(raw, list):
            preview = str(raw)[:120]
        else:
            preview = str(raw)[:120]
        return ModelVerifyRead(
            ok=True,
            category=model.category,
            message="验证通过",
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "model_name": model.name,
                "reply_preview": preview,
            },
        )
    except Exception as exc:  # noqa: BLE001 — 探测路径需兜底归类
        return ModelVerifyRead(
            ok=False,
            category=model.category,
            message=_classify_llm_error(exc),
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "model_name": model.name,
                "error": str(exc)[:500],
            },
        )


async def _probe_models_list_http(  # pylint: disable=too-many-return-statements
    *,
    cfg: ResolvedProviderConfig,
    model_name: str,
    category: ModelCategoryKey,
) -> ModelVerifyRead:
    """图像/视频：GET {base}/models，校验 Bearer 与模型名是否出现在列表中（不发起生成）。"""
    t0 = time.perf_counter()
    base = (cfg.base_url or "").strip().rstrip("/")
    if not base:
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="Base URL 未配置，无法探测上游",
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key, "model_name": model_name},
        )
    url = f"{base}/models"
    try:
        async with httpx.AsyncClient(timeout=_VERIFY_TIMEOUT_S) as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {cfg.api_key}"},
            )
    except httpx.TimeoutException:
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="探测超时：请检查网络或 Base URL",
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key, "endpoint": url},
        )
    except httpx.RequestError as exc:
        return ModelVerifyRead(
            ok=False,
            category=category,
            message=f"网络错误：{exc!s}"[:400],
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key, "endpoint": url},
        )

    if response.status_code in (401, 403):
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="鉴权失败：请检查 API Key 与 Base URL",
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "http_status": response.status_code,
                "endpoint": url,
            },
        )
    if response.status_code == 404:
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="上游未提供模型列表接口（404）：请检查 Base URL 是否指向 API 根路径（含 /v1 或 /api/v3 等）",
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "http_status": 404,
                "endpoint": url,
            },
        )
    if response.status_code >= 400:
        snippet = (response.text or "")[:300]
        return ModelVerifyRead(
            ok=False,
            category=category,
            message=f"上游返回错误 HTTP {response.status_code}",
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "http_status": response.status_code,
                "body_preview": snippet,
            },
        )

    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="上游返回非 JSON，无法解析模型列表",
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key, "http_status": response.status_code},
        )

    ids: list[str] = []
    _collect_model_ids(payload, ids)
    if not ids:
        return ModelVerifyRead(
            ok=False,
            category=category,
            message="未能从上游响应中解析出模型 ID 列表，请检查供应商类型与 Base URL",
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key, "http_status": response.status_code},
        )
    if not _model_list_contains(ids, model_name):
        return ModelVerifyRead(
            ok=False,
            category=category,
            message=f"模型列表未找到「{model_name}」：请确认模型名称与上游控制台一致",
            elapsed_ms=_elapsed_ms(t0),
            detail={
                "provider_key": cfg.provider_key,
                "model_name": model_name,
                "listed_count": len(ids),
            },
        )

    return ModelVerifyRead(
        ok=True,
        category=category,
        message="验证通过（已鉴权且模型名出现在上游列表中）",
        elapsed_ms=_elapsed_ms(t0),
        detail={
            "provider_key": cfg.provider_key,
            "model_name": model_name,
            "http_status": response.status_code,
            "endpoint": url,
        },
    )


async def verify_model_config(db: AsyncSession, *, model_id: str) -> ModelVerifyRead:
    """对单条已保存模型执行配置验证；``model_id`` 不存在时抛出 ``HTTPException(404)``。"""
    t0 = time.perf_counter()
    model = await get_model(db, model_id=model_id)
    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        return ModelVerifyRead(
            ok=False,
            category=model.category,
            message="供应商不存在或已删除，请先修复模型关联",
            elapsed_ms=_elapsed_ms(t0),
            detail={"model_id": model.id, "provider_id": model.provider_id},
        )

    try:
        cfg = resolve_provider_config_from_provider(provider=provider, category=model.category)
    except HTTPException as exc:
        detail = exc.detail
        msg = detail if isinstance(detail, str) else str(detail)
        return ModelVerifyRead(
            ok=False,
            category=model.category,
            message=f"配置未通过检查：{msg}"[:500],
            elapsed_ms=_elapsed_ms(t0),
            detail={"reason": "provider_resolution", "http_status": exc.status_code},
        )

    try:
        if model.category == ModelCategoryKey.text:
            result = await asyncio.wait_for(
                _probe_text(model, provider, cfg),
                timeout=_VERIFY_TIMEOUT_S,
            )
        else:
            result = await asyncio.wait_for(
                _probe_models_list_http(cfg=cfg, model_name=model.name, category=model.category),
                timeout=_VERIFY_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        return ModelVerifyRead(
            ok=False,
            category=model.category,
            message="验证超时，请检查网络或稍后再试",
            elapsed_ms=_elapsed_ms(t0),
            detail={"provider_key": cfg.provider_key},
        )

    # 总耗时覆盖子步骤（更接近用户感知）
    return result.model_copy(update={"elapsed_ms": _elapsed_ms(t0)})
