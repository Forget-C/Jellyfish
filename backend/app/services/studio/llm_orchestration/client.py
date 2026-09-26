"""文本 LLM 调用客户端：从 DB 配置解析目标 → httpx POST /chat/completions。

硬性约束（来自任务书第 3 节）：
- 走 ModelSettings.default_text_model_id → Model → Provider 拿 base_url + api_key；
- OpenAI 兼容格式，``Authorization: Bearer {api_key}``；
- 零新依赖，只用主依赖已有的 httpx（不引入 openai SDK / langchain-openai）；
- api_key 只从 Provider 表读，绝不硬编码，绝不出现在日志或返回值里；
- 真实 HTTP 之前必须过 DRY_RUN 守卫，DRY_RUN 开启时一行请求都不发。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider
from app.services.llm.provider_resolver import resolve_effective_base_url
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.prompt_templates import JSON_ONLY_SYSTEM_PROMPT

DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 4096

# 服务层注入用的最小接口：给一段 prompt，返回模型原始文本。
TextLLMCaller = Callable[[str], Awaitable[str]]


class LLMRequestError(RuntimeError):
    """LLM 请求失败（网络/状态码/响应结构异常）。"""

    def __init__(self, detail: str, *, status_code: int | None = None) -> None:
        self.status_code = status_code
        super().__init__(detail)


@dataclass(frozen=True, slots=True)
class TextLLMTarget:
    """一次文本调用的完整目标配置。

    ``api_key`` 故意设置 ``repr=False``：dataclass 的默认 repr 会打印所有字段，
    而本对象会被打进日志，所以必须显式排除。
    """

    provider_id: str
    provider_name: str
    model_id: str
    model_name: str
    base_url: str
    timeout_seconds: int
    temperature: float = DEFAULT_TEMPERATURE
    max_tokens: int = DEFAULT_MAX_TOKENS
    api_key: str = field(default="", repr=False)

    def public(self) -> dict[str, Any]:
        """可安全放进 API 响应/日志的字段（**不含 api_key**）。"""
        return {
            "provider_id": self.provider_id,
            "provider_name": self.provider_name,
            "model_id": self.model_id,
            "model_name": self.model_name,
            "base_url": self.base_url,
            "timeout_seconds": self.timeout_seconds,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "api_key_configured": bool(self.api_key),
        }


@dataclass(slots=True)
class LLMCompletion:
    """一次模型调用的结果（原始文本 + 可观测元信息）。"""

    text: str
    target: TextLLMTarget
    latency_ms: int
    finish_reason: str = ""
    usage: dict[str, Any] = field(default_factory=dict)


def chat_completions_url(base_url: str) -> str:
    """把 Provider 的 base_url 拼成 chat/completions 地址。"""
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        raise LLMRequestError("Provider base_url 为空，无法发起 LLM 请求。")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _effective_base_url(provider: Provider) -> str:
    """优先用 provider registry 的解析结果，失败时回退到 Provider.base_url。"""
    try:
        resolved = resolve_effective_base_url(provider=provider, category=ModelCategoryKey.text)
    except Exception:  # noqa: BLE001 - registry 缺失/自定义供应商都不该阻断调用
        resolved = None
    return str(resolved or provider.base_url or "").strip()


def _params_number(params: dict[str, Any], key: str, default: float) -> float:
    value = (params or {}).get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


async def resolve_text_llm_target(db: AsyncSession) -> TextLLMTarget:
    """按 ModelSettings.default_text_model_id 解析文本模型调用目标。"""
    settings_row = await db.get(ModelSettings, 1)
    model_id = settings_row.default_text_model_id if settings_row is not None else None
    if not model_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No default model configured for category=text",
        )

    model = await db.get(Model, model_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Configured default model not found: {model_id}",
        )

    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider not found for model_id={model.id}",
        )

    api_key = (provider.api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider api_key is empty for provider_id={provider.id}",
        )

    params = dict(model.params or {})
    timeout_seconds = int(settings_row.api_timeout) if settings_row and settings_row.api_timeout else 60

    return TextLLMTarget(
        provider_id=provider.id,
        provider_name=provider.name,
        model_id=model.id,
        model_name=model.name,
        base_url=_effective_base_url(provider),
        timeout_seconds=timeout_seconds,
        temperature=_params_number(params, "temperature", DEFAULT_TEMPERATURE),
        max_tokens=int(_params_number(params, "max_tokens", DEFAULT_MAX_TOKENS)),
        api_key=api_key,
    )


def build_chat_payload(
    *,
    target: TextLLMTarget,
    prompt: str,
    system_prompt: str = JSON_ONLY_SYSTEM_PROMPT,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """组装 OpenAI 兼容的 chat/completions 请求体。"""
    return {
        "model": target.model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": target.temperature if temperature is None else temperature,
        "max_tokens": target.max_tokens if max_tokens is None else max_tokens,
        "response_format": {"type": "json_object"},
    }


def _extract_completion_text(data: Any) -> tuple[str, str]:
    """从响应体里取 (文本, finish_reason)。"""
    if not isinstance(data, dict):
        raise LLMRequestError("LLM 响应不是 JSON 对象。")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LLMRequestError("LLM 响应缺少 choices。")
    first = choices[0]
    if not isinstance(first, dict):
        raise LLMRequestError("LLM 响应的 choices[0] 结构异常。")

    message = first.get("message")
    content: Any = None
    if isinstance(message, dict):
        content = message.get("content")
    if content is None:
        content = first.get("text")

    if isinstance(content, list):
        # 少数供应商返回分段 content，拼接其中的 text 片段。
        pieces = [str(part.get("text", "")) for part in content if isinstance(part, dict)]
        content = "".join(pieces)

    text = str(content or "").strip()
    if not text:
        raise LLMRequestError("LLM 响应文本为空。")
    return text, str(first.get("finish_reason") or "")


def _safe_error_detail(exc: Exception, target: TextLLMTarget) -> str:
    """错误信息里只保留可公开字段，避免把 api_key 溅到日志里。"""
    return f"provider={target.provider_name} model={target.model_name} url={chat_completions_url(target.base_url)}：{exc}"


async def call_text_llm(
    prompt: str,
    *,
    target: TextLLMTarget,
    system_prompt: str = JSON_ONLY_SYSTEM_PROMPT,
    temperature: float | None = None,
    max_tokens: int | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> LLMCompletion:
    """真实发起一次文本 LLM 调用。

    DRY_RUN 开启时**不会**走到 httpx：守卫会先抛 ``DryRunBlocked``；
    真实模式但没确认时抛 ``RealCallNotConfirmed``。
    ``transport`` 仅用于测试注入（MockTransport），生产留空。
    """
    # 2026-09-21 修掉的一个真花钱缺口：这句以前包在 `if dry_run.dry_run_enabled():` 里，
    # 于是「关演练但没确认」（real_unconfirmed）这条路把**付费确认检查整段跳过**，
    # 请求会真的发出去 —— 与状态接口/文档承诺的「未确认仍然不发真实请求」相矛盾。
    # 现在是单一口径：演练 / 未确认 / 已确认真实 三种情况都由守卫自己判定。
    dry_run.assert_llm_outbound_allowed(f"call_text_llm(model={target.model_name})")

    payload = build_chat_payload(
        prompt=prompt,
        target=target,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    url = chat_completions_url(target.base_url)
    headers = {
        "Authorization": f"Bearer {target.api_key}",
        "Content-Type": "application/json",
    }

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=target.timeout_seconds, transport=transport) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise LLMRequestError(_safe_error_detail(exc, target)) from exc

    latency_ms = int((time.monotonic() - started) * 1000)

    if response.status_code >= 400:
        snippet = response.text[:300]
        raise LLMRequestError(
            _safe_error_detail(RuntimeError(f"HTTP {response.status_code} {snippet}"), target),
            status_code=response.status_code,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise LLMRequestError(_safe_error_detail(RuntimeError("响应不是合法 JSON"), target)) from exc

    text, finish_reason = _extract_completion_text(data)
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return LLMCompletion(
        text=text,
        target=target,
        latency_ms=latency_ms,
        finish_reason=finish_reason,
        usage=dict(usage),
    )
