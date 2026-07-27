"""视频生成共享输入输出契约。"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contracts.media import MediaReference
from app.core.contracts.provider import ProviderKey


def _strip_optional_b64(value: str | None) -> str | None:
    """兼容 Provider 适配层的空 URL 归一化辅助函数。

    该函数不再属于业务输入契约；P3 的 FileResolver 接入后将由执行期媒体
    投影取代。保留它可确保尚未迁移的 Provider 模块仍可导入。
    """
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


VideoRatio = Literal["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]


class VideoSubjectReference(BaseModel):
    """视频一致性主体：业务层只引用已受控的媒体文件。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, description="主体名称；Vidu 提示词通过 @name 引用")
    media: list[MediaReference] = Field(default_factory=list, description="主体图片或视频 FileItem 引用")

    @model_validator(mode="after")
    def require_reference_media(self) -> "VideoSubjectReference":
        """拒绝没有任何参考介质的主体，避免生成无效供应商请求。"""
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("subject name must not be blank")
        if not self.media:
            raise ValueError("subject requires at least one image or video reference")
        return self


class VideoFrameReferences(BaseModel):
    """以时间语义表达构图约束，和一致性主体严格分离。"""

    model_config = ConfigDict(extra="forbid")

    first_frame: MediaReference | None = None
    last_frame: MediaReference | None = None
    key_frames: list[MediaReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_frames(self) -> "VideoFrameReferences":
        """拒绝视频帧槽位中的非图片引用。"""
        references = [reference for reference in [self.first_frame, self.last_frame] if reference] + self.key_frames
        if any(reference.media_kind != "image" for reference in references):
            raise ValueError("frame references must use image media")
        return self


class VideoGenerationInput(BaseModel):
    """视频生成输入：帧参考约束画面，主体参考约束角色/物件的一致性。"""

    model_config = ConfigDict(extra="forbid")

    prompt: Optional[str] = Field(None, description="文本提示词；可与参考图二选一或同时存在")

    frame_references: VideoFrameReferences = Field(default_factory=VideoFrameReferences)
    subject_references: list[VideoSubjectReference] = Field(
        default_factory=list,
        description="命名主体参考；与首帧/尾帧/关键帧语义独立，由模型能力决定是否可组合",
    )

    model: Optional[str] = Field(None, description="视频模型名称（可选，供应商透传）")
    ratio: VideoRatio = Field(..., description="视频宽高比，业务层唯一主参数")
    seconds: Optional[int] = Field(None, description="时长（秒）（可选，供应商透传）")
    seed: Optional[int] = Field(
        None,
        ge=-1,
        le=4294967295,
        description="随机种子，-1 或 [0, 2^32-1]，供应商/模型可能有差异",
    )
    watermark: Optional[bool] = Field(None, description="是否包含水印，供应商/模型可能有差异")

    @model_validator(mode="after")
    def require_prompt_or_any_reference(self) -> "VideoGenerationInput":  # pylint: disable=no-member
        # Pydantic 在运行期将 FieldInfo 替换为已验证模型；静态检查无法推导该行为。
        # pylint: disable=no-member
        has_prompt = bool((self.prompt or "").strip())
        has_ref = any(
            [
                self.frame_references.first_frame,
                self.frame_references.last_frame,
                self.frame_references.key_frames,
                self.subject_references,
            ]
        )
        if not has_prompt and not has_ref:
            raise ValueError("Require prompt or at least one reference frame (base64)")
        return self


class VideoGenerationResult(BaseModel):
    """视频生成结果：返回视频 URL 和/或 file_id。"""

    model_config = ConfigDict(extra="forbid")

    url: Optional[str] = Field(None, description="生成视频可下载 URL")
    file_id: Optional[str] = Field(None, description="落库后的 FileItem.id（type=video）")
    provider_task_id: Optional[str] = Field(None, description="供应商侧任务/视频 ID（用于调试/追踪）")
    provider: Optional[ProviderKey] = Field(None, description="供应商标识")
    status: Optional[str] = Field(None, description="供应商任务状态")

    @model_validator(mode="after")
    def require_url_or_file_id(self) -> "VideoGenerationResult":
        if not self.url and not self.file_id:
            raise ValueError("Either url or file_id must be set")
        return self
