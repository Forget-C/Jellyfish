"""一次提交或一次查询的供应商边界；不持有数据库、不循环等待、不重试创建。"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.model_provider import ModelProviderConfigurationError
from app.core.contracts.provider_media import (
    MediaModelProvider, MediaResult, PollObservation, ProviderImageInput, ProviderVideoInput, RemoteCancellation,
    RemoteTaskReference,
)
from app.core.integrations.image_capabilities import prepare_image_options
from app.core.integrations.kling.task_api import extract_task_id, normalize_image_state, normalize_video_state, unwrap_video_task
from app.core.integrations.kling.images import build_create_image_body as kling_image_body
from app.core.integrations.kling.video_payload import build_create_video_request as kling_video_request
from app.core.integrations.openai.video_payload import build_create_video_body as openai_video_body
from app.core.integrations.vidu.images import build_create_image_body as vidu_image_body
from app.core.integrations.vidu.video_payload import build_create_video_request as vidu_video_request
from app.core.integrations.volcengine.video_payload import build_create_task_body as volcengine_video_body
from app.core.integrations.volcengine.images import build_volcengine_image_generations_url

_DEFAULT_URLS = {
    "openai": "https://api.openai.com/v1", "volcengine": "https://ark.cn-beijing.volces.com/api/v3",
    "vidu": "https://api.vidu.cn", "kling": "https://api-beijing.klingai.com",
}


def supports_remote_cancel(provider: str, kind: str) -> bool:
    """只开放已经接入的供应商远端取消操作。"""
    return provider == "vidu" and kind in {"image_generation", "video_generation"}


class ProviderDataError(ValueError):
    """供应商成功响应缺少必需数据，应直接失败而不是重新创建。"""


def bind_media_provider(config: ProviderConfig, *, client: httpx.AsyncClient) -> MediaModelProvider:
    """绑定有已注册媒体操作的供应商，连接池仍由调用方管理。"""
    if config.provider not in _DEFAULT_URLS:
        raise ModelProviderConfigurationError(f"Unsupported media provider: {config.provider!r}")
    return MediaProvider(config, client=client)


class MediaProvider:
    """每次调用最多发送一次供应商 API 请求。"""

    def __init__(self, config: ProviderConfig, *, client: httpx.AsyncClient):
        self.config = config
        self.client = client

    async def _send(self, method: str, path: str, *, body=None, params=None) -> httpx.Response:
        cfg = self.config
        scheme = "Token" if cfg.provider == "vidu" else "Bearer"
        base = httpx.URL(cfg.base_url or _DEFAULT_URLS[cfg.provider])
        root = str(base.copy_with(query=None, fragment=None)).rstrip("/")
        endpoint = root + path
        if cfg.provider == "volcengine" and path == "/images/generations":
            endpoint = build_volcengine_image_generations_url(root)
        url = httpx.URL(endpoint).copy_with(query=base.query or None)
        return await self.client.request(method, url.copy_merge_params(params or {}), json=body,
                                         headers={"Authorization": f"{scheme} {cfg.api_key}"})

    async def _request(self, method: str, path: str, *, body=None, params=None) -> dict:
        return self._decode(await self._send(method, path, body=body, params=params))

    def _decode(self, response: httpx.Response) -> dict:
        response.raise_for_status()
        try:
            data = response.json()
        except ValueError as error:
            raise ProviderDataError("provider response is not JSON") from error
        if not isinstance(data, dict):
            raise ProviderDataError("provider response is not an object")
        if self.config.provider == "kling" and data.get("code") not in (None, 0, "0", 200, "200"):
            raise ProviderDataError("provider returned a non-success business code")
        return data

    async def invoke(self, input_: ProviderImageInput | ProviderVideoInput) -> RemoteTaskReference | tuple[MediaResult, ...]:
        """异步接口返回远端 ID，同步图片返回结果；任何失败都不重试提交。"""
        data = self._decode(await self.submit_once(input_))
        if isinstance(input_, ProviderVideoInput):
            return RemoteTaskReference("video_generation", self._task_id(data))
        if self.config.provider in {"vidu", "kling"}:
            return RemoteTaskReference("image_generation", self._task_id(data))
        return self._outputs(data.get("data"))

    async def submit_once(self, input_: ProviderImageInput | ProviderVideoInput, *, connection_test=False) -> httpx.Response:
        """连接测试与生成共享首次提交。连接测试允许输入目录以外的可灵型号。"""
        cfg = self.config
        if isinstance(input_, ProviderImageInput):
            path, body = self._image_request(input_, connection_test)
        elif cfg.provider == "openai":
            path, body = "/videos", openai_video_body(input_)
        elif cfg.provider == "volcengine":
            path, body = "/contents/generations/tasks", volcengine_video_body(input_)
        elif cfg.provider == "vidu":
            path, body = vidu_video_request(input_)
        elif cfg.provider == "kling":
            path, body = kling_video_request(input_, connection_test=connection_test)
        else:
            raise ModelProviderConfigurationError(f"Unsupported video provider: {cfg.provider!r}")
        return await self._send("POST", path, body=body)

    def _image_request(self, inp: ProviderImageInput, connection_test: bool) -> tuple[str, dict]:
        cfg = self.config
        if cfg.provider == "vidu":
            return "/ent/v2/reference2image", vidu_image_body(inp)
        if cfg.provider == "kling":
            return "/v1/images/generations", kling_image_body(inp, connection_test=connection_test)
        inp = prepare_image_options(cfg.provider, inp)
        body: dict[str, Any] = {"prompt": inp.prompt, "model": inp.model}
        if inp.size:
            body["size"] = inp.size
        if inp.watermark is not None:
            body["watermark"] = inp.watermark
        path = "/images/generations"
        if cfg.provider == "openai":
            body["n"] = inp.n
            if inp.images:
                path = "/images/edits"
                body["images"] = [{"image_url": ref.image_url} for ref in inp.images]
            else:
                body["response_format"] = inp.response_format
        elif cfg.provider == "volcengine":
            body["n"] = inp.n
            body["response_format"] = inp.response_format
            if inp.seed is not None:
                body["seed"] = inp.seed
            if inp.images:
                body["image"] = [ref.image_url for ref in inp.images]
        return path, body

    async def poll(self, reference: RemoteTaskReference) -> PollObservation:
        """仅查询已有 ID；成功但无结果、缺状态或未知状态均作为数据缺失处理。"""
        cfg = self.config
        image = reference.kind == "image_generation"
        task_id = reference.task_id
        if (reference.kind not in {"image_generation", "video_generation"}
                or (image and cfg.provider in {"openai", "volcengine"})):
            raise ModelProviderConfigurationError("This media operation cannot be polled")
        params = None
        if cfg.provider == "openai":
            path = f"/videos/{task_id}"
        elif cfg.provider == "volcengine":
            path = f"/contents/generations/tasks/{task_id}"
        elif cfg.provider == "vidu":
            path = f"/ent/v2/tasks/{task_id}/creations"
        elif image:
            path = f"/v1/images/generations/{task_id}"
        else:
            path, params = "/tasks", {"task_ids": task_id}
        data = await self._request("GET", path, params=params)
        if cfg.provider == "kling":
            state = normalize_image_state(data) if image else normalize_video_state(data)
        else:
            state = str(data.get("state") or data.get("status") or "").lower()
        if cfg.provider == "vidu" and state in {"created", "queueing"}:
            return PollObservation("running")
        if state in {"queued", "pending", "submitted", "processing", "running", "in_progress"}:
            return PollObservation("running")
        if state in {"failed", "failure", "cancelled", "canceled", "expired"}:
            return PollObservation("cancelled" if state in {"cancelled", "canceled"} else "failed")
        if state not in {"success", "succeed", "succeeded", "completed"}:
            raise ProviderDataError("provider task status is missing or unsupported")
        if cfg.provider == "openai":
            base = (cfg.base_url or _DEFAULT_URLS["openai"]).rstrip("/")
            outputs = (MediaResult(url=f"{base}/videos/{task_id}/content", headers={"Authorization": f"Bearer {cfg.api_key}"}),)
        elif cfg.provider == "volcengine":
            outputs = self._outputs([{"url": (data.get("content") or {}).get("video_url")}])
        elif cfg.provider == "vidu":
            outputs = self._outputs(data.get("creations"))
        elif image:
            task = data.get("data") if isinstance(data.get("data"), dict) else data
            result = task.get("task_result") if isinstance(task.get("task_result"), dict) else task
            outputs = self._outputs(result.get("images"))
        else:
            outputs = self._outputs([item for item in unwrap_video_task(data).get("outputs", []) if item.get("type") == "video"])
        return PollObservation("succeeded", outputs)

    async def cancel(self, reference: RemoteTaskReference) -> RemoteCancellation:
        """按 Vidu 取消端点回执判定结果，已受理时继续查询原 ID。"""
        cfg = self.config
        if not supports_remote_cancel(cfg.provider, reference.kind):
            return "unsupported"
        base = (cfg.base_url or _DEFAULT_URLS[cfg.provider]).rstrip("/")
        task_id = quote(reference.task_id, safe="")
        response = await self.client.post(
            f"{base}/ent/v2/tasks/{task_id}/cancel", headers={"Authorization": f"Token {cfg.api_key}"},
            json={"id": reference.task_id},
        )
        if 400 <= response.status_code < 500 and response.status_code not in {408, 429}:
            return "rejected"
        response.raise_for_status()
        if response.status_code == 202:
            return "accepted"
        if not response.content:
            return "confirmed"
        body = response.json()
        if not isinstance(body, dict):
            raise ProviderDataError("provider cancellation response is not an object")
        if body.get("code") not in (None, 0, "0", 200, "200"):
            return "rejected"
        confirmed = not body or str(body.get("state") or body.get("status")).lower() in {"cancelled", "canceled"}
        return "confirmed" if confirmed else "accepted"

    @staticmethod
    def _task_id(data: dict) -> str:
        """成功创建必须返回非空 ID，不引入不确定状态或再次提交。"""
        task_id = extract_task_id(data)
        if not task_id or not task_id.strip():
            raise ProviderDataError("provider_task_id_missing")
        return task_id.strip()

    @staticmethod
    def _outputs(data) -> tuple[MediaResult, ...]:
        """要求每个声明输出都具备结果数据，避免悄悄丢弃缺失项。"""
        if not isinstance(data, list) or not data:
            raise ProviderDataError("provider_outputs_missing")
        outputs = []
        for item in data:
            if not isinstance(item, dict) or not (item.get("url") or item.get("image_url") or item.get("b64_json")):
                raise ProviderDataError("provider_output_data_missing")
            url = item.get("url") or item.get("image_url")
            b64 = item.get("b64_json")
            if (url is not None and not isinstance(url, str)) or (b64 is not None and not isinstance(b64, str)):
                raise ProviderDataError("provider_output_data_invalid")
            outputs.append(MediaResult(url=url, b64_json=b64))
        return tuple(outputs)
