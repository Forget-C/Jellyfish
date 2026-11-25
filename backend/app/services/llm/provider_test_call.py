"""供应商管理页的一次性提交，只读取首次响应。"""

from base64 import b64decode
from binascii import Error as Base64Error
from contextlib import nullcontext
from io import BytesIO
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from PIL import Image

from app.core.contracts.model_provider import ModelProviderConfig
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.provider_media import ProviderImageInput, ProviderVideoInput
from app.core.integrations.openai.chat import OpenAICompatibleChat
from app.core.integrations.media_provider import MediaProvider
from app.models.llm import Provider
from app.schemas.llm import ProviderTestCall, ProviderTestResult
from app.services.llm.provider_resolver import ResolvedProviderConfig, resolve_provider_config_from_provider


PROMPTS = {"text": "回复 OK", "image": "一个蓝色圆点", "video": "一个蓝色圆点在移动"}
TEST_CATEGORIES = {
    "openai": ("text", "image", "video"), "aliyun_bailian": ("text",),
    "volcengine": ("image", "video"), "vidu": ("image", "video"), "kling": ("image", "video"),
}


def _upstream_error(status, data):
    if status >= 500:
        return "remote_error"
    if 300 <= status < 400:
        return "unverified"
    error = data.get("error")
    code = str((error.get("code") or error.get("type")) if isinstance(error, dict) else data.get("code")).lower()
    if status == 401 or code in {"401", "invalid_api_key", "authentication_error", "invalidauthentication"}:
        return "unauthorized"
    if status == 403 or code in {"403", "permission_denied", "permission_error", "accessdenied"}:
        return "forbidden"
    if status in (402, 429) or code in {"429", "insufficient_quota", "rate_limit_exceeded"}:
        return "limited"
    return "rejected" if status >= 400 or error or code not in {"none", "0", "200"} else None


def _nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def _has_image(item):
    for field in ("url", "image_url"):
        value = item.get(field)
        if _nonempty(value):
            try:
                url = urlsplit(value)
                if url.scheme in {"https", "http"} and url.hostname:
                    return True
            except ValueError:
                pass
    value = item.get("b64_json")
    if _nonempty(value):
        try:
            with Image.open(BytesIO(b64decode(value, validate=True))) as image:
                image.verify()
            return True
        except (ValueError, OSError, SyntaxError, Base64Error, Image.DecompressionBombError):
            pass
    return False


def _output_outcome(key, category, data):
    if category == "video" or key in {"vidu", "kling"}:
        containers = [data]
        if key == "kling":
            containers.extend([data.get("data"), data.get("task")])
        tasks = [item for item in containers if isinstance(item, dict)]
        failure_states = {"failed", "fail", "failure", "error", "cancelled", "canceled", "expired"}
        if any(str(task.get(field, "")).strip().lower() in failure_states
               for task in tasks for field in ("status", "state", "task_status")):
            return "rejected"
        fields = ("task_id",) if key == "vidu" else ("id", "task_id", "taskId")
        if any(_nonempty(task.get(field)) for task in tasks for field in fields):
            return "accepted"
    else:
        items = data.get("choices" if category == "text" else "data")
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            if category == "image" and _has_image(item):
                return "success"
            message = item.get("message")
            if category == "text" and isinstance(message, dict) and _nonempty(message.get("content")):
                return "success"
    return "unverified"


def resolve_test_config(provider: Provider, call: ProviderTestCall) -> ResolvedProviderConfig:
    """读取付费提交使用的配置快照，允许在出站前释放数据库连接。"""
    if call.category not in TEST_CATEGORIES.get(provider.provider_key, {}):
        raise HTTPException(400, "当前供应商不支持该类型的测试调用")
    return resolve_provider_config_from_provider(provider=provider, category=call.category)


async def submit_test_call(cfg: ResolvedProviderConfig, call: ProviderTestCall) -> ProviderTestResult:
    """发送一个固定文本，不重定向、不重试、不轮询或回显供应商内容。"""
    try:
        prompt = PROMPTS[call.category]
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            if call.category == "text":
                adapter = OpenAICompatibleChat(ModelProviderConfig(cfg.provider_key, cfg.api_key, cfg.base_url),
                                                call.model, {}, lambda: nullcontext(client))
                response = await adapter.submit_once([{"role": "user", "content": prompt}])
            else:
                media = MediaProvider(ProviderConfig(cfg.provider_key, cfg.api_key, cfg.base_url), client=client)
                inp = (ProviderImageInput(model=call.model, prompt=prompt) if call.category == "image" else
                       ProviderVideoInput(model=call.model, prompt=prompt, ratio="16:9"))
                response = await media.submit_once(inp, connection_test=True)
    except (httpx.RequestError, httpx.InvalidURL):
        return ProviderTestResult(outcome="unknown")
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    try:
        data = response.json()
    except ValueError:
        data = {}
    data = data if isinstance(data, dict) else {}
    outcome = _upstream_error(response.status_code, data) or _output_outcome(cfg.provider_key, call.category, data)
    return ProviderTestResult(outcome=outcome, http_status=response.status_code)
