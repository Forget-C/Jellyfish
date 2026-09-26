"""出图服务（人物及场景生产项目）HTTP 客户端。

服务契约（已核实 ``人物及场景生产项目/src/server.js``）：
- ``GET  /api/service/health``                        服务健康 + OSS 配置状态
- ``POST /api/service/asset-image-tasks``             创建单资产单图任务（``source_task_id`` 幂等）
- ``GET  /api/service/asset-image-tasks/{task_id}``   查询任务与产物（含 ``oss_url``）

安全要点（本文件存在的理由）：
- 出图服务跑在**本机**（默认 ``127.0.0.1:4173``），而 DRY_RUN 的 httpx 出站兜底会放行本机地址
  （本意是让健康检查不被误杀）。因此"提交出图任务"这类真花钱的动作**不能指望出站兜底**，
  必须在每次请求前显式过 ``assert_outbound_allowed(outlet="image")``。
  这与中控台 ``guarded_image_tool_submit`` 记录的坑完全一致。
- 服务本身也支持 ``IMAGE_TOOL_SERVICE_DRY_RUN=1``（返回 mock 图）——那是**对端**的开关，
  本模块不做假设，仍以本项目守卫为准。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.services.studio.llm_orchestration import dry_run

SERVICE_URL_ENV = "IMAGE_TOOL_SERVICE_URL"
SERVICE_TIMEOUT_ENV = "JELLYFISH_IMAGE_TOOL_TIMEOUT_SECONDS"
DEFAULT_SERVICE_URL = "http://127.0.0.1:4173"
DEFAULT_TIMEOUT_SECONDS = 30

HEALTH_PATH = "/api/service/health"
CREATE_TASK_PATH = "/api/service/asset-image-tasks"
# 出图服务 V0 只接受这三种资产类型（costume 不在其契约内）。
SERVICE_ASSET_TYPES: tuple[str, ...] = ("character", "scene", "prop")

# ---------------------------------------------------------------------------
# 图片模型固定策略
# ---------------------------------------------------------------------------
# 用户明确指定：出图用 image2。对端（人物及场景生产项目）的 ``imageModelOptions()``
# 是「选项标签 → provider 实际模型」的映射，``resolveImageModelChoice("image2")``
# 返回 ``gpt-image-2``；而 ``POST /api/service/asset-image-tasks`` 里
# ``generation.image_model`` 会被**直接当作 provider 模型**用（不二次归一），
# 所以必须传 provider 模型名，不能传 "image2" 这个标签。
IMAGE_MODEL_ENV = "JELLYFISH_IMAGE_SERVICE_MODEL"
DEFAULT_IMAGE_MODEL_CHOICE = "image2"
IMAGE_MODEL_CHOICES: dict[str, str] = {
    "image2": "gpt-image-2",
    "gpt-image-2": "gpt-image-2",
    "midjourney": "midjourney",
    "midjourney 8.1": "midjourney",
    "midjourney 8.2": "midjourney",
    "nano banana 2": "nano-banana-2-ext",
    "nano-banana-2-ext": "nano-banana-2-ext",
}


def image_model_choice() -> str:
    """默认的图片模型选项标签（默认 image2）。"""
    return (os.environ.get(IMAGE_MODEL_ENV) or "").strip() or DEFAULT_IMAGE_MODEL_CHOICE


def resolve_image_provider_model(choice: str = "") -> tuple[str, str]:
    """把模型选项标签解析成 provider 实际模型。

    返回 ``(provider_model, source)``；``source`` 为 ``choice`` / ``passthrough`` / ``env``。
    未知取值**原样透传**（不静默改写），由调用方决定是否记 warning。
    """
    if not str(choice or "").strip():
        raw = image_model_choice()
        source = "env"
    else:
        raw = str(choice).strip()
        source = "choice"
    key = raw.lower()
    if key in IMAGE_MODEL_CHOICES:
        return IMAGE_MODEL_CHOICES[key], source
    return raw, "passthrough"


DEFAULT_GENERATION_TYPE: dict[str, str] = {
    "character": "character_sheet",
    "scene": "scene_reference",
    "prop": "prop_reference",
}


class ImageServiceError(RuntimeError):
    """出图服务请求失败（连接/状态码/响应结构）。"""

    def __init__(self, detail: str, *, status_code: int | None = None) -> None:
        self.status_code = status_code
        super().__init__(detail)


@dataclass(slots=True)
class ServiceTaskResult:
    """``POST /api/service/asset-image-tasks`` 的规范化结果。"""

    ok: bool
    service_task_id: str
    source_task_id: str
    status: str
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ServiceTaskDetail:
    """``GET /api/service/asset-image-tasks/{id}`` 的规范化结果。"""

    ok: bool
    service_task_id: str
    source_task_id: str
    status: str
    images: list[dict[str, Any]] = field(default_factory=list)
    error_message: str = ""
    oss_url: str = ""
    local_path: str = ""

    @property
    def completed(self) -> bool:
        return self.status in {"completed", "done"}


# 出图服务对外提供生成结果的静态路由前缀（其前端就是按这个前缀取图的）
SERVICE_STATIC_PREFIX = "/images/"


def service_base_url() -> str:
    """出图服务基址（环境变量优先，默认本机 4173）。"""
    return (os.environ.get(SERVICE_URL_ENV) or DEFAULT_SERVICE_URL).rstrip("/")


def service_timeout_seconds() -> int:
    raw = (os.environ.get(SERVICE_TIMEOUT_ENV) or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return DEFAULT_TIMEOUT_SECONDS


def build_task_payload(
    *,
    source_task_id: str,
    source_asset_id: str,
    asset: dict[str, Any],
    generation: dict[str, Any],
    source_project_id: str = "",
    source_script_id: str = "",
    oss_object_key_template: str = "",
    source: str = "jellyfish",
) -> dict[str, Any]:
    """组装出图服务的创建任务请求体（字段名与对端契约严格对齐）。"""
    payload: dict[str, Any] = {
        "source": source,
        "source_task_id": source_task_id,
        "source_asset_id": source_asset_id,
        "asset": asset,
        "generation": generation,
    }
    if source_project_id:
        payload["source_project_id"] = source_project_id
    if source_script_id:
        payload["source_script_id"] = source_script_id
    if oss_object_key_template:
        payload["oss"] = {"object_key_template": oss_object_key_template}
    return payload


async def _request_json(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    outlet: str = dry_run.OUTLET_IMAGE,
    detail: str = "",
    timeout: int | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """发一次请求。**任何 HTTP 之前先过守卫**（出图服务在本机，出站兜底拦不住它）。"""
    dry_run.assert_outbound_allowed(detail or f"{method} {path}", outlet=outlet)

    url = f"{service_base_url()}{path}"
    try:
        async with httpx.AsyncClient(
            timeout=timeout or service_timeout_seconds(),
            transport=transport,
        ) as client:
            response = await client.request(method, url, json=payload)
    except httpx.HTTPError as exc:
        raise ImageServiceError(f"无法连接出图服务（{url}）：{exc}") from exc

    if response.status_code >= 400:
        snippet = response.text[:300]
        raise ImageServiceError(f"出图服务返回 HTTP {response.status_code}：{snippet}", status_code=response.status_code)

    try:
        data = response.json()
    except ValueError as exc:
        raise ImageServiceError(f"出图服务返回的不是合法 JSON（{url}）。") from exc
    if not isinstance(data, dict):
        raise ImageServiceError(f"出图服务返回格式不是 JSON object（{url}）。")
    return data


async def probe_health(*, transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    """探测出图服务健康状态（DRY_RUN 下会被守卫拦截，不会真的连过去）。"""
    return await _request_json("GET", HEALTH_PATH, detail="出图服务健康检查", transport=transport)


async def create_asset_image_task(
    *,
    source_task_id: str,
    source_asset_id: str,
    asset: dict[str, Any],
    generation: dict[str, Any],
    source_project_id: str = "",
    source_script_id: str = "",
    oss_object_key_template: str = "",
    transport: httpx.AsyncBaseTransport | None = None,
) -> ServiceTaskResult:
    """创建一个单资产单图任务（``source_task_id`` 为幂等键）。"""
    if not str(source_task_id or "").strip():
        raise ImageServiceError("缺少 source_task_id（幂等键必填）。")
    asset_type = str(asset.get("asset_type") or "").strip()
    if asset_type not in SERVICE_ASSET_TYPES:
        raise ImageServiceError(
            f"出图服务只接受 asset_type ∈ {list(SERVICE_ASSET_TYPES)}，收到 {asset_type or '空'}。"
        )
    if not str(asset.get("prompt") or "").strip():
        raise ImageServiceError("缺少 asset.prompt，出图服务会拒绝该任务。")

    payload = build_task_payload(
        source_task_id=source_task_id,
        source_asset_id=source_asset_id,
        asset=asset,
        generation=generation,
        source_project_id=source_project_id,
        source_script_id=source_script_id,
        oss_object_key_template=oss_object_key_template,
    )
    data = await _request_json(
        "POST",
        CREATE_TASK_PATH,
        payload=payload,
        detail=f"创建出图任务 source_asset_id={source_asset_id}",
        transport=transport,
    )
    return ServiceTaskResult(
        ok=bool(data.get("ok", True)),
        service_task_id=str(data.get("service_task_id") or ""),
        source_task_id=str(data.get("source_task_id") or source_task_id),
        status=str(data.get("status") or ""),
        message=str(data.get("message") or ""),
        raw=data,
    )


async def get_asset_image_task(
    service_task_id: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ServiceTaskDetail:
    """查询出图任务状态与产物（含 ``oss_url``）。"""
    clean = str(service_task_id or "").strip()
    if not clean:
        raise ImageServiceError("缺少 service_task_id。")
    data = await _request_json(
        "GET",
        f"{CREATE_TASK_PATH}/{clean}",
        detail=f"查询出图任务 {clean}",
        transport=transport,
    )
    images = data.get("images")
    normalized_images = [item for item in images if isinstance(item, dict)] if isinstance(images, list) else []
    oss_url = next((str(item.get("oss_url")) for item in normalized_images if item.get("oss_url")), "")
    local_path = next((str(item.get("local_path")) for item in normalized_images if item.get("local_path")), "")
    # 出图服务在 OSS 上传失败（403）时只给**服务静态路由**形式 `/images/xxx.png`。
    # 这种相对路径没法直接用（采纳/登记都要求能下载的绝对地址），用户不得不手工拼前缀。
    # 只对这一种前缀补全 —— 服务也可能返回它自己的文件系统绝对路径（如 /tmp/a.png），
    # 那种不能拼服务地址，否则会变成不存在的 URL。
    if local_path.startswith(SERVICE_STATIC_PREFIX):
        local_path = f"{service_base_url()}{local_path}"
    return ServiceTaskDetail(
        ok=bool(data.get("ok", True)),
        service_task_id=str(data.get("service_task_id") or clean),
        source_task_id=str(data.get("source_task_id") or ""),
        status=str(data.get("status") or ""),
        images=normalized_images,
        error_message=str(data.get("error_message") or ""),
        oss_url=oss_url,
        local_path=local_path,
    )
