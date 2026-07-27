"""PromptRenderer 的封闭注册表。"""

from __future__ import annotations

from app.services.generation.prompts.renderers import (
    AssetImagePromptRenderer,
    ShotFramePromptRenderer,
    ShotVideoPromptRenderer,
)
from app.services.generation.prompts.types import PromptRenderer, PromptRendererName


class PromptRendererRegistry:
    """按 Binder 已确定的 renderer 名称解析渲染器，禁止请求自行选择实现。"""

    def __init__(self, renderers: list[PromptRenderer] | None = None) -> None:
        """以显式实例化的渲染器构建注册表并拒绝重复名称。"""
        self._renderers: dict[PromptRendererName, PromptRenderer] = {}
        for renderer in renderers or []:
            self.register(renderer)

    def register(self, renderer: PromptRenderer) -> None:
        """注册一个渲染器；同名覆盖会破坏固定路由语义，因此直接拒绝。"""
        if renderer.name in self._renderers:
            raise ValueError(f"prompt renderer already registered: {renderer.name}")
        self._renderers[renderer.name] = renderer

    def resolve(self, name: PromptRendererName) -> PromptRenderer:
        """返回固定入口对应的渲染器，未知名称视为程序配置错误。"""
        try:
            return self._renderers[name]
        except KeyError as exc:
            raise LookupError(f"prompt renderer is not registered: {name}") from exc


prompt_renderer_registry = PromptRendererRegistry(
    [AssetImagePromptRenderer(), ShotFramePromptRenderer(), ShotVideoPromptRenderer()]
)
