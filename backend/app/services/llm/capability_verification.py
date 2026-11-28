"""Verify a model using the stored route and retain the exact configuration tested."""

from contextlib import aclosing, nullcontext
from dataclasses import dataclass
import asyncio
from datetime import UTC
import hashlib
import json
import re
import secrets
from subprocess import SubprocessError
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.model_capabilities import (
    ModelCapabilityVerificationRead,
    VerificationReason,
    VerifiedModelCapability,
)
from app.core.contracts.model_provider import ModelProviderConfig
from app.core.integrations.model_provider_registry import bind_text_provider
from app.models.llm import Model, ModelCapabilityVerification, ModelCategoryKey, Provider
from app.services.llm.capability_verification_media import make_media_probe
from app.services.llm.provider_resolver import resolve_effective_base_url, resolve_provider_config_from_provider


@dataclass(frozen=True)
class VerificationRoute:
    """Resolve runtime details and a redacted identifier for user-visible history."""

    provider: Provider
    base_url: str
    params: dict
    endpoint: str
    endpoint_label: str
    configuration_hash: str


def _verification_route(model: Model, provider: Provider) -> VerificationRoute:
    params = model.params or {}
    base_url = resolve_effective_base_url(provider=provider, category=model.category) or ""
    try:
        url = urlsplit(base_url) if isinstance(base_url, str) else urlsplit("")
    except ValueError:
        url = urlsplit("")
    operation = "responses" if params.get("use_responses_api") else "chat/completions"
    path = f"{url.path.rstrip('/')}/{operation}"
    valid = url.scheme in ("https", "http") and url.netloc
    endpoint = urlunsplit((url.scheme, url.netloc, path, url.query, "")) if valid else ""
    # Effective endpoints may include query credentials or userinfo.
    label = urlunsplit((url.scheme, url.netloc.rsplit("@", maxsplit=1)[-1], path, "", "")) if endpoint else ""
    key = json.dumps(
        [provider.id, provider.provider_key, provider.api_key, model.name, model.category, base_url, params],
        sort_keys=True,
        ensure_ascii=False,
    )
    return VerificationRoute(provider, base_url, params, endpoint, label, hashlib.sha256(key.encode()).hexdigest())


async def _request(
    client: httpx.AsyncClient, route: VerificationRoute, payload: dict,
) -> dict:
    model_name = payload["model"]
    messages = payload["messages"]
    adapter = bind_text_provider(
        ModelProviderConfig(route.provider.provider_key, route.provider.api_key, route.base_url), model_name,
        {**route.params, "max_retries": 0}, client_factory=lambda: nullcontext(client),
    )
    options = {key: value for key, value in payload.items() if key not in ("model", "messages")}
    if route.provider.provider_key != "aliyun_bailian" or "omni" not in model_name.lower():
        result = await adapter.invoke(messages, options=options)
        choice = result.choices[0]
        return {"content": choice.text, "tool_calls": choice.tool_calls}
    options["modalities"] = ["text"]
    if model_name == "qwen3.8-omni-flash":
        options["reasoning_effort"] = "none"
    content, calls = [], {}
    async with aclosing(adapter.stream(messages, options=options)) as events:
        async for event in events:
            if event.kind == "error":
                raise ValueError("Provider stream error")
            content.append(event.text)
            for fragment in event.tool_calls:
                call = calls.setdefault(fragment["index"], {
                    "id": "", "type": "function", "function": {"name": "", "arguments": ""},
                })
                if fragment.get("id"):
                    call["id"] = fragment["id"]
                function = fragment.get("function") or {}
                for key in ("name", "arguments"):
                    call["function"][key] += function.get(key) or ""
    return {"content": "".join(content), "tool_calls": list(calls.values())}


