"""统一生成提示词渲染的内部契约。"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.asset_prompts import AssetPromptOptions
from app.core.contracts.media import ImageMediaInput, VideoMediaInput


class PromptRendererName(str, Enum):
    """由固定路由 Binder 选择的已注册提示词渲染器名称。"""

    asset_image = "asset_image"


class AssetImagePromptRenderInput(AssetPromptOptions):
    """资产图片渲染允许使用的业务输入，不承载生成目标或 operation。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["asset_image"] = "asset_image"
    entity_type: Literal["actor", "character", "prop", "scene", "costume"]
    entity_id: str = Field(min_length=1)
    image_id: int | None = Field(default=None, ge=1)


PromptRenderInput = AssetImagePromptRenderInput

class PromptRenderRequest(BaseModel):
    """Renderer 的统一输入包装；类型和业务目标只能由调用方 Binder 决定。"""

    model_config = ConfigDict(extra="forbid")

    input: PromptRenderInput


class RenderedPromptSnapshot(BaseModel):
    """一次同步渲染的可展示、可审计快照，不能携带认证材料。"""

    model_config = ConfigDict(extra="forbid")

    render_id: str
    renderer: PromptRendererName
    execution_prompt: str
    variables_snapshot: dict[str, JsonValue]
    template_id: str | None = None
    template_version: int | None = None
    recommended_media: ImageMediaInput | VideoMediaInput | None = None
    warnings: list[str] = Field(default_factory=list)


class PromptRenderer(Protocol):
    """独立的同步提示词渲染协议，不负责提交任务或执行生成。"""

    name: PromptRendererName

    async def render(
        self,
        db: AsyncSession,
        request: PromptRenderRequest,
    ) -> RenderedPromptSnapshot:
        """根据固定业务入口提供的输入生成稳定快照。"""
