"""DreamAPI video-generation modes representable by Jellyfish's frame contract."""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput, VideoGenerationResult
from app.core.integrations.dreamapi.common import submit_and_poll
from app.core.integrations.dreamapi.storage import image_ref_to_public_url
from app.core.integrations.video_capabilities import validate_video_options


def _normalize_model(value: str | None) -> str:
    """Normalize model labels from the provider/model settings UI."""
    return (value or "").strip().lower().replace("_", "-").replace(" ", "-")


def _frame_values(input_: VideoGenerationInput) -> list[str]:
    """Return the task's ordered first/last frame values after contract validation."""
    if input_.key_frame_base64:
        raise ValueError("DreamAPI video routes do not accept a separate key frame")
    if input_.last_frame_base64 and not input_.first_frame_base64:
        raise ValueError("DreamAPI last-frame input requires a first frame")
    if not input_.first_frame_base64:
        return []
    values = [input_.first_frame_base64]
    if input_.last_frame_base64:
        values.append(input_.last_frame_base64)
    return values


def _as_image_reference(value: str) -> str:
    """Preserve remote/data URLs and wrap raw frame base64 as a JPEG data URL."""
    stripped = value.strip()
    if stripped.lower().startswith(("data:", "https://", "http://")):
        return stripped
    return f"data:image/jpeg;base64,{stripped}"


def _build_video_request(
    input_: VideoGenerationInput,
    *,
    image_urls: list[str] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Map text/first/last-frame task inputs to a documented DreamAPI video route."""
    model = _normalize_model(input_.model)
    if not model:
        raise ValueError("DreamAPI requires an explicit video model name")
    prompt = (input_.prompt or "").strip()
    if not prompt:
        raise ValueError(f"DreamAPI {model} requires a text prompt")
    frame_values = _frame_values(input_)
    urls = image_urls if image_urls is not None else [_as_image_reference(value) for value in frame_values]
    if len(urls) != len(frame_values):
        raise ValueError("DreamAPI video frame upload count does not match the input frames")

    if model == "dreamvideo-3.0":
        body: dict[str, Any] = {"prompt": prompt}
        if input_.seconds is not None:
            body["duration"] = input_.seconds
        body["aspectRatio"] = input_.ratio
        if input_.seed is not None:
            if input_.seed == 0:
                raise ValueError("DreamVideo 3.0 seed must be -1 or a positive integer")
            body["seed"] = input_.seed
        if urls:
            body["images"] = urls
            return "/api/async/dreamvideo_3.0/image_to_video", body
        return "/api/async/dreamvideo_3.0/text_to_video", body

    if model in {"wan2.1", "wan-2.1"}:
        if len(prompt) >= 1500:
            raise ValueError("DreamAPI Wan 2.1 prompt must be fewer than 1,500 characters")
        if input_.seconds is not None and input_.seconds != 5:
            raise ValueError("DreamAPI Wan 2.1 supports a fixed five-second output")
        if input_.ratio != "16:9":
            raise ValueError("DreamAPI Wan 2.1 route does not expose an aspect-ratio parameter")
        if len(urls) == 2:
            return "/api/async/wan/head_tail_to_video/2.1", {
                "firstImage": urls[0],
                "lastImage": urls[1],
                "prompt": prompt,
            }
        if len(urls) == 1:
            return "/api/async/wan/image_to_video/2.1", {
                "image": urls[0],
                "prompt": prompt,
                "resolution": "480p",
            }
        return "/api/async/wan/text_to_video/2.1", {
            "prompt": prompt,
            "resolution": "480p",
        }

    if model in {"seedance-2.0", "seedance-2.0-mini", "seedance-2.5"}:
        if len(prompt) >= 1500:
            raise ValueError(f"DreamAPI {model} prompt must be fewer than 1,500 characters")
        api_model = model
        body = {
            "model": api_model,
            "prompt": prompt,
            "resolution": "480p",
            "duration": input_.seconds if input_.seconds is not None else 5,
            "ratio": "adaptive" if model == "seedance-2.5" and len(urls) == 2 else input_.ratio,
        }
        if input_.seed is not None:
            body["seed"] = input_.seed
        if urls:
            body["imageUrl"] = urls[0]
        if len(urls) == 2:
            body["endImageUrl"] = urls[1]
        return "/api/async/seedance_2.5" if model == "seedance-2.5" else "/api/async/seedance_2.0", body

    raise ValueError(f"Unsupported DreamAPI video model: {input_.model or '<empty>'}")


class DreamAPIVideoApiAdapter:
    """DreamAPI async video submission with server-side frame upload and result polling."""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        input_: VideoGenerationInput,
        timeout_s: float,
    ) -> VideoGenerationResult:
        validate_video_options(provider="dreamapi", model=input_.model, input_=input_)
        _build_video_request(input_)
        frame_urls = [
            await image_ref_to_public_url(cfg=cfg, image_ref=value, timeout_s=timeout_s)
            for value in _frame_values(input_)
        ]
        endpoint, body = _build_video_request(input_, image_urls=frame_urls)
        task_id, data = await submit_and_poll(
            cfg=cfg,
            endpoint=endpoint,
            body=body,
            result_field="videos",
            timeout_s=timeout_s,
        )
        video = next(
            (item for item in data["videos"] if isinstance(item, dict) and item.get("videoUrl")),
            None,
        )
        if video is None:
            raise RuntimeError("DreamAPI completed video task without a usable videoUrl result")
        return VideoGenerationResult(
            url=str(video["videoUrl"]),
            file_id=None,
            provider_task_id=task_id,
            provider="dreamapi",
            status="succeeded",
        )
