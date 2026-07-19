"""HTTP 请求日志辅助：脱敏与可打印 body 摘要。"""

from __future__ import annotations

import json
import logging
from typing import Any

# 与 tasks 一致：保证在默认 uvicorn 日志级别下可见。
logger = logging.getLogger("uvicorn.error")


def redact_headers(h: dict[str, str]) -> dict[str, str]:
    redacted: dict[str, str] = {}
    for k, v in (h or {}).items():
        lk = k.lower()
        if lk in {"authorization", "x-api-key", "api-key"}:
            redacted[k] = "***redacted***"
        else:
            redacted[k] = v
    return redacted


def safe_body_for_log_openai(body: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = dict(body or {})
    if "prompt" in out and isinstance(out["prompt"], str):
        p = out["prompt"].strip()
        out["prompt"] = (p[:300] + "...(truncated)") if len(p) > 300 else p
    imgs = out.get("images")
    if isinstance(imgs, list):
        brief: list[dict[str, Any]] = []
        for it in imgs[:5]:
            if not isinstance(it, dict):
                continue
            image_url = it.get("image_url")
            file_id = it.get("file_id")
            brief.append(
                {
                    "has_image_url": bool(image_url),
                    "image_url_prefix": (str(image_url)[:80] + "...")
                    if isinstance(image_url, str) and len(image_url) > 80
                    else image_url,
                    "has_file_id": bool(file_id),
                }
            )
        out["images"] = {
            "count": len(imgs),
            "sample": brief,
        }
    return out


def safe_body_for_log_volcengine_image(body: dict[str, Any]) -> dict[str, Any]:
    """火山 ImageGenerations：日志中省略 image 数组正文，仅保留条数。"""
    return {
        **(
            {
                "prompt": (
                    (body.get("prompt", "")[:300] + "...(truncated)")
                    if isinstance(body.get("prompt"), str) and len(body.get("prompt", "")) > 300
                    else body.get("prompt")
                )
            }
        ),
        **{k: v for k, v in body.items() if k != "prompt" and k != "image"},
        "image": {"count": len(body.get("image") or [])}
        if isinstance(body.get("image"), list)
        else body.get("image"),
    }


def safe_body_for_log_vidu(body: dict[str, Any]) -> dict[str, Any]:
    """生成 Vidu 请求日志摘要，避免把参考图的 base64 内容写入日志。"""
    out = dict(body or {})
    prompt = out.get("prompt")
    if isinstance(prompt, str) and len(prompt) > 300:
        out["prompt"] = prompt[:300] + "...(truncated)"
    images = out.get("images")
    if isinstance(images, list):
        out["images"] = {"count": len(images)}
    return out


def log_image_http_request(*, provider: str, method: str, url: str, headers: dict[str, str], body_log: str) -> None:
    logger.warning(
        "image_generation_http_request provider=%s method=%s url=%s headers=%s body=%s",
        provider,
        method,
        url,
        redact_headers(headers),
        body_log,
    )


def log_image_http_response(
    *,
    provider: str,
    status_code: int,
    elapsed_ms: int,
    resp_headers: dict[str, str],
    resp_text: str,
) -> None:
    logger.warning(
        "image_generation_http_response provider=%s status=%s elapsed_ms=%s headers=%s body=%s",
        provider,
        status_code,
        elapsed_ms,
        resp_headers,
        (resp_text[:2000] + "...(truncated)") if len(resp_text) > 2000 else resp_text,
    )


def json_dumps_for_log(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)
