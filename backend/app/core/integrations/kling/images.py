"""Kling 图片请求体。"""

from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput

_IMAGE_MODEL = "kling-v3"


def build_create_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    """将项目通用图片输入映射为可灵 Image 3.0 Omni 请求体。"""
    model = (inp.model or "").strip().lower()
    if model != _IMAGE_MODEL:
        raise ValueError("Kling image model must be kling-v3")
    body: dict[str, Any] = {"model_name": model, "prompt": inp.prompt, "n": inp.n}
    if inp.target_ratio:
        body["aspect_ratio"] = inp.target_ratio
    if inp.size:
        body["resolution"] = inp.size
    elif inp.resolution_profile:
        body["resolution"] = "2k" if inp.resolution_profile == "high" else "1k"
    if inp.watermark is not None:
        body["watermark_info"] = {"enabled": inp.watermark}
    if inp.images:
        body["image"] = _reference_image(inp)
    return body


def _reference_image(inp: ImageGenerationInput) -> str:
    """提取单张可灵参考图，并规范化 Base64 表示。"""
    if len(inp.images) != 1:
        raise ValueError("Kling Image 3.0 supports exactly one reference image")
    value = inp.images[0].image_url
    if not value:
        raise ValueError("Kling image references require image_url; file_id is not supported")
    marker = ";base64,"
    if value.startswith("data:") and marker in value:
        return value.split(marker, 1)[1]
    return value
