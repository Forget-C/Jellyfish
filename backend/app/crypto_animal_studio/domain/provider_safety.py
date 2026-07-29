"""供应商中立性与 URL 安全检查（domain 层，纯函数）。

规范（ADR-016 §8）：
- **允许**：公开的市场数据溯源 URL（``market_data.source_url``）、仓库相对资产路径、
  不透明 asset ID。
- **禁止**：供应商 API 端点、签名 URL、临时/过期下载 URL、账户专属执行 URL、
  凭证/API key/authorization header/token、供应商原生生成请求负载。

``source_url`` 只是**溯源证据**，不是执行端点：本模块只做结构判断，
**绝不发起任何网络请求**。

错误只报告「字段路径 + 类别」，**不回显被判定为机密的内容**。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: 已知供应商 API 主机片段（出现即视为执行端点）。
PROVIDER_API_HOST_MARKERS: tuple[str, ...] = (
    "api.openai.com",
    "api.anthropic.com",
    "api.elevenlabs.io",
    "api.runwayml.com",
    "api.replicate.com",
    "api.stability.ai",
    "generativelanguage.googleapis.com",
    "ark.cn-beijing.volces.com",
    "dashscope.aliyuncs.com",
    "api.groq.com",
    "api.deepseek.com",
)

#: 生成类 API 路径片段。
PROVIDER_API_PATH_MARKERS: tuple[str, ...] = (
    "/v1/images/generations",
    "/v1/chat/completions",
    "/v1/audio/speech",
    "/v1/videos",
    "/v1/completions",
    "/v1/embeddings",
    "/api/v3/images/generations",
)

#: 签名/过期 URL 查询参数标记。
SIGNED_URL_MARKERS: tuple[str, ...] = (
    "x-amz-signature",
    "x-amz-credential",
    "awsaccesskeyid",
    "x-goog-signature",
    "signature=",
    "sig=",
    "expires=",
    "x-amz-expires",
    "se=",
    "st=",
    "token=",
    "access_token=",
)

#: 账户/租户专属执行路径标记。
ACCOUNT_SCOPED_MARKERS: tuple[str, ...] = ("/accounts/", "/workspaces/", "/organizations/", "/tenants/", "/projects/")

#: 明显的密钥/令牌形状。
#: 顺序有意义：``authorization`` 头必须先于裸 ``Bearer`` 令牌匹配，
#: 否则 "Authorization: Bearer …" 会被误判为 bearer_token。
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("authorization_header", re.compile(r"\bauthorization\s*:\s*\S+", re.IGNORECASE)),
    ("api_key", re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}")),
    ("api_key", re.compile(r"\bAKIA[0-9A-Z]{12,}")),
    ("api_key", re.compile(r"\bghp_[A-Za-z0-9]{20,}")),
    ("bearer_token", re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{10,}", re.IGNORECASE)),
)

#: 自由字典（如 ``shots[].metadata``）中禁止出现的键名。
FORBIDDEN_FREEFORM_KEYS: frozenset[str] = frozenset(
    {
        "api_key",
        "apikey",
        "api-key",
        "authorization",
        "auth_header",
        "bearer",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "client_secret",
        "provider_endpoint",
        "endpoint_url",
        "request_payload",
        "provider_request",
        "provider_payload",
    }
)

_CREDENTIALS_IN_URL = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE)
_HAS_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://")


@dataclass(frozen=True, slots=True)
class SafetyFinding:
    """一条供应商中立性问题：只含路径与类别，不含疑似机密内容。"""

    field_path: str
    category: str


#: URL 类别判定表：(类别, 标记集合)。顺序即优先级。
_URL_MARKER_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("provider_api_endpoint", PROVIDER_API_HOST_MARKERS + PROVIDER_API_PATH_MARKERS),
    ("signed_or_expiring_url", SIGNED_URL_MARKERS),
    ("account_scoped_url", ACCOUNT_SCOPED_MARKERS),
)


def classify_string(value: str) -> str | None:
    """判断单个字符串是否落入禁止类别；返回类别名或 ``None``。

    类别：``credentials_in_url``、``provider_api_endpoint``、``signed_or_expiring_url``、
    ``account_scoped_url``、``api_key``、``bearer_token``、``authorization_header``。

    允许（返回 ``None``）：无 scheme 的仓库相对路径与不透明 asset ID、
    以及不含上述标记的公开溯源 URL。
    """
    if not isinstance(value, str) or not value.strip():
        return None

    stripped = value.strip()

    secret_category = next((category for category, pattern in _SECRET_PATTERNS if pattern.search(value)), None)
    if secret_category is not None:
        return secret_category

    if _CREDENTIALS_IN_URL.match(stripped):
        return "credentials_in_url"

    if not _HAS_SCHEME.match(stripped):
        return None  # 仓库相对路径 / 不透明 asset ID：允许

    lowered = value.lower()
    return next(
        (category for category, markers in _URL_MARKER_RULES if any(marker in lowered for marker in markers)),
        None,
    )


def scan(node: object, path: str = "") -> list[SafetyFinding]:
    """递归扫描已序列化的包，返回全部禁止项（路径 + 类别）。

    同时检查自由字典的键名（``shots[].metadata`` 是唯一的自由表面，
    因为其余模型均为 ``extra="forbid"``）。
    """
    findings: list[SafetyFinding] = []
    if isinstance(node, dict):
        for key, item in node.items():
            child = f"{path}.{key}" if path else str(key)
            if isinstance(key, str) and key.strip().lower() in FORBIDDEN_FREEFORM_KEYS:
                findings.append(SafetyFinding(field_path=child, category="provider_native_field"))
                continue
            findings.extend(scan(item, child))
    elif isinstance(node, (list, tuple)):
        for index, item in enumerate(node):
            findings.extend(scan(item, f"{path}[{index}]"))
    elif isinstance(node, str):
        category = classify_string(node)
        if category is not None:
            findings.append(SafetyFinding(field_path=path or "<root>", category=category))
    return findings


__all__ = [
    "SafetyFinding",
    "classify_string",
    "scan",
    "PROVIDER_API_HOST_MARKERS",
    "SIGNED_URL_MARKERS",
    "FORBIDDEN_FREEFORM_KEYS",
]
