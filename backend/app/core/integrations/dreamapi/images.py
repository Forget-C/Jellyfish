"""DreamAPI image generation and supported image-edit adapter routes."""

from __future__ import annotations

import re
from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, ImageItem
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.dreamapi.common import submit_and_poll
from app.core.integrations.dreamapi.storage import image_ref_to_public_url
from app.core.integrations.image_capabilities import resolve_image_size, validate_image_options

_SEEDREAM_MODELS = {
    "seedream-4.0",
    "seedream-4.5",
    "seedream-5.0-lite",
    "seedream-5.0-pro",
}
_SEEDREAM_SIZE_KEYWORDS = {
    "seedream-4.0": {"1K", "2K", "4K"},
    "seedream-4.5": {"2K", "4K"},
    "seedream-5.0-lite": {"2K", "3K", "4K"},
    "seedream-5.0-pro": {"1K", "1.5K", "2K"},
}
_SEEDREAM_PIXEL_LIMITS = {
    "seedream-4.0": (921_600, 16_777_216),
    "seedream-4.5": (3_686_400, 16_777_216),
    "seedream-5.0-lite": (3_686_400, 16_777_216),
    "seedream-5.0-pro": (921_600, 4_624_220),
}


def _normalize_model(value: str | None) -> str:
    """Normalize admin-entered model names while retaining their route suffixes."""
    return (value or "").strip().lower().replace("_", "-").replace(" ", "-")


def _image_urls(inp: ImageGenerationInput) -> list[str]:
    """Extract reference URLs from the shared image task contract."""
    urls: list[str] = []
    for image in inp.images:
        if not image.image_url:
            raise ValueError("DreamAPI requires image_url references; file_id references are unsupported")
        urls.append(image.image_url)
    return urls


def _dimensions(size: str | None, *, default: tuple[int, int] = (1024, 1024)) -> tuple[int, int]:
    """Parse an explicit width-by-height image size or return the route default."""
    if not size:
        return default
    match = re.fullmatch(r"\s*(\d{2,5})\s*x\s*(\d{2,5})\s*", size, re.IGNORECASE)
    if not match:
        raise ValueError(f"DreamAPI image model requires WIDTHxHEIGHT size, got {size!r}")
    width, height = (int(part) for part in match.groups())
    if width <= 0 or height <= 0:
        raise ValueError("DreamAPI image width and height must be positive")
    return width, height


def _validate_dimension_constraints(
    *,
    width: int,
    height: int,
    max_edge: int,
    multiple: int,
) -> None:
    """Reject dimensions that the selected DreamAPI route cannot process."""
    if width > max_edge or height > max_edge:
        raise ValueError(f"DreamAPI image dimensions must not exceed {max_edge} pixels per edge")
    if width % multiple or height % multiple:
        raise ValueError(f"DreamAPI image dimensions must be a multiple of {multiple}")


def _validate_seedream_size(model: str, size: str) -> None:
    """Check Seedream model-specific resolution keywords and total-pixel limits."""
    normalized_size = size.strip().upper()
    if normalized_size in _SEEDREAM_SIZE_KEYWORDS[model]:
        return
    if re.fullmatch(r"\d+(?:\.\d+)?K", normalized_size):
        raise ValueError(f"Unsupported size keyword for {model}: {size}")

    width, height = _dimensions(size)
    pixels = width * height
    minimum, maximum = _SEEDREAM_PIXEL_LIMITS[model]
    if pixels < minimum:
        raise ValueError(f"{model} requires a minimum pixel count of {minimum:,}")
    if pixels > maximum:
        raise ValueError(f"{model} maximum pixel count is {maximum:,}")
    if max(width, height) / min(width, height) > 16:
        raise ValueError(f"{model} aspect ratio must be between 1:16 and 16:1")


def _gemini_image_size(model: str, requested_size: str | None) -> str | None:
    """Map the task's dimensions to Gemini's documented resolution selector."""
    if not requested_size:
        return None
    supported = {"1K", "2K"} if model == "nano-banana-pro" else {"512", "1K", "2K", "4K"}
    keyword = requested_size.strip().upper()
    if keyword in supported:
        return keyword
    if re.fullmatch(r"\d+(?:\.\d+)?K", keyword):
        raise ValueError(f"Unsupported imageSize for {model}: {requested_size}")

    width, height = _dimensions(requested_size)
    edge = max(width, height)
    if edge <= 512:
        resolution = "512"
    elif edge <= 1024:
        resolution = "1K"
    elif edge <= 2048:
        resolution = "2K"
    elif edge <= 4096:
        resolution = "4K"
    else:
        raise ValueError("Gemini image dimensions must not exceed 4096 pixels per edge")
    if resolution not in supported:
        raise ValueError(f"Unsupported imageSize for {model}: {resolution}")
    return resolution