async def _verify_tool(client: httpx.AsyncClient, route: VerificationRoute, model_name: str) -> VerificationReason:
    messages = [{"role": "user", "content": "Call verify_capability once. Reply with exactly the value it returns."}]
    tools = [{"type": "function", "function": {
        "name": "verify_capability", "description": "Return a disposable verification token",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }}]
    payload = {"model": model_name, "messages": messages, "tools": tools}
    response = await _request(client, route, payload)
    calls = response.get("tool_calls")
    if not isinstance(calls, list) or len(calls) != 1:
        return "tool_not_called"
    call = calls[0]
    if not isinstance(call, dict) or not (call_id := call.get("id")) or not isinstance(call_id, str):
        return "tool_not_called"
    function = call.get("function")
    if (
        call.get("type") != "function" or not isinstance(function, dict)
        or function.get("name") != "verify_capability"
        or json.loads(function.get("arguments", "")) != {}
    ):
        return "tool_not_called"
    token = secrets.token_hex(6)
    messages.extend([
        {"role": "assistant", "content": None, "tool_calls": [call]},
        {"role": "tool", "tool_call_id": call_id, "content": token},
    ])
    continued = await _request(client, route, payload)
    content = continued.get("content")
    if not continued.get("tool_calls") and isinstance(content, str) and content.strip() == token:
        return "verified"
    return "tool_result_not_used"


async def _verify_media(
    client: httpx.AsyncClient, route: VerificationRoute, model_name: str, capability: VerifiedModelCapability,
) -> VerificationReason:
    try:
        content, expected = await asyncio.to_thread(make_media_probe, capability, route.provider.provider_key)
    except (OSError, SubprocessError):
        return "probe_unavailable"

    payload = {"model": model_name, "messages": [{"role": "user", "content": content}]}
    answer = (await _request(client, route, payload)).get("content")
    if isinstance(answer, str) and " ".join(re.findall(r"[A-Z0-9]+", answer.upper())) == expected:
        return "verified"
    return "expected_observation_missing"


def _read(row: ModelCapabilityVerification, route: VerificationRoute) -> ModelCapabilityVerificationRead:
    tested_at = row.created_at
    if tested_at.tzinfo is None:
        tested_at = tested_at.replace(tzinfo=UTC)
    return ModelCapabilityVerificationRead(
        id=row.id, provider_id=row.provider_id, provider_name=row.provider_name, model_name=row.model_name,
        endpoint=row.endpoint, capability=row.capability, outcome=row.outcome, reason=row.reason,
        tested_at=tested_at, current=row.configuration_hash == route.configuration_hash,
    )


async def list_verifications(db: AsyncSession, model: Model) -> list[ModelCapabilityVerificationRead]:
    """Read verification history without contacting the provider."""
    provider = await db.get_one(Provider, model.provider_id)
    route = _verification_route(model, provider)
    rows = await db.scalars(
        select(ModelCapabilityVerification).where(ModelCapabilityVerification.model_id == model.id)
        .order_by(ModelCapabilityVerification.created_at.desc(), ModelCapabilityVerification.id.desc()).limit(50)
    )
    return [_read(row, route) for row in rows]


async def verify_capability(
    db: AsyncSession, model: Model, capability: VerifiedModelCapability,
) -> ModelCapabilityVerificationRead:
    """Record an explicit check without changing the model's capability declarations."""
    provider = await db.get_one(Provider, model.provider_id)
    route = _verification_route(model, provider)
    reason: VerificationReason = "provider_unavailable"
    if model.category == ModelCategoryKey.text and route.endpoint:
        try:
            config = resolve_provider_config_from_provider(provider=provider, category=model.category)
            async with asyncio.timeout(45), httpx.AsyncClient(
                timeout=20, headers={"Authorization": f"Bearer {config.api_key}"},
            ) as client:
                if capability == "tool_calling":
                    reason = await _verify_tool(client, route, model.name)
                else:
                    reason = await _verify_media(client, route, model.name, capability)
        except HTTPException:
            reason = "provider_unavailable"
        except (httpx.HTTPError, httpx.InvalidURL, KeyError, IndexError, ValueError, TypeError, TimeoutError):
            reason = "request_failed"
    row = ModelCapabilityVerification(
        id=uuid4().hex, model_id=model.id, model_name=model.name, capability=capability,
        provider_id=provider.id, provider_name=provider.name, endpoint=route.endpoint_label,
        configuration_hash=route.configuration_hash, reason=reason,
        outcome="passed" if reason == "verified" else "failed",
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _read(row, route)
