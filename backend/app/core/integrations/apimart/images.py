"""APIMart 图片生成：**异步任务**协议 + 参考图 ``image_urls``。

在此之前这个文件只是 OpenAI 适配器的一层空壳，也就是说：只要把图片供应商切到 APIMart，
Jellyfish 就会拿 OpenAI 的 ``/images/edits`` + ``images[]`` 去打它 —— APIMart 根本没有那个路由，
而它的参考图字段是 ``image_urls``。本实现的协议是照着**线上可用**的出图服务实现逐字段核对的
（``人物及场景生产项目/services/providers/apimartImageProvider.js``）：

提交：
    ``POST {base_url}/images/generations``
    body = ``{model, prompt, n, size: <比例如 16:9>, resolution: <1k|2k|4k>, image_urls?: [...]}``
    → ``data.task_id``（或 ``data.id``）

轮询：
    ``GET {base_url}/tasks/{task_id}?language=zh``
    status ∈ success/succeeded/completed/done → 取图；failed/fail/error/cancelled → 报错

与 OpenAI 的两点关键差别（都是踩过的坑）：
1. ``size`` 传的是**比例字符串**（``16:9``），不是 ``1024x1024``；
2. 参考图字段是 ``image_urls``，**没有** ``/images/edits``。
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any

import httpx

from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, ImageItem
from app.core.contracts.provider import ProviderConfig

SUBMIT_PATH = "/images/generations"
TASK_PATH = "/tasks/{task_id}"

# 出图服务实测支持的三个比例（apimartImageProvider.getCapabilities().supportedSizes）
SUPPORTED_RATIOS: tuple[str, ...] = ("1:1", "3:4", "16:9")
DEFAULT_RATIO = "1:1"
RESOLUTION_BY_PROFILE: dict[str, str] = {"standard": "2k", "high": "4k"}
DEFAULT_RESOLUTION = "2k"

SUCCESS_STATUSES = {"success", "succeeded", "completed", "complete", "done"}
FAILED_STATUSES = {"failed", "fail", "error", "cancelled", "canceled"}

POLL_INTERVAL_ENV = "JELLYFISH_APIMART_IMAGE_POLL_INTERVAL"
POLL_TIMEOUT_ENV = "JELLYFISH_APIMART_IMAGE_POLL_TIMEOUT"

_DEFAULT_POLL_INTERVAL_SECONDS = 5.0
_DEFAULT_POLL_TIMEOUT_SECONDS = 600.0

_IMAGE_URL_RE = re.compile(r"^https?://.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$", re.IGNORECASE)
_GRID_HINT_RE = re.compile(r"(grid|thumbnail|composite|collage|montage|contact.?sheet)", re.IGNORECASE)


class ApimartImageError(RuntimeError):
    """APIMart 图片请求/轮询失败（把供应商原文带出来，便于排障）。"""


def _float_env(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def poll_interval_seconds() -> float:
    return _float_env(POLL_INTERVAL_ENV, _DEFAULT_POLL_INTERVAL_SECONDS)


def poll_timeout_seconds() -> float:
    return _float_env(POLL_TIMEOUT_ENV, _DEFAULT_POLL_TIMEOUT_SECONDS)


def resolve_ratio(input_: ImageGenerationInput) -> str:
    """比例：显式 ``target_ratio`` 优先，其次认 ``size`` 里的比例写法，最后默认 1:1。"""
    ratio = str(input_.target_ratio or "").strip()
    if ratio:
        if ratio not in SUPPORTED_RATIOS:
            raise ValueError(
                f"APIMart 图片只支持这些比例 {list(SUPPORTED_RATIOS)}，收到「{ratio}」。"
                "请改项目/镜头的视频比例，或换用其它图片模型。"
            )
        return ratio
    size = str(input_.size or "").strip()
    if size in SUPPORTED_RATIOS:
        return size
    return DEFAULT_RATIO


def resolve_resolution(input_: ImageGenerationInput) -> str:
    profile = str(input_.resolution_profile or "").strip().lower()
    return RESOLUTION_BY_PROFILE.get(profile, DEFAULT_RESOLUTION)


def collect_image_urls(payload: Any) -> list[str]:
    """从供应商响应里收集图片地址（结构不固定 → 递归找 URL；grid/拼图排到最后）。"""
    found: list[str] = []

    def walk(node: Any, level: int) -> None:
        if node is None or level > 8:
            return
        if isinstance(node, str):
            text = node.strip()
            if _IMAGE_URL_RE.match(text) and text not in found:
                found.append(text)
            return
        if isinstance(node, list):
            for item in node:
                walk(item, level + 1)
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, str) and re.search(r"url|image|src", str(key), re.IGNORECASE):
                    text = value.strip()
                    if text.startswith("http") and text not in found:
                        found.append(text)
                        continue
                walk(value, level + 1)

    walk(payload, 0)
    singles = [url for url in found if not _GRID_HINT_RE.search(url)]
    grids = [url for url in found if _GRID_HINT_RE.search(url)]
    return [*singles, *grids]


def reference_urls(input_: ImageGenerationInput) -> list[str]:
    urls: list[str] = []
    for ref in input_.images or []:
        value = str(ref.image_url or "").strip()
        if value and value not in urls:
            urls.append(value)
    return urls


def build_submit_body(input_: ImageGenerationInput) -> dict[str, Any]:
    """组装 ``/images/generations`` 请求体（字段名与 APIMart 契约一致）。"""
    body: dict[str, Any] = {
        "prompt": input_.prompt,
        "n": max(1, min(int(input_.n or 1), 4)),
        "size": resolve_ratio(input_),
        "resolution": resolve_resolution(input_),
    }
    if input_.model:
        body["model"] = input_.model
    refs = reference_urls(input_)
    if refs:
        body["image_urls"] = refs
    return body


def _extract_task_id(payload: Any) -> str:
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, list):
        data = data[0] if data else None
    if isinstance(data, dict):
        for key in ("task_id", "taskId", "id"):
            value = str(data.get(key) or "").strip()
            if value:
                return value
    if isinstance(payload, dict):
        for key in ("task_id", "taskId", "id"):
            value = str(payload.get(key) or "").strip()
            if value:
                return value
    return ""


def _status_of(payload: dict[str, Any]) -> str:
    data = payload.get("data")
    candidates: list[Any] = [payload.get("status")]
    if isinstance(data, dict):
        candidates.append(data.get("status"))
        task = data.get("task")
        if isinstance(task, dict):
            candidates.append(task.get("status"))
    elif isinstance(data, list) and data and isinstance(data[0], dict):
        candidates.append(data[0].get("status"))
    for value in candidates:
        text = str(value or "").strip().lower()
        if text:
            return text
    return "processing"


def _json_or_raise(response: httpx.Response, what: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise ApimartImageError(f"{what}：返回的不是合法 JSON（HTTP {response.status_code}）。") from exc
    if not isinstance(payload, dict):
        raise ApimartImageError(f"{what}：返回结构不是 JSON object。")
    code = payload.get("code")
    if response.status_code >= 400 or (isinstance(code, int) and code >= 400):
        raise ApimartImageError(f"{what}失败：HTTP {response.status_code} / code {code}：{_snippet(payload)}")
    return payload


def _snippet(payload: Any, limit: int = 400) -> str:
    text = str(payload)
    return text if len(text) <= limit else f"{text[:limit]}…"


class ApimartImageApiAdapter:
    """APIMart 图片适配器：异步提交 + 有界轮询。"""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # transport 仅供测试注入（MockTransport）；生产留空。
        self._transport = transport

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        # 付费出口：构造供应商调用即过守卫（与 llm/resolver 的口径一致）。
        # 延迟导入是必须的：本模块属于**集成层**，模块级导入 services 层会形成
        # core.integrations → services.studio → core.tasks → core.integrations 的循环。
        from app.services.studio.llm_orchestration import dry_run

        dry_run.assert_outbound_allowed("APIMart 图片生成", outlet=dry_run.OUTLET_IMAGE)

        base_url = (cfg.base_url or "https://api.apimart.ai/v1").rstrip("/")
        headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
        body = build_submit_body(inp)

        notes: list[str] = []
        refs = [str(item) for item in (body.get("image_urls") or [])]
        if refs:
            notes.append(f"已按 APIMart 契约用 image_urls 送参考图 {len(refs)} 张。")
            data_url_refs = [item for item in refs if item.startswith("data:")]
            if data_url_refs:
                notes.append(
                    f"其中 {len(data_url_refs)} 张是 base64 data URL；APIMart 图片接口是否接受未经验证，"
                    "建议先放到公网（OSS）再用。"
                )

        budget = min(float(timeout_s or 0) or poll_timeout_seconds(), poll_timeout_seconds())
        deadline = time.monotonic() + max(1.0, budget)
        status = "submitted"
        urls: list[str] = []
        task_id = ""

        async with httpx.AsyncClient(
            timeout=max(30.0, min(deadline - time.monotonic(), 600.0)),
            transport=self._transport,
        ) as client:
            submitted = await client.post(f"{base_url}{SUBMIT_PATH}", headers=headers, json=body)
            payload = _json_or_raise(submitted, "提交 APIMart 图片任务")
            task_id = _extract_task_id(payload)
            if not task_id:
                raise ApimartImageError(f"APIMart 提交后没有返回 task_id：{_snippet(payload)}")
            notes.append(f"APIMart 任务号 {task_id}（可去供应商后台按号取回产物）。")

            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ApimartImageError(
                        f"等待 APIMart 任务 {task_id} 超时（provider_task_id={task_id}）；"
                        "任务可能仍在进行，可去供应商后台按号取回产物。"
                    )
                await asyncio.sleep(min(poll_interval_seconds(), max(0.1, remaining)))
                polled = await client.get(
                    f"{base_url}{TASK_PATH.format(task_id=task_id)}",
                    headers=headers,
                    params={"language": "zh"},
                )
                poll_payload = _json_or_raise(polled, "查询 APIMart 图片任务")
                status = _status_of(poll_payload)
                if status in FAILED_STATUSES:
                    raise ApimartImageError(f"APIMart 任务 {task_id} 状态 {status}：{_snippet(poll_payload)}")
                if status in SUCCESS_STATUSES:
                    urls = collect_image_urls(poll_payload)
                    if urls:
                        break

        if not urls:
            raise ApimartImageError(f"APIMart 任务 {task_id} 成功但没有解析出图片地址（provider_task_id={task_id}）。")
        return ImageGenerationResult(
            images=[ImageItem(url=url) for url in urls[: max(1, int(inp.n or 1))]],
            provider="apimart",
            provider_task_id=task_id,
            status=status,
            provider_notes=notes,
        )


__all__ = [
    "ApimartImageApiAdapter",
    "ApimartImageError",
    "SUPPORTED_RATIOS",
    "build_submit_body",
    "collect_image_urls",
    "poll_interval_seconds",
    "poll_timeout_seconds",
    "reference_urls",
    "resolve_ratio",
    "resolve_resolution",
]