def _gpt_image_dimensions(size: str | None, *, is_25: bool) -> tuple[int, int]:
    """Validate GPT Image dimensions and GPT Image 2.5 pixel/aspect constraints."""
    width, height = _dimensions(size)
    _validate_dimension_constraints(width=width, height=height, max_edge=3840, multiple=16)
    if is_25:
        pixels = width * height
        if pixels < 655_360:
            raise ValueError("GPT Image 2.5 requires a minimum pixel count of 655,360")
        if pixels > 8_294_400:
            raise ValueError("GPT Image 2.5 maximum pixel count is 8,294,400")
        if max(width, height) / min(width, height) > 3:
            raise ValueError("GPT Image 2.5 aspect ratio must not exceed 3:1")
    return width, height


# This route table intentionally returns at each validated model-specific mapping.
# pylint: disable=too-many-return-statements
def _build_image_request(
    inp: ImageGenerationInput,
    *,
    image_urls: list[str] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Map a shared image task to one documented DreamAPI route and body."""
    model = _normalize_model(inp.model)
    if not model:
        raise ValueError("DreamAPI requires an explicit model name")
    urls = image_urls if image_urls is not None else _image_urls(inp)

    if model in _SEEDREAM_MODELS:
        if len(urls) > 10:
            raise ValueError("DreamAPI Seedream accepts at most ten reference images")
        if inp.size:
            _validate_seedream_size(model, inp.size)
        body: dict[str, Any] = {"model": model, "prompt": inp.prompt}
        if urls:
            body["image"] = urls
        if inp.size:
            body["size"] = inp.size
        if inp.seed is not None:
            body["seed"] = inp.seed
        return "/api/async/seedream", body

    if model == "flux":
        width, height = _dimensions(inp.size)
        _validate_dimension_constraints(width=width, height=height, max_edge=1600, multiple=16)
        body = {"prompt": inp.prompt, "width": width, "height": height, "num": inp.n}
        if inp.seed is not None:
            body["seed"] = inp.seed
        if urls:
            if len(urls) != 1:
                raise ValueError("DreamAPI Flux image-to-image accepts exactly one reference image")
            body["imageUrl"] = urls[0]
            return "/api/async/flux_image2image", body
        return "/api/async/flux_text2image", body

    if model in {"dreamimage", "dreamimage-2.0"}:
        if len(urls) != 1:
            raise ValueError("DreamAPI DreamImage 2.0 requires exactly one reference image")
        return "/api/async/dreamimage_2.0", {"image": urls[0], "prompt": inp.prompt}

    if model in {
        "nano-banana-2",
        "nano-banana-pro",
        "gemini-3.1-flash-image-preview",
        "gemini-3-pro-image-preview",
    }:
        is_pro = model in {"nano-banana-pro", "gemini-3-pro-image-preview"}
        api_model = "gemini-3-pro-image-preview" if is_pro else "gemini-3.1-flash-image-preview"
        logical_model = "nano-banana-pro" if is_pro else "nano-banana-2"
        body = {"model": api_model, "text": inp.prompt}
        image_size = _gemini_image_size(logical_model, inp.size)
        if image_size:
            body["imageSize"] = image_size
        if inp.target_ratio:
            body["aspectRatio"] = inp.target_ratio
        if urls:
            body["images"] = urls
        return "/api/async/google_gemini_image", body

    if model in {
        "gpt-image-2.5-flare-text-to-image",
        "gpt-image-2.5-flare-image-to-image",
        "gpt-image-2.5-sunburst-text-to-image",
        "gpt-image-2.5-sunburst-image-to-image",
    }:
        variant = "flare" if "flare" in model else "sunburst"
        is_image_to_image = model.endswith("image-to-image")
        if is_image_to_image and not urls:
            raise ValueError("GPT Image 2.5 image-to-image requires reference images")
        if not is_image_to_image and urls:
            raise ValueError("GPT Image 2.5 text-to-image does not accept reference images")
        if is_image_to_image and len(urls) > 4:
            raise ValueError("DreamAPI GPT Image 2.5 accepts at most four reference images")
        width, height = _gpt_image_dimensions(inp.size, is_25=True)
        body = {"prompt": inp.prompt, "width": width, "height": height, "quality": "low", "n": inp.n}
        endpoint_mode = "image_to_image" if is_image_to_image else "text_to_image"
        if is_image_to_image:
            body["images"] = urls
        return f"/api/async/gpt_image_2.5/{variant}/{endpoint_mode}", body

    if model in {"gpt-image-2", "gpt-image-2.0"}:
        if len(urls) > 4:
            raise ValueError("DreamAPI GPT Image 2 accepts at most four reference images")
        width, height = _gpt_image_dimensions(inp.size, is_25=False)
        body = {"prompt": inp.prompt, "width": width, "height": height, "quality": "low", "n": inp.n}
        if urls:
            body["images"] = urls
        return "/api/async/gpt_image", body

    if model == "colorize":
        if len(urls) != 1:
            raise ValueError("DreamAPI Colorize requires exactly one source image")
        return "/api/async/colorize", {"url": urls[0]}

    if model == "enhance":
        if len(urls) != 1:
            raise ValueError("DreamAPI Enhance requires exactly one source image")
        return "/api/async/enhance", {"imageUrl": urls[0]}

    if model in {"remove-background", "remove-bg"}:
        if len(urls) != 1:
            raise ValueError("DreamAPI Remove Background requires exactly one source image")
        return "/api/async/remove_background", {"url": urls[0]}

    if model == "swap-face":
        if len(urls) != 2:
            raise ValueError("DreamAPI Swap Face requires [target image, source face image]")
        return "/api/async/swap_face", {"url": urls[0], "faceImgUrl": urls[1]}

    if model in {"virtual-try-on", "try-on"}:
        if len(urls) not in {2, 3}:
            raise ValueError(
                "DreamAPI Virtual Try-On requires [model, one-piece garment] or "
                "[model, upper garment, lower garment]"
            )
        body: dict[str, Any] = {
            "modelImage": urls[0],
        }
        if inp.size:
            width, height = _dimensions(inp.size)
            if width * height > 1_200_000:
                raise ValueError("DreamAPI Virtual Try-On output must not exceed 1,200,000 pixels")
            body["width"] = width
            body["height"] = height
        if len(urls) == 2:
            body["overallClothes"] = urls[1]
        else:
            body["upperClothes"] = urls[1]
            body["lowerClothes"] = urls[2]
        return "/api/async/tryon_clothes", body

    if model == "outpainting":
        raise ValueError("DreamAPI Outpainting is unsupported: task contract has no per-edge outPaintSize")
    raise ValueError(f"Unsupported DreamAPI image model: {inp.model}")


class DreamAPIImageApiAdapter:
    """DreamAPI image HTTP; credentials are read only from the saved server config."""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        resolved_size = resolve_image_size(
            provider="dreamapi",
            model=inp.model,
            purpose=inp.purpose,
            target_ratio=inp.target_ratio,
            resolution_profile=inp.resolution_profile,
            requested_size=inp.size,
        )
        resolved_input = inp.model_copy(update={"size": resolved_size})
        validate_image_options(provider="dreamapi", model=resolved_input.model, input_=resolved_input)
        _build_image_request(resolved_input)

        urls = [
            await image_ref_to_public_url(cfg=cfg, image_ref=image_url, timeout_s=timeout_s)
            for image_url in _image_urls(resolved_input)
        ]
        endpoint, body = _build_image_request(resolved_input, image_urls=urls)
        task_id, data = await submit_and_poll(
            cfg=cfg,
            endpoint=endpoint,
            body=body,
            result_field="images",
            timeout_s=timeout_s,
        )
        images = [
            ImageItem(url=item.get("imageUrl"))
            for item in data["images"]
            if isinstance(item, dict) and item.get("imageUrl")
        ]
        if not images:
            raise RuntimeError("DreamAPI completed image task without usable imageUrl results")
        return ImageGenerationResult(
            images=images,
            provider="dreamapi",
            provider_task_id=task_id,
            status="succeeded",
        )
