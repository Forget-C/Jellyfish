"""APIMart 视频：请求体构造。

协议（2026-09-17 实读官方文档 + 实测）：
  POST {base_url}/videos/generations
  字段：model / prompt / negative_prompt / resolution / size / duration /
        generate_audio / image_urls / first_frame_image / last_frame_image
  注意画幅字段名是 ``size``（不是 ``aspect_ratio``），时长字段是 ``duration``（不是 ``seconds``）。
"""

from __future__ import annotations

from typing import Any

from app.core.contracts.video_generation import VideoGenerationInput, _strip_optional_b64
from app.core.integrations.apimart.video_capabilities import validate_apimart_video_options
from app.core.integrations.openai.video_payload import to_audio_data_url
from app.core.integrations.video_capabilities import (
    audio_input_supported,
    resolve_effective_ratio,
    resolve_effective_resolution,
)


def _provider_image_ref(value: str) -> str:
    """APIMart 只接受 ``http(s)://`` / ``asset://`` —— data URL 直接拒绝并给出可执行建议。

    实测（2026-09-18）：
    ``Invalid format for first_frame_image. Only http/https URLs or asset:// private
    asset URLs are supported.``
    """
    text = str(value or "").strip()
    if text.startswith(("http://", "https://", "asset://")):
        return text
    raise ValueError(
        "APIMart 的图片入参只接受 http(s):// 或 asset:// 公网地址，不接受 base64 data URL。"
        "请把参考图放到公网（OSS 等）再提交，或用 POST /api/v1/studio/files/external "
        "把公网图片登记成素材后作为参考图。"
    )


def build_create_task_body(input_: VideoGenerationInput) -> dict[str, Any]:
    validate_apimart_video_options(input_)

    body: dict[str, Any] = {}

    prompt = (input_.prompt or "").strip()
    if prompt:
        body["prompt"] = prompt

    if input_.model:
        body["model"] = input_.model

    # 参考音频先收集：下面的画面参考图要按"有没有音频"分流。
    audio_urls = [
        str(item).strip()
        for item in (getattr(input_, "audio_urls", None) or [])
        if str(item).strip()
    ]
    audio_urls_present = bool(audio_urls)

    # 首帧 / 尾帧走专属字段；关键帧兜底进 image_urls。
    ff = _strip_optional_b64(input_.first_frame_base64)
    lf = _strip_optional_b64(input_.last_frame_base64)
    kf = _strip_optional_b64(input_.key_frame_base64)
    reference_images: list[str] = []
    if audio_urls_present:
        # 官方警告：「使用首尾帧图片时参考音频不可用」。实测同时发 first_frame_image /
        # last_frame_image + audio_urls 会被直接 400（实测 2026-09-18，零计费）。
        # 官方文档里"参考图 + 参考音频"的组合是 image_urls + audio_urls（场景 2 / 场景 9），
        # 所以这里把首/尾帧改以 image_urls 提交 —— 语义等同"图生视频（首帧）"，
        # 但尾帧不再是严格的结束帧，这一点会由上层写成 warning 告诉用户。
        for item in (ff, lf, kf):
            if item:
                reference_images.append(_provider_image_ref(item))
    else:
        if ff:
            body["first_frame_image"] = _provider_image_ref(ff)
        if lf:
            body["last_frame_image"] = _provider_image_ref(lf)
        if kf:
            reference_images.append(_provider_image_ref(kf))

    if reference_images:
        body["image_urls"] = reference_images[:9]

    resolution = resolve_effective_resolution(
        provider="apimart",
        model=input_.model,
        requested=getattr(input_, "resolution", None),
    )
    if resolution:
        body["resolution"] = resolution

    effective_ratio = resolve_effective_ratio(input_)
    if effective_ratio:
        body["size"] = effective_ratio

    if input_.seconds is not None:
        body["duration"] = int(input_.seconds)

    # ---- 音频 ----
    # generate_audio 是协议自带的布尔开关（让模型顺带生成音频），直传。
    if getattr(input_, "generate_audio", None) is not None:
        body["generate_audio"] = bool(input_.generate_audio)

    # 参考音频：seedance 的字段就是 ``audio_urls``（数组，公网 URL 或 asset://）。
    # 官方约束：最多 3 条、总时长 ≤15s、需与参考图/参考视频一起使用。
    # base64 不是 APIMart 的入参形式，明确不发（要发必须换成公网 URL 或 asset://）。
    if audio_urls_present and audio_input_supported(provider="apimart", model=input_.model):
        body["audio_urls"] = audio_urls[:3]
    _ = to_audio_data_url  # 保留给支持 base64 的适配器复用，避免 import 被误删

    if not (body.get("prompt") or body.get("image_urls") or body.get("first_frame_image") or body.get("last_frame_image")):
        raise RuntimeError("APIMart video requires non-empty prompt or at least one reference image")

    return body
