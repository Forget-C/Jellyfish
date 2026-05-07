"""阿里云百炼 DashScope 原生文生图 HTTP。

与 OpenAI ``/images/generations`` 不同，北京地域常用：
- **同步**：``POST /api/v1/services/aigc/multimodal-generation/generation``（如 wan2.6 / qwen-image 系列）。
- **异步**：``POST /api/v1/services/aigc/text2image/image-synthesis`` + ``GET /api/v1/tasks/{task_id}``
  （如 wanx-v1；须携带 ``X-DashScope-Async: enable``）。

文档：
https://help.aliyun.com/zh/model-studio/developer-reference/text-to-image-api-reference
https://www.alibabacloud.com/help/zh/model-studio/text-to-image-v2-api-reference
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from app.core.contracts.image_generation import (
    ImageGenerationInput,
    ImageGenerationResult,
    ImageItem,
)
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.http_logging import log_image_http_request, log_image_http_response


def dashscope_http_origin(base_url: str | None) -> str:
    """将兼容模式 ``.../compatible-mode/v1`` 等配置还原为 DashScope API 根 URL。

    原生文生图路径挂在 ``/api/v1/services/...`` 下，不能与 OpenAI compatible-mode 混用。
    """
    default = "https://dashscope.aliyuncs.com"
    raw = (base_url or "").strip().rstrip("/")
    if not raw:
        return default
    if "compatible-mode" in raw:
        prefix = raw.split("/compatible-mode", 1)[0].rstrip("/")
        return prefix or default
    if "/api/v1" in raw:
        prefix = raw.split("/api/v1", 1)[0].rstrip("/")
        return prefix or default
    return raw


def _use_wanx_async_api(model: str | None) -> bool:
    """万相 V1（wanx-*）HTTP 仅支持异步创建 + 任务查询。"""
    m = (model or "").strip().lower()
    if not m:
        return False
    return m.startswith("wanx")


def _clamp_prompt(text: str, max_chars: int) -> str:
    t = (text or "").strip()
    return t if len(t) <= max_chars else t[:max_chars]


def _split_dashscope_prompt_and_negative(raw: str) -> tuple[str, str]:
    """从整段提示词中拆分「正面描述」与「负面提示」，供 DashScope ``negative_prompt`` 使用。

    识别规则：任意一行包含「负面提示」或以 ``negative prompt`` 开头（不区分大小写），
    则从该行之前为正面、之后为负面；若该行冒号后仍有正文，也并入负面。
    未识别到标记时，全文作为正面，负面为空（由模型默认处理）。
    """
    text = (raw or "").replace("\r\n", "\n").strip()
    if not text:
        return "", ""
    lines = text.split("\n")
    split_idx: int | None = None
    for i, line in enumerate(lines):
        s = line.strip()
        if "负面提示" in s:
            split_idx = i
            break
        low = s.lower()
        if low.startswith("negative prompt") or low.startswith("negative:"):
            split_idx = i
            break
    if split_idx is None:
        return text, ""

    positive_lines = lines[:split_idx]
    header = lines[split_idx].strip()
    tail_lines = lines[split_idx + 1 :]

    extra_from_header = ""
    for sep in ("：", ":"):
        if sep in header:
            _, rest = header.split(sep, 1)
            extra_from_header = rest.strip()
            break

    neg_parts: list[str] = []
    if extra_from_header:
        neg_parts.append(extra_from_header)
    neg_parts.extend(tail_lines)
    negative = "\n".join(neg_parts).strip()
    positive = "\n".join(positive_lines).strip()
    return positive, negative


def _dashscope_http_error_detail(response: httpx.Response) -> str | None:
    """解析 DashScope HTTP 错误体（常见为顶层 ``code`` / ``message``）。"""
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    msg = data.get("message")
    code = data.get("code")
    if msg is not None or code is not None:
        parts = [str(x) for x in (code, msg) if x is not None and str(x).strip()]
        if parts:
            return ": ".join(parts) if len(parts) > 1 else parts[0]
    err = data.get("error")
    if isinstance(err, dict):
        em = err.get("message")
        ec = err.get("code")
        parts = [str(x) for x in (ec, em) if x is not None and str(x).strip()]
        if parts:
            return ": ".join(parts) if len(parts) > 1 else parts[0]
    return None


def _dashscope_multimodal_size(inp: ImageGenerationInput) -> str:
    """映射为 ``宽*高``（wan2.6 / qwen-image 文档格式）。"""
    if inp.size:
        return str(inp.size).replace("x", "*").replace("X", "*")
    ratio = inp.target_ratio or "1:1"
    # 与万相 2.x 文档常见比例推荐对齐（像素在文档约束内可调）
    ratio_map: dict[str, str] = {
        "1:1": "1280*1280",
        "3:4": "1104*1472",
        "4:3": "1472*1104",
        "9:16": "960*1696",
        "16:9": "1696*960",
        "21:9": "1696*720",
        "3:2": "1472*992",
        "2:3": "992*1472",
    }
    return ratio_map.get(ratio, "1280*1280")


def _safe_json_for_log(obj: Any, limit: int = 1200) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return "<non-serializable>"
    return s if len(s) <= limit else s[:limit] + "...(truncated)"


def _build_multimodal_user_content(inp: ImageGenerationInput, *, positive_prompt: str) -> list[dict[str, str]]:
    """构造 DashScope multimodal user content。

    - 首项固定为 text；
    - 参考图按顺序拼到 content（仅接受 image_url）。
    """
    content: list[dict[str, str]] = [{"text": _clamp_prompt(positive_prompt, 2100)}]
    # qwen-image-2.0-2in1 等模型限制 0~3 张参考图；统一在适配层做上限保护。
    for ref in (inp.images or [])[:3]:
        img_url = (ref.image_url or "").strip()
        if not img_url:
            continue
        content.append({"image": img_url})
    return content


class DashScopeImageApiAdapter:
    """DashScope 文生图：自动选择 multimodal 同步或 wanx 异步轮询。"""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        origin = dashscope_http_origin(cfg.base_url)
        model = (inp.model or "").strip()
        if not model:
            raise RuntimeError("DashScope image generation requires model name (configure image model in LLM settings)")

        headers_base: dict[str, str] = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }

        # wanx 异步轮询可能显著长于单次 HTTP；客户端总超时放宽。
        client_timeout = max(float(timeout_s), 180.0)
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            if _use_wanx_async_api(inp.model):
                return await self._generate_wanx_async(
                    client,
                    origin=origin,
                    headers=headers_base,
                    inp=inp,
                    poll_timeout_s=float(timeout_s),
                )
            return await self._generate_multimodal_sync(client, origin=origin, headers=headers_base, inp=inp)

    async def _generate_multimodal_sync(
        self,
        client: Any,
        *,
        origin: str,
        headers: dict[str, str],
        inp: ImageGenerationInput,
    ) -> ImageGenerationResult:
        """wan2.6 / qwen-image 等多模态文生图（单次 HTTP 返回 URL）。"""
        url = f"{origin.rstrip('/')}/api/v1/services/aigc/multimodal-generation/generation"
        pos, neg = _split_dashscope_prompt_and_negative(inp.prompt)
        if not pos and not neg:
            pos = (inp.prompt or "").strip()
        elif not pos and neg:
            # 仅识别到负面段时给最小正向提示，避免把负面全文当作 messages.text
            pos = "人像摄影，高画质，细节丰富，符合画面描述"
        body: dict[str, Any] = {
            "model": (inp.model or "").strip(),
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": _build_multimodal_user_content(inp, positive_prompt=pos),
                    }
                ]
            },
            "parameters": {
                "prompt_extend": True,
                "watermark": bool(inp.watermark) if inp.watermark is not None else False,
                "n": max(1, min(int(inp.n), 4)),
                "negative_prompt": _clamp_prompt(neg, 1500),
                "size": _dashscope_multimodal_size(inp),
            },
        }
        if inp.seed is not None:
            body["parameters"]["seed"] = int(inp.seed)

        log_image_http_request(
            provider="aliyun_bailian",
            method="POST",
            url=url,
            headers=headers,
            body_log=_safe_json_for_log(body),
        )
        t0 = time.perf_counter()
        r = await client.post(url, headers=headers, json=body)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        resp_text = r.text or ""
        log_image_http_response(
            provider="aliyun_bailian",
            status_code=r.status_code,
            elapsed_ms=dt_ms,
            resp_headers=dict(r.headers),
            resp_text=resp_text[:4000],
        )
        if r.status_code >= 400:
            detail = _dashscope_http_error_detail(r)
            if detail:
                raise RuntimeError(detail)
        r.raise_for_status()
        data = r.json()
        if data.get("code"):
            raise RuntimeError(f"DashScope multimodal error: {data.get('code')} — {data.get('message')}")
        return _parse_multimodal_sync_response(data)

    async def _generate_wanx_async(
        self,
        client: Any,
        *,
        origin: str,
        headers: dict[str, str],
        inp: ImageGenerationInput,
        poll_timeout_s: float,
    ) -> ImageGenerationResult:
        """wanx-v1：异步创建 + 轮询 ``/api/v1/tasks/{task_id}``。"""
        create_url = f"{origin.rstrip('/')}/api/v1/services/aigc/text2image/image-synthesis"
        hdr = {
            **headers,
            "X-DashScope-Async": "enable",
        }
        pos, neg = _split_dashscope_prompt_and_negative(inp.prompt)
        if not pos and not neg:
            pos = (inp.prompt or "").strip()
        elif not pos and neg:
            pos = "人像摄影，高画质，细节丰富"
        wanx_params: dict[str, Any] = {
            "style": "<auto>",
            "size": _dashscope_multimodal_size(inp),
            "n": max(1, min(int(inp.n), 4)),
        }
        if neg:
            wanx_params["negative_prompt"] = _clamp_prompt(neg, 800)
        body: dict[str, Any] = {
            "model": (inp.model or "").strip(),
            "input": {"prompt": _clamp_prompt(pos, 800)},
            "parameters": wanx_params,
        }
        if inp.images:
            first = inp.images[0]
            ref = (first.image_url or "").strip()
            if ref:
                body["input"]["ref_image"] = ref
                body["parameters"]["ref_strength"] = 1.0
                body["parameters"]["ref_mode"] = "repaint"

        log_image_http_request(
            provider="aliyun_bailian",
            method="POST",
            url=create_url,
            headers=hdr,
            body_log=_safe_json_for_log(body),
        )
        t0 = time.perf_counter()
        r = await client.post(create_url, headers=hdr, json=body)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        resp_text = r.text or ""
        log_image_http_response(
            provider="aliyun_bailian",
            status_code=r.status_code,
            elapsed_ms=dt_ms,
            resp_headers=dict(r.headers),
            resp_text=resp_text[:4000],
        )
        if r.status_code >= 400:
            detail = _dashscope_http_error_detail(r)
            if detail:
                raise RuntimeError(detail)
        r.raise_for_status()
        data = r.json()
        if data.get("code"):
            raise RuntimeError(f"DashScope wanx create error: {data.get('code')} — {data.get('message')}")
        task_id = str((data.get("output") or {}).get("task_id") or "").strip()
        if not task_id:
            raise RuntimeError(f"DashScope wanx missing task_id: {data!r}")

        poll_headers = {"Authorization": headers["Authorization"]}
        poll_deadline = time.monotonic() + max(60.0, poll_timeout_s)
        query_url = f"{origin.rstrip('/')}/api/v1/tasks/{task_id}"
        while time.monotonic() < poll_deadline:
            await asyncio.sleep(2.0)
            pr = await client.get(query_url, headers=poll_headers)
            pt = pr.text or ""
            log_image_http_response(
                provider="aliyun_bailian",
                status_code=pr.status_code,
                elapsed_ms=0,
                resp_headers=dict(pr.headers),
                resp_text=pt[:4000],
            )
            pr.raise_for_status()
            pdata = pr.json()
            if pdata.get("code") and (pdata.get("output") or {}).get("task_status") != "SUCCEEDED":
                raise RuntimeError(f"DashScope task query error: {pdata.get('code')} — {pdata.get('message')}")
            out = pdata.get("output") or {}
            st = str(out.get("task_status") or "")
            if st == "SUCCEEDED":
                return _parse_wanx_poll_response(pdata, provider_task_id=task_id)
            if st in {"FAILED", "CANCELED", "UNKNOWN"}:
                raise RuntimeError(f"DashScope wanx task {st}: {pdata!r}")

        raise TimeoutError(f"DashScope wanx task polling timed out: task_id={task_id}")


def _parse_multimodal_sync_response(data: dict[str, Any]) -> ImageGenerationResult:
    """解析 multimodal-generation 同步响应 ``output.choices[].message.content[]``。"""
    images: list[ImageItem] = []
    output = data.get("output") or {}
    for ch in output.get("choices") or []:
        if not isinstance(ch, dict):
            continue
        msg = ch.get("message") or {}
        for block in msg.get("content") or []:
            if not isinstance(block, dict):
                continue
            # 文档示例多为 type=image；qwen-image 线上实际可能仅返回 {"image": "https://..."}
            img_url = block.get("image")
            if img_url and (block.get("type") in (None, "image")):
                images.append(ImageItem(url=str(img_url), b64_json=None))
    if not images:
        raise RuntimeError(f"DashScope multimodal response has no image URL: {data!r}")
    return ImageGenerationResult(
        images=images,
        provider="aliyun_bailian",
        provider_task_id=None,
        status="succeeded",
    )


def _parse_wanx_poll_response(data: dict[str, Any], *, provider_task_id: str) -> ImageGenerationResult:
    out = data.get("output") or {}
    raw_results = out.get("results") or []
    images: list[ImageItem] = []
    for item in raw_results:
        if isinstance(item, dict) and item.get("url"):
            images.append(ImageItem(url=str(item["url"]), b64_json=None))
    if not images:
        raise RuntimeError(f"DashScope wanx poll response has no image URL: {data!r}")
    return ImageGenerationResult(
        images=images,
        provider="aliyun_bailian",
        provider_task_id=provider_task_id,
        status=str(out.get("task_status") or "succeeded"),
    )
