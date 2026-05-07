"""阿里云百炼 DashScope 原生视频生成 HTTP 适配。"""

from __future__ import annotations

import logging
from typing import Any, Literal

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64
from app.core.integrations.aliyun.dashscope_images import dashscope_http_origin
from app.core.integrations.openai.video_payload import to_image_data_url

logger = logging.getLogger(__name__)


def _dashscope_video_error_detail(response: Any) -> str | None:
    """从 DashScope 错误体提取可读错误信息。"""
    try:
        data = response.json()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    code = data.get("code")
    message = data.get("message")
    parts = [str(item) for item in (code, message) if item is not None and str(item).strip()]
    if parts:
        return ": ".join(parts) if len(parts) > 1 else parts[0]
    err = data.get("error")
    if isinstance(err, dict):
        ecode = err.get("code")
        emsg = err.get("message")
        eparts = [str(item) for item in (ecode, emsg) if item is not None and str(item).strip()]
        if eparts:
            return ": ".join(eparts) if len(eparts) > 1 else eparts[0]
    return None


def _ratio_to_dashscope_size(ratio: str) -> str:
    """将业务 ratio 映射为 DashScope 常见 size。"""
    mapping = {
        "16:9": "1280*720",
        "4:3": "960*720",
        "1:1": "960*960",
        "3:4": "720*960",
        "9:16": "720*1280",
        "21:9": "1680*720",
    }
    return mapping.get(ratio, "1280*720")


def _dashscope_video_mode(
    model: str | None,
    *,
    has_image_refs: bool,
) -> Literal["t2v", "i2v", "ref_video"]:
    """按模型名称推断 DashScope 视频任务形态，决定 input.media 是否携带图片/视频。

    说明：不同模型对 input.media 的要求差异很大。百炼 HTTP 接口中，帧图需使用
    type=first_frame / last_frame（见模型文档），禁止使用旧字段 reference_image。
    """
    m = (model or "").strip().lower()
    if not m:
        # 未带模型名时不可猜测为图生视频，否则易与上游「仅接受文生 / 需视频参考」的校验冲突。
        return "t2v"

    # 参考视频 / 视频续写等：media 中需要 reference_video（公网 URL），不能仅用图片冒充。
    if any(
        k in m
        for k in (
            "v2v",
            "video2video",
            "video-to-video",
            "ref2video",
            "reference2video",
            "reference-video",
            "reference_video",
        )
    ):
        return "ref_video"
    if "reference" in m and "student" in m:
        return "ref_video"

    if any(k in m for k in ("i2v", "img2video", "image-to-video", "kf2v")):
        return "i2v"
    if any(k in m for k in ("t2v", "text-to-video", "text2video")):
        return "t2v"

    # 未识别名称：默认文生视频（不附带 reference_image）。仅当名称明确含 i2v 等关键字时才走图生视频；
    # 若这里把「无关键字的文生模型 + 分镜帧图」当成 i2v，会只传图片而触发
    #「At least one video item is required in media list」等错误。
    return "t2v"


def _build_dashscope_video_body(input_: VideoGenerationInput) -> dict[str, Any]:
    """构建 DashScope 视频生成请求体。"""
    input_payload: dict[str, Any] = {}
    prompt = (input_.prompt or "").strip()
    if prompt:
        input_payload["prompt"] = prompt

    key_frame = _strip_optional_b64(input_.key_frame_base64)
    first_frame = _strip_optional_b64(input_.first_frame_base64)
    last_frame = _strip_optional_b64(input_.last_frame_base64)
    has_image_refs = bool(first_frame or last_frame or key_frame)

    mode = _dashscope_video_mode(input_.model, has_image_refs=has_image_refs)
    if mode == "t2v" and has_image_refs:
        logger.debug(
            "DashScope video: model %r uses text-to-video request path; skipping frame media in body",
            (input_.model or "").strip() or None,
        )

    if mode == "ref_video":
        raise RuntimeError(
            "当前模型属于「参考视频 / 视频类参考」能力：请求体 input.media 中需要至少一条 "
            "type=reference_video 的视频 URL；当前业务仅支持帧图参考，无法调用该模型。"
            "请在模型管理中将默认视频模型切换为文生视频（名称通常含 t2v）或图生视频（含 i2v）。"
        )

    # 文生视频：不要附带帧 media；否则部分模型会校验失败。
    # 图生视频：input.media 每项 type 须为百炼文档允许的枚举（如 first_frame、last_frame）。
    if mode == "i2v":
        media_items: list[dict[str, str]] = []
        if first_frame:
            media_items.append({"type": "first_frame", "url": to_image_data_url(first_frame)})
        if last_frame:
            media_items.append({"type": "last_frame", "url": to_image_data_url(last_frame)})
        if key_frame and not first_frame and not last_frame:
            media_items.append({"type": "first_frame", "url": to_image_data_url(key_frame)})
        if media_items:
            input_payload["media"] = media_items

    parameters: dict[str, Any] = {
        "size": _ratio_to_dashscope_size(input_.ratio),
        "ratio": input_.ratio,
    }
    if input_.seconds is not None:
        parameters["duration"] = int(input_.seconds)
    if input_.seed is not None:
        parameters["seed"] = int(input_.seed)
    if input_.watermark is not None:
        parameters["watermark"] = bool(input_.watermark)

    body: dict[str, Any] = {
        "model": (input_.model or "").strip(),
        "input": input_payload,
        "parameters": parameters,
    }
    return body


def _dashscope_task_failure_detail(meta: dict[str, Any]) -> str | None:
    """提取任务失败时的 code/message，便于直接反馈给前端。"""
    if not isinstance(meta, dict):
        return None
    output = meta.get("output")
    if not isinstance(output, dict):
        return None
    code = output.get("code")
    message = output.get("message")
    parts = [str(item) for item in (code, message) if item is not None and str(item).strip()]
    if not parts:
        return None
    return ": ".join(parts) if len(parts) > 1 else parts[0]


class DashScopeVideoApiAdapter:
    """DashScope 视频生成：创建异步任务 + 查询任务状态。"""

    async def create_video_task(
        self,
        *,
        cfg: ProviderConfig,
        input_: VideoGenerationInput,
        timeout_s: float,
    ) -> str:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from exc

        origin = dashscope_http_origin(cfg.base_url)
        create_url = f"{origin.rstrip('/')}/api/v1/services/aigc/video-generation/video-synthesis"
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }
        body = _build_dashscope_video_body(input_)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(create_url, headers=headers, json=body)
            if response.status_code >= 400:
                detail = _dashscope_video_error_detail(response)
                if detail:
                    raise RuntimeError(detail)
            response.raise_for_status()
            data: dict[str, Any] = response.json()
            output = data.get("output") if isinstance(data.get("output"), dict) else {}
            task_id = str(output.get("task_id") or data.get("task_id") or data.get("id") or "").strip()
            if not task_id:
                raise RuntimeError(f"DashScope video create missing task_id: {data!r}")
            return task_id

    async def get_video_task(
        self,
        *,
        cfg: ProviderConfig,
        task_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("httpx is required for video generation tasks") from exc

        origin = dashscope_http_origin(cfg.base_url)
        query_url = f"{origin.rstrip('/')}/api/v1/tasks/{task_id}"
        headers = {"Authorization": f"Bearer {cfg.api_key}"}

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(query_url, headers=headers)
            if response.status_code >= 400:
                detail = _dashscope_video_error_detail(response)
                if detail:
                    raise RuntimeError(detail)
            response.raise_for_status()
            return response.json()
