"""统一生成提示词渲染服务。"""

from app.services.generation.prompts.registry import PromptRendererRegistry, prompt_renderer_registry
from app.services.generation.prompts.renderers import (
    AssetImagePromptRenderer,
    ShotFramePromptRenderer,
    ShotVideoPromptRenderer,
)
from app.services.generation.prompts.types import (
    AssetImagePromptRenderInput,
    PromptRenderer,
    PromptRendererName,
    PromptRenderRequest,
    RenderedPromptSnapshot,
    ShotFramePromptRenderInput,
    ShotVideoPromptRenderInput,
)

__all__ = [
    "AssetImagePromptRenderer",
    "AssetImagePromptRenderInput",
    "PromptRenderer",
    "PromptRendererName",
    "PromptRendererRegistry",
    "PromptRenderRequest",
    "RenderedPromptSnapshot",
    "ShotFramePromptRenderer",
    "ShotFramePromptRenderInput",
    "ShotVideoPromptRenderer",
    "ShotVideoPromptRenderInput",
    "prompt_renderer_registry",
]
