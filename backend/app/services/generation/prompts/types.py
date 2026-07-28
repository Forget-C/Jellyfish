"""统一生成提示词渲染的内部契约。"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.media import ImageMediaInput, VideoMediaInput
from app.models.studio import ShotFrameType
from app.schemas.studio.shots import ShotLinkedAssetItem


class PromptRendererName(str, Enum):
    """由固定路由 Binder 选择的已注册提示词渲染器名称。"""

    asset_image = "asset_image"
    shot_frame = "shot_frame"
    shot_video = "shot_video"


class AssetImagePromptRenderInput(BaseModel):
    """资产图片渲染允许使用的业务输入，不承载生成目标或 operation。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["asset_image"] = "asset_image"
    entity_type: Literal["actor", "character", "prop", "scene", "costume"]
    entity_id: str = Field(min_length=1)
    image_id: int | None = Field(default=None, ge=1)
    reference_file_ids: list[str] = Field(default_factory=list)


class ShotFramePromptRenderInput(BaseModel):
    """分镜帧渲染所需的已绑定镜头输入与参考资源。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["shot_frame"] = "shot_frame"
    shot_id: str = Field(min_length=1)
    frame_type: ShotFrameType
    prompt: str = ""
    images: list[ShotLinkedAssetItem] = Field(default_factory=list)
    director_command_summary: str = ""
    continuity_guidance: str = ""
    frame_specific_guidance: str = ""
    composition_anchor: str = ""
    screen_direction_guidance: str = ""


class ShotVideoPromptRenderInput(BaseModel):
    """镜头视频渲染所需的已绑定镜头输入与模板选择。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["shot_video"] = "shot_video"
    shot_id: str = Field(min_length=1)
    reference_mode: Literal["first", "last", "key", "first_last", "first_last_key", "text_only"]
    prompt: str | None = None
    image_file_ids: list[str] = Field(default_factory=list)
    template_id: str | None = None


PromptRenderInput = Annotated[
    AssetImagePromptRenderInput | ShotFramePromptRenderInput | ShotVideoPromptRenderInput,
    Field(discriminator="kind"),
]


class PromptRenderRequest(BaseModel):
    """Renderer 的统一输入包装；类型和业务目标只能由调用方 Binder 决定。"""

    model_config = ConfigDict(extra="forbid")

    input: PromptRenderInput


class FrameGuidanceDecisionSnapshot(BaseModel):
    """帧提示词渲染中单条 guidance 的保留或压缩决策，供工作室展示诊断。"""

    model_config = ConfigDict(extra="forbid")

    text: str
    category: str
    reason_tag: str = ""
    reason: str


class FrameReferenceMappingSnapshot(BaseModel):
    """帧提示词引用的资产与 file_id 映射，保持图片顺序可审计。"""

    model_config = ConfigDict(extra="forbid")

    token: str
    type: str
    id: str
    name: str
    file_id: str


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
    base_prompt: str | None = None
    selected_guidance: list[str] = Field(default_factory=list)
    dropped_guidance: list[str] = Field(default_factory=list)
    selected_guidance_details: list[FrameGuidanceDecisionSnapshot] = Field(default_factory=list)
    dropped_guidance_details: list[FrameGuidanceDecisionSnapshot] = Field(default_factory=list)
    reference_mappings: list[FrameReferenceMappingSnapshot] = Field(default_factory=list)


class PromptRenderer(Protocol):
    """独立的同步提示词渲染协议，不负责提交任务或执行生成。"""

    name: PromptRendererName

    async def render(
        self,
        db: AsyncSession,
        request: PromptRenderRequest,
    ) -> RenderedPromptSnapshot:
        """根据固定业务入口提供的输入生成稳定快照。"""
