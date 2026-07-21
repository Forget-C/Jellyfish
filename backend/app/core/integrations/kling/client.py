"""可灵 Open Platform 的共享 HTTP 客户端。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig

DEFAULT_KLING_BASE_URL = "https://api-beijing.klingai.com"


class KlingApiError(RuntimeError):
    """承载可灵错误码、请求标识与服务端消息的可追踪异常。"""

    def __init__(
        self,
        *,
        operation: str,
        status_code: int | None,
        code: str | int | None,
        message: str,
        request_id: str | None,
    ) -> None:
        """构造不会泄露 API Key 的供应商错误摘要。"""
        self.operation = operation
        self.status_code = status_code
        self.code = code
        self.request_id = request_id
        details = [f"Kling {operation} failed"]
        if status_code is not None:
            details.append(f"HTTP {status_code}")
        if code is not None:
            details.append(f"code={code}")
        if request_id:
            details.append(f"request_id={request_id}")
        details.append(message or "no error message")
        super().__init__("; ".join(details))


class KlingClient:
    """统一处理可灵 API Key 鉴权、HTTP 请求及错误响应解析。"""

    def __init__(self, *, cfg: ProviderConfig, timeout_s: float) -> None:
        """使用供应商配置初始化客户端；未配置域名时使用北京默认域名。"""
        api_key = (cfg.api_key or "").strip()
        if not api_key:
            raise ValueError("Kling API Key is required")
        self._base_url = (cfg.base_url or DEFAULT_KLING_BASE_URL).rstrip("/")
        self._timeout_s = timeout_s
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def get(self, *, path: str, params: dict[str, Any] | None, operation: str) -> dict[str, Any]:
        """发送 GET 请求并返回经过可灵业务错误校验的 JSON 对象。"""
        return await self._request(method="GET", path=path, params=params, body=None, operation=operation)

    async def post(self, *, path: str, body: dict[str, Any], operation: str) -> dict[str, Any]:
        """发送 JSON POST 请求并返回经过可灵业务错误校验的 JSON 对象。"""
        return await self._request(method="POST", path=path, params=None, body=body, operation=operation)

    async def _request(
        self,
        *,
        method: str,
        path: str,
        params: dict[str, Any] | None,
        body: dict[str, Any] | None,
        operation: str,
    ) -> dict[str, Any]:
        """执行单次请求，并将 HTTP 或业务层失败统一转换为 KlingApiError。"""
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("httpx is required for Kling generation tasks") from exc

        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers=self._headers,
                    params=params,
                    json=body,
                )
        except httpx.HTTPError as exc:
            raise KlingApiError(
                operation=operation,
                status_code=None,
                code=None,
                message=str(exc),
                request_id=None,
            ) from exc

        data = _read_json_object(response=response)
        request_id = _request_id(response=response, data=data)
        code = data.get("code")
        message = str(data.get("message") or data.get("msg") or "")
        if response.is_error:
            raise KlingApiError(
                operation=operation,
                status_code=response.status_code,
                code=code,
                message=message or _response_text(response),
                request_id=request_id,
            )
        if code not in (None, 0, "0", 200, "200"):
            raise KlingApiError(
                operation=operation,
                status_code=response.status_code,
                code=code,
                message=message or "Kling returned a non-success business code",
                request_id=request_id,
            )
        return data


def _read_json_object(*, response: Any) -> dict[str, Any]:
    """读取 JSON 对象；非 JSON 响应保留为空对象供上层生成安全错误。"""
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _request_id(*, response: Any, data: dict[str, Any]) -> str | None:
    """从常见响应头或响应体字段提取可灵请求标识。"""
    value = data.get("request_id") or data.get("requestId")
    if value:
        return str(value)
    headers = getattr(response, "headers", {})
    return headers.get("x-request-id") or headers.get("request-id")


def _response_text(response: Any) -> str:
    """截断非 JSON 错误正文，避免将过长上游响应写入任务错误。"""
    try:
        text = (response.text or "").strip()
    except Exception:  # noqa: BLE001
        return "no response body"
    return text[:1000] if text else "no response body"
