"""统一 PromptRenderer 的最小单元覆盖。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.generation.prompts import (
    PromptRendererName,
    PromptRendererRegistry,
    PromptRenderRequest,
    prompt_renderer_registry,
)
from app.services.generation.prompts.renderers import AssetImagePromptRenderer


def test_registry_resolves_only_registered_fixed_renderer() -> None:
    """注册表只为 Binder 已确定的名称提供渲染器。"""
    renderer = prompt_renderer_registry.resolve(PromptRendererName.asset_image)

    assert isinstance(renderer, AssetImagePromptRenderer)
    with pytest.raises(LookupError, match="not registered"):
        PromptRendererRegistry().resolve(PromptRendererName.asset_image)


def test_render_request_rejects_target_and_renderer_override() -> None:
    """渲染请求不能携带路由 Binder 负责的 target 或 renderer 字段。"""
    with pytest.raises(ValidationError):
        PromptRenderRequest.model_validate(
            {
                "renderer": "shot_video",
                "target": {"kind": "shot_video", "entity_id": "shot-1"},
                "input": {"kind": "shot_frame", "shot_id": "shot-1", "frame_type": "first"},
            }
        )
