"""Vidu 图片请求体。"""

from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.integrations.image_capabilities import resolve_image_size
from app.core.integrations.vidu.image_capabilities import validate_vidu_image_options


def build_create_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    """将通用图片输入映射为 Vidu Reference to Image 请求体。"""
    model = (inp.model or "").strip()
    if not model:
        raise ValueError("Vidu image generation requires model")
    validate_vidu_image_options(inp)
    size = resolve_image_size(
        provider="vidu",
        model=model,
        purpose=inp.purpose,
        target_ratio=inp.target_ratio,
        resolution_profile=inp.resolution_profile,
        requested_size=inp.size,
    )
    body: dict[str, Any] = {"model": model, "prompt": inp.prompt}
    images = _resolve_reference_images(inp)
    # Vidu 将 viduq2 的“0 张参考图”定义为合法输入，但中国站服务端仍要求
    # images 字段存在；因此文生图必须显式传空数组，不能省略该字段。
    body["images"] = images
    if inp.target_ratio:
        body["aspect_ratio"] = inp.target_ratio
    if size:
        body["resolution"] = size
    if inp.seed is not None:
        body["seed"] = int(inp.seed)
    return body


def _resolve_reference_images(inp: ImageGenerationInput) -> list[str]:
    """提取 Vidu 可接受的 URL 或 data URL 参考图，拒绝仅有 OpenAI file_id 的输入。"""
    images: list[str] = []
    for ref in inp.images:
        if ref.image_url:
            images.append(ref.image_url)
            continue
        raise ValueError("Vidu image references require image_url; file_id is not supported")
    return images
